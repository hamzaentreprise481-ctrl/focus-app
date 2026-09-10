import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

// A protocol-level Auth double, bound to loopback. Never imported by the app.
const origin = "http://127.0.0.1:3100";
const authOrigin = "http://127.0.0.1:3101";
let app: ChildProcess;
let output = "";
let revoked = false;
let refreshes = 0;
const issuedAt = Math.floor(Date.now() / 1000);
const user = (role = "teacher") => ({
  id: "11111111-1111-4111-8111-111111111111",
  aud: "authenticated",
  role: "authenticated",
  email: "teacher@example.invalid",
  email_confirmed_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  is_anonymous: false,
  app_metadata: { role },
  user_metadata: { display_name: "Camille Test" },
});
const token = (role = "teacher", expired = false) =>
  `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: user().id, role, exp: issuedAt + (expired ? -3600 : 3600) })).toString("base64url")}.test-signature`;
const session = (role = "teacher", expired = false) => ({
  access_token: token(role, expired),
  refresh_token: "refresh-test",
  expires_in: expired ? -3600 : 3600,
  expires_at: issuedAt + (expired ? -3600 : 3600),
  token_type: "bearer",
  user: user(role),
});
const mock = createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  const url = new URL(req.url!, authOrigin);
  if (url.pathname === "/auth/v1/token") {
    let raw = "";
    for await (const part of req) raw += part;
    const body = JSON.parse(raw || "{}");
    if (url.searchParams.get("grant_type") === "refresh_token") {
      refreshes++;
      return res.end(JSON.stringify(session()));
    }
    if (body.password !== "fixture-password") {
      res.statusCode = 400;
      return res.end(
        JSON.stringify({
          code: "invalid_credentials",
          msg: "Invalid credentials",
        }),
      );
    }
    return res.end(
      JSON.stringify(
        session(body.email === "parent@example.invalid" ? "parent" : "teacher"),
      ),
    );
  }
  if (url.pathname === "/auth/v1/user") {
    const bearer = req.headers.authorization?.replace("Bearer ", "");
    if (![token(), token("parent")].includes(bearer ?? "")) {
      res.statusCode = 401;
      return res.end(JSON.stringify({ message: "Invalid token" }));
    }
    return res.end(
      JSON.stringify(
        user(
          revoked
            ? "parent"
            : bearer === token("parent")
              ? "parent"
              : "teacher",
        ),
      ),
    );
  }
  if (url.pathname === "/auth/v1/logout") {
    res.statusCode = 204;
    return res.end();
  }
  res.statusCode = 404;
  res.end("{}");
});
let jar = "";
function cookies(response: Response) {
  const map = new Map(
    jar
      .split("; ")
      .filter(Boolean)
      .map((c) => [c.slice(0, c.indexOf("=")), c.slice(c.indexOf("=") + 1)]),
  );
  for (const header of response.headers.getSetCookie()) {
    const part = header.split(";")[0];
    map.set(
      part.slice(0, part.indexOf("=")),
      part.slice(part.indexOf("=") + 1),
    );
  }
  jar = [...map].map(([k, v]) => `${k}=${v}`).join("; ");
}
const request = (path: string, init: RequestInit = {}) =>
  fetch(origin + path, {
    redirect: "manual",
    ...init,
    headers: { Cookie: jar, ...init.headers },
  });
