// A loopback stand-in for the two Supabase services the app talks to, backed
// by the real FOCUS schema in PGlite (tests/helpers/pg.ts):
//
// - Auth (GoTrue): password grant, refresh grant, /user, /logout. Users and
//   their app/user metadata live in auth.users, so revoking a role in the
//   database takes effect on the next request, as with the real service.
// - PostgREST: the subset used by the app — GET with select (columns and
//   many-to-one embeds), eq/neq/in/is/gt/gte/lt/lte filters, order, limit,
//   exact counts (HEAD), PATCH, and POST /rpc/<function>.
//
// Every data request runs in its own transaction as the `authenticated` role
// with request.jwt.claim.sub set to the caller, so RLS policies, SECURITY
// INVOKER functions and grants behave exactly as they do on the project.
// Test-only: never imported by the application.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";

export interface LocalAccount {
  email: string;
  password: string;
  userId: string;
}

interface Session {
  userId: string;
  expiresAt: number;
}

export interface LocalSupabase {
  url: string;
  publishableKey: string;
  server: Server;
  /** Makes every issued access token expire (the refresh token still works). */
  expireAccessTokens(): void;
  requests: string[];
  close(): Promise<void>;
}

const PUBLISHABLE_KEY = "sb_publishable_local_test_key";

function b64(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

async function readBody(req: IncomingMessage) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw;
}

function send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

/** Serializes database access: PGlite has a single connection. */
function createQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => undefined);
    return run;
  };
}

type ColumnTypes = Map<string, string>;