function actionForm(html: string, needle: string) {
  const form = html.match(
    new RegExp(`<form[^>]*>[\\s\\S]*?${needle}[\\s\\S]*?<\\/form>`),
  )?.[0];
  assert.ok(form, "Server action form rendered");
  const body = new FormData();
  for (const match of form.matchAll(/<input\b[^>]*>/g)) {
    const name = match[0].match(/name="([^"]*)"/)?.[1];
    const value = (match[0].match(/value="([^"]*)"/)?.[1] ?? "")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&#x27;/g, "'");
    if (name) body.set(name, value);
  }
  return body;
}
before(async () => {
  await new Promise<void>((resolve) => mock.listen(3101, "127.0.0.1", resolve));
  app = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "-p",
      "3100",
      "-H",
      "127.0.0.1",
    ],
    {
      env: {
        ...process.env,
        NEXT_PUBLIC_SUPABASE_URL: authOrigin,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-test-key",
        VERCEL: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  app.stdout?.on("data", (x) => (output += x));
  app.stderr?.on("data", (x) => (output += x));
  for (let i = 0; i < 80; i++) {
    try {
      await fetch(origin);
      return;
    } catch {
      await delay(250);
    }
  }
  throw new Error(output);
});
after(async () => {
  app?.kill("SIGTERM");
  mock.closeAllConnections();
  await new Promise<void>((resolve) => mock.close(() => resolve()));
});
test("public response uses only fictitious marketing fixture and keeps login separate", async () => {
  const response = await request("/");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Données fictives de démonstration/);
  assert.doesNotMatch(
    html,
    /Lucas Bernard|Adam Benali|lucas-bernard|demo-overlay|Se déconnecter/,
  );
});
test("all unauthenticated teacher routes and RSC requests redirect without roster data", async () => {
  for (const route of [
    "/app",
    "/app/classes",
    "/app/classes/seconde-3",
    "/app/eleves",
    "/app/eleves/lucas-bernard",
    "/app/evaluations",
    "/app/evaluations/eval-1",
    "/app/evaluations/nouvelle",
    "/app/parametres",
  ]) {
    for (const headers of [{}, { RSC: "1" }] as Record<string, string>[]) {
      const r = await request(route, { headers });
      assert.equal(r.status, 307, route);
      assert.match(r.headers.get("location")!, /\/connexion\?next=/);
      assert.doesNotMatch(await r.text(), /Lucas Bernard/);
    }
  }
});
test("legacy links redirect to the equivalent private route", async () => {
  for (const route of [
    "classes/seconde-3",
    "eleves/lucas-bernard",
    "evaluations/nouvelle",
    "parametres",
  ]) {
    const r = await request("/" + route);
    assert.equal(r.status, 308);
    assert.equal(
      new URL(r.headers.get("location")!, origin).pathname,
      "/app/" + route,
    );
  }
});
test("forged cookies do not authorize a teacher", async () => {
  const forged = { ...session(), access_token: "forged-token" };
  jar =
    "sb-127-auth-token=base64-" +
    Buffer.from(JSON.stringify(forged)).toString("base64url");
  const r = await request("/app");
  assert.equal(r.status, 307);
  jar = "";
});
test("real login server action creates persistent HttpOnly session and returns to requested route", async () => {
  const html = await (await request("/connexion?next=/app/classes")).text();
  const body = actionForm(html, "Se connecter");
  body.set("email", "teacher@example.invalid");
  body.set("password", "fixture-password");
  body.set("next", "/app/classes");
  const r = await request("/connexion", {
    method: "POST",
    headers: { Origin: origin },
    body,
  });
  assert.equal(r.status, 303, await r.clone().text());
  assert.equal(
    new URL(r.headers.get("location")!, origin).pathname,
    "/app/classes",
  );
  assert.ok(r.headers.getSetCookie().some((c) => /HttpOnly/i.test(c)));
  cookies(r);
  assert.ok(jar);
  for (const path of [
    "/app",
    "/app/classes",
    "/app/eleves",
    "/app/eleves/lucas-bernard",
    "/app/evaluations",
    "/app/evaluations/eval-1",
    "/app/evaluations/nouvelle",
  ]) {
    const page = await request(path);
    assert.equal(page.status, 200, path);
    assert.match(page.headers.get("cache-control")!, /no-store/);
  }
});
test("provider-side role revocation immediately blocks the same session", async () => {
  revoked = true;
  const r = await request("/app/eleves");
  assert.equal(r.status, 307);
  revoked = false;
});
test("logout action clears the session and protected navigation is denied", async () => {
  const html = await (await request("/app")).text();
  const body = actionForm(html, "Se déconnecter");
  const r = await request("/app", {
    method: "POST",
    headers: { Origin: origin },
    body,
  });
  assert.equal(r.status, 303);
  cookies(r);
  assert.equal((await request("/app")).status, 307);
  jar = "";
});
test("parent login is rejected and does not create teacher access", async () => {
  const html = await (await request("/connexion")).text();
  const body = actionForm(html, "Se connecter");
  body.set("email", "parent@example.invalid");
  body.set("password", "fixture-password");
  const r = await request("/connexion", {
    method: "POST",
    headers: { Origin: origin },
    body,
  });
  cookies(r);
  assert.match(await r.text(), /réservé aux comptes professeurs/);
  assert.equal((await request("/app")).status, 307);
  jar = "";
});
test("an expired session is refreshed through Auth before rendering", async () => {
  jar =
    "sb-127-auth-token=base64-" +
    Buffer.from(JSON.stringify(session("teacher", true))).toString("base64url");
  const r = await request("/app");
  assert.equal(r.status, 200);
  assert.ok(refreshes > 0);
  assert.ok(r.headers.getSetCookie().length > 0);
  jar = "";
});