export async function startLocalSupabase(
  db: PGlite,
  options: { port: number; accounts: LocalAccount[]; accessTokenSeconds?: number },
): Promise<LocalSupabase> {
  const queue = createQueue();
  const accessTokens = new Map<string, Session>();
  const refreshTokens = new Map<string, string>();
  const requests: string[] = [];
  const lifetime = options.accessTokenSeconds ?? 3600;
  const columnCache = new Map<string, ColumnTypes>();

  async function columnTypes(table: string): Promise<ColumnTypes> {
    const cached = columnCache.get(table);
    if (cached) return cached;
    const { rows } = await db.query<{ name: string; type: string }>(
      `select a.attname as name, format_type(a.atttypid, a.atttypmod) as type
         from pg_attribute a
        where a.attrelid = to_regclass('public.' || quote_ident($1)) and a.attnum > 0 and not a.attisdropped`,
      [table],
    );
    if (!rows.length) throw Object.assign(new Error(`relation "public.${table}" does not exist`), { code: "42P01" });
    const map = new Map(rows.map((row) => [row.name, row.type]));
    columnCache.set(table, map);
    return map;
  }

  async function foreignKey(table: string, target: string) {
    const { rows } = await db.query<{ local: string; remote: string }>(
      `select la.attname as local, ra.attname as remote
         from pg_constraint c
         join pg_attribute la on la.attrelid = c.conrelid and la.attnum = c.conkey[1]
         join pg_attribute ra on ra.attrelid = c.confrelid and ra.attnum = c.confkey[1]
        where c.contype = 'f' and c.conrelid = to_regclass('public.' || quote_ident($1))
          and c.confrelid = to_regclass('public.' || quote_ident($2))`,
      [table, target],
    );
    if (rows.length !== 1) throw new Error(`embed ${table} → ${target} is not a single many-to-one relationship`);
    return rows[0];
  }

  function user(row: {
    id: string;
    email: string | null;
    raw_app_meta_data: Record<string, unknown>;
    raw_user_meta_data: Record<string, unknown>;
    is_anonymous: boolean;
    created_at: string;
  }) {
    return {
      id: row.id,
      aud: "authenticated",
      role: "authenticated",
      email: row.email,
      email_confirmed_at: row.created_at,
      created_at: row.created_at,
      is_anonymous: row.is_anonymous,
      app_metadata: row.raw_app_meta_data,
      user_metadata: row.raw_user_meta_data,
    };
  }

  async function loadUser(userId: string) {
    const { rows } = await queue(() =>
      db.query<Parameters<typeof user>[0]>(
        "select id, email, raw_app_meta_data, raw_user_meta_data, is_anonymous, created_at from auth.users where id = $1",
        [userId],
      ),
    );
    return rows[0] ? user(rows[0]) : null;
  }

  async function issueSession(userId: string) {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + lifetime;
    const access = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: userId, role: "authenticated", exp, iat: now, session_id: randomUUID() })}.${randomBytes(16).toString("base64url")}`;
    const refresh = randomBytes(24).toString("base64url");
    accessTokens.set(access, { userId, expiresAt: exp });
    refreshTokens.set(refresh, userId);
    return {
      access_token: access,
      refresh_token: refresh,
      expires_in: lifetime,
      expires_at: exp,
      token_type: "bearer",
      user: await loadUser(userId),
    };
  }

  function caller(req: IncomingMessage): { role: "anon" | "authenticated"; userId: string | null } | "expired" {
    const bearer = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
    if (!bearer || bearer === PUBLISHABLE_KEY) return { role: "anon", userId: null };
    const session = accessTokens.get(bearer);
    if (!session) return { role: "anon", userId: null };
    if (session.expiresAt <= Math.floor(Date.now() / 1000)) return "expired";
    return { role: "authenticated", userId: session.userId };
  }

  async function asCaller<T>(identity: { role: string; userId: string | null }, fn: () => Promise<T>) {
    return queue(async () => {
      await db.exec("begin");
      try {
        await db.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)", [
          identity.userId ?? "",
          JSON.stringify(identity.userId ? { sub: identity.userId, role: identity.role } : { role: identity.role }),
        ]);
        await db.exec(`set local role ${identity.role}`);
        const result = await fn();
        await db.exec("commit");
        return result;
      } catch (error) {
        await db.exec("rollback");
        throw error;
      }
    });
  }

  // --- PostgREST -----------------------------------------------------------

  function splitTopLevel(value: string) {
    const parts: string[] = [];
    let depth = 0;
    let current = "";
    for (const char of value) {
      if (char === "(") depth++;
      if (char === ")") depth--;
      if (char === "," && depth === 0) {
        parts.push(current);
        current = "";
      } else current += char;
    }
    if (current) parts.push(current);
    return parts.map((part) => part.trim()).filter(Boolean);
  }

  async function selectExpression(table: string, alias: string, select: string, depth = 0): Promise<string> {
    const types = await columnTypes(table);
    const fields = select === "*" ? [...types.keys()] : splitTopLevel(select);
    const pairs: string[] = [];
    for (const field of fields) {
      const embed = field.match(/^(?:(\w+):)?(\w+)\((.*)\)$/);
      if (embed) {
        const [, name, target, inner] = embed;
        const fk = await foreignKey(table, target);
        const innerAlias = `e${depth}_${target}`;
        pairs.push(
          `'${name ?? target}', (select ${await selectExpression(target, innerAlias, inner, depth + 1)} from public.${target} ${innerAlias} where ${innerAlias}.${fk.remote} = ${alias}.${fk.local})`,
        );
        continue;
      }
      if (!types.has(field)) throw Object.assign(new Error(`column ${table}.${field} does not exist`), { code: "42703" });
      pairs.push(`'${field}', ${alias}.${field}`);
    }
    return `jsonb_build_object(${pairs.join(", ")})`;
  }

  function pgArray(values: string[]) {
    return `{${values.map((value) => `"${value.replace(/(["\\])/g, "\\$1")}"`).join(",")}}`;
  }

  async function whereClause(table: string, params: URLSearchParams, values: unknown[]) {
    const types = await columnTypes(table);
    const clauses: string[] = [];
    for (const [key, raw] of params) {
      if (["select", "order", "limit", "offset", "columns"].includes(key)) continue;
      const type = types.get(key);
      if (!type) throw Object.assign(new Error(`column ${table}.${key} does not exist`), { code: "42703" });
      const dot = raw.indexOf(".");
      const op = raw.slice(0, dot);
      const operand = raw.slice(dot + 1);
      const column = `t.${key}`;
      const push = (value: unknown) => {
        values.push(value);
        return `$${values.length}`;
      };
      switch (op) {
        case "eq":
        case "neq":
        case "gt":
        case "gte":
        case "lt":
        case "lte": {
          const sql = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" }[op];
          clauses.push(`${column} ${sql} ${push(operand)}::${type}`);
          break;
        }
        case "in": {
          const items = operand.replace(/^\(|\)$/g, "").split(",").map((item) => item.replace(/^"|"$/g, ""));
          clauses.push(`${column} = any(${push(pgArray(items))}::${type}[])`);
          break;
        }
        case "is":
          if (!["null", "true", "false"].includes(operand)) throw new Error(`unsupported is.${operand}`);
          clauses.push(`${column} is ${operand}`);
          break;
        default:
          throw new Error(`unsupported filter operator ${op}`);
      }
    }
    return clauses.length ? `where ${clauses.join(" and ")}` : "";
  }

  async function orderClause(table: string, order: string | null) {
    if (!order) return "";
    const types = await columnTypes(table);
    return `order by ${order
      .split(",")
      .map((term) => {
        const [column, direction = "asc", nulls] = term.split(".");
        if (!types.has(column)) throw new Error(`unknown order column ${column}`);
        const dir = direction === "desc" ? "desc" : "asc";
        const nullsSql = nulls === "nullsfirst" ? " nulls first" : nulls === "nullslast" ? " nulls last" : "";
        return `t.${column} ${dir}${nullsSql}`;
      })
      .join(", ")}`;
  }

  function pgError(error: unknown) {
    const value = error as { code?: string; message?: string; detail?: string; hint?: string };
    return {
      status: value.code === "42501" ? 403 : value.code === "PGRST116" ? 406 : 400,
      body: { code: value.code ?? "PGRST000", message: value.message ?? String(error), details: value.detail ?? null, hint: value.hint ?? null },
    };
  }

  async function handleRest(req: IncomingMessage, res: ServerResponse, url: URL) {
    const identity = caller(req);
    if (identity === "expired")
      return send(res, 401, { code: "PGRST303", message: "JWT expired", details: null, hint: null });
    const path = url.pathname.replace(/^\/rest\/v1\//, "");

    if (path.startsWith("rpc/")) {
      const fn = path.slice(4);
      const args = JSON.parse((await readBody(req)) || "{}") as Record<string, unknown>;
      try {
        const result = await asCaller(identity, async () => {
          const { rows: argTypes } = await db.query<{ name: string; type: string }>(
            `select unnest(p.proargnames) as name, format_type(unnest(p.proargtypes::oid[]), null) as type
               from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = $1`,
            [fn],
          );
          if (!argTypes.length && Object.keys(args).length)
            throw Object.assign(new Error(`function public.${fn} not found`), { code: "PGRST202" });
          const typeOf = new Map(argTypes.map((row) => [row.name, row.type]));
          const values: unknown[] = [];
          const named = Object.entries(args).map(([name, value]) => {
            const type = typeOf.get(name);
            if (!type) throw Object.assign(new Error(`function public.${fn} has no argument ${name}`), { code: "PGRST202" });
            values.push(
              value === null || value === undefined
                ? null
                : type === "jsonb" || type === "json"
                  ? JSON.stringify(value)
                  : type.endsWith("[]") && Array.isArray(value)
                    ? pgArray(value.map(String))
                    : typeof value === "object"
                      ? JSON.stringify(value)
                      : String(value),
            );
            return `${name} => $${values.length}::${type}`;
          });
          const { rows: shape } = await db.query<{ returns_set: boolean; returns_void: boolean }>(
            `select bool_or(p.proretset) as returns_set, bool_or(p.prorettype = 'void'::regtype) as returns_void
               from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = $1`,
            [fn],
          );
          const call = `public.${fn}(${named.join(", ")})`;
          if (shape[0]?.returns_void) {
            await db.query(`select ${call}`, values);
            return null;
          }
          const { rows } = await db.query<{ result: unknown }>(
            shape[0]?.returns_set
              ? `select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) as result from ${call} r`
              : `select to_jsonb(${call}) as result`,
            values,
          );
          return rows[0]?.result ?? null;
        });
        return send(res, 200, result);
      } catch (error) {
        const { status, body } = pgError(error);
        return send(res, status, body);
      }
    }

    const table = path;
    try {
      if (req.method === "GET" || req.method === "HEAD") {
        const values: unknown[] = [];
        const select = url.searchParams.get("select") ?? "*";
        const where = await whereClause(table, url.searchParams, values);
        const order = await orderClause(table, url.searchParams.get("order"));
        const limit = url.searchParams.get("limit");
        const offset = url.searchParams.get("offset");
        const expression = await selectExpression(table, "t", select);
        const prefer = String(req.headers.prefer ?? "");
        const wantsCount = /count=exact/.test(prefer);
        const { rows, total } = await asCaller(identity, async () => {
          const data = await db.query<{ row: unknown }>(
            `select ${expression} as row from public.${table} t ${where} ${order} ${limit ? `limit ${Number(limit)}` : ""} ${offset ? `offset ${Number(offset)}` : ""}`,
            values,
          );
          const count = wantsCount
            ? (await db.query<{ n: number }>(`select count(*)::int as n from public.${table} t ${where}`, values)).rows[0].n
            : null;
          return { rows: data.rows.map((row) => row.row), total: count };
        });
        const range = `${rows.length ? `0-${rows.length - 1}` : "*"}/${total ?? "*"}`;
        const single = String(req.headers.accept ?? "").includes("vnd.pgrst.object+json");
        if (req.method === "HEAD") {
          res.writeHead(200, { "Content-Range": range });
          return res.end();
        }
        if (single) {
          if (rows.length !== 1)
            return send(res, 406, {
              code: "PGRST116",
              message: "JSON object requested, multiple (or no) rows returned",
              details: `The result contains ${rows.length} rows`,
              hint: null,
            });
          return send(res, 200, rows[0], { "Content-Range": range });
        }
        return send(res, 200, rows, { "Content-Range": range });
      }

      if (req.method === "PATCH") {
        const patch = JSON.parse((await readBody(req)) || "{}") as Record<string, unknown>;
        const types = await columnTypes(table);
        const values: unknown[] = [];
        const sets = Object.entries(patch).map(([column, value]) => {
          const type = types.get(column);
          if (!type) throw Object.assign(new Error(`column ${table}.${column} does not exist`), { code: "42703" });
          values.push(value === null ? null : typeof value === "object" ? JSON.stringify(value) : String(value));
          return `${column} = $${values.length}::${type}`;
        });
        const where = await whereClause(table, url.searchParams, values);
        await asCaller(identity, () => db.query(`update public.${table} t set ${sets.join(", ")} ${where}`, values));
        return send(res, 204);
      }

      return send(res, 405, { code: "PGRST000", message: `method ${req.method} not supported by the local stand-in` });
    } catch (error) {
      const { status, body } = pgError(error);
      return send(res, status, body);
    }
  }

  // --- Auth ------------------------------------------------------------------

  async function handleAuth(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (url.pathname === "/auth/v1/token" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}") as Record<string, string>;
      if (url.searchParams.get("grant_type") === "refresh_token") {
        const userId = refreshTokens.get(body.refresh_token);
        if (!userId) return send(res, 400, { code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
        refreshTokens.delete(body.refresh_token);
        return send(res, 200, await issueSession(userId));
      }
      const account = options.accounts.find(
        (item) => item.email.toLowerCase() === String(body.email ?? "").toLowerCase() && item.password === body.password,
      );
      if (!account) return send(res, 400, { code: "invalid_credentials", msg: "Invalid login credentials" });
      return send(res, 200, await issueSession(account.userId));
    }
    if (url.pathname === "/auth/v1/user" && req.method === "GET") {
      const identity = caller(req);
      if (identity === "expired" || !identity.userId)
        return send(res, 403, { code: "bad_jwt", msg: "invalid JWT" });
      const current = await loadUser(identity.userId);
      if (!current) return send(res, 403, { code: "user_not_found", msg: "User not found" });
      return send(res, 200, current);
    }
    if (url.pathname === "/auth/v1/logout" && req.method === "POST") {
      const bearer = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
      const session = accessTokens.get(bearer);
      if (session) {
        accessTokens.delete(bearer);
        for (const [refresh, userId] of refreshTokens) if (userId === session.userId) refreshTokens.delete(refresh);
      }
      res.writeHead(204);
      return res.end();
    }
    return send(res, 404, { msg: "not found" });
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${options.port}`);
    requests.push(`${req.method} ${url.pathname}${url.search}`);
    try {
      if (url.pathname.startsWith("/auth/v1/")) return await handleAuth(req, res, url);
      if (url.pathname.startsWith("/rest/v1/")) return await handleRest(req, res, url);
      send(res, 404, { msg: "not found" });
    } catch (error) {
      send(res, 500, { message: error instanceof Error ? error.message : String(error) });
    }
  });
  await new Promise<void>((resolve) => server.listen(options.port, "127.0.0.1", resolve));

  return {
    url: `http://127.0.0.1:${options.port}`,
    publishableKey: PUBLISHABLE_KEY,
    server,
    requests,
    expireAccessTokens() {
      for (const session of accessTokens.values()) session.expiresAt = 0;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
