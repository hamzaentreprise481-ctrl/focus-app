import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readdirSync } from "node:fs";
import { promisify } from "node:util";
import { deploymentHealth, REQUIRED_SCHEMA_VERSION } from "../lib/deployment-health";

const SHA = "e8d5873b58139d80402aace0588d56cfe557afa5";
const KEY = "sb_publishable_fixture-key-must-not-leak";
const ai = { configured: true, ok: true, model: "fixture-model", apiStatus: 200, error: null };
const SIGNING = "5e".repeat(32);

function withEnv<T>(values: Record<string, string | undefined>, run: () => Promise<T>) {
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  for (const [key, value] of Object.entries(values)) if (value === undefined) delete process.env[key];
  return run().finally(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("the required schema version is the newest migration", () => {
  const newest = readdirSync("supabase/migrations").filter((name) => name.endsWith(".sql")).sort().at(-1)!;
  assert.equal(newest.slice(0, 14), REQUIRED_SCHEMA_VERSION);
});

test("health proves commit, Supabase, schema and model without revealing any value", async () => {
  await withEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: KEY }, async () => {
    const fetchImpl = (async (url: string | URL) =>
      String(url).endsWith("/auth/v1/health")
        ? new Response("{}", { status: 200 })
        : new Response(JSON.stringify(REQUIRED_SCHEMA_VERSION), { status: 200 })) as typeof fetch;
    const env = { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_SHA: SHA, VERCEL_GIT_COMMIT_REF: "claude/finish-focus-v1", FOCUS_ANALYSIS_SIGNING_KEY: SIGNING };
    const health = await deploymentHealth(async () => ai, env, fetchImpl);
    assert.equal(health.ready, true);
    assert.equal(health.ai.signingKeyConfigured, true);
    assert.equal(health.gitSha, SHA);
    assert.equal(health.supabase.schemaUpToDate, true);
    const text = JSON.stringify(health);
    assert.doesNotMatch(text, /fixture-key|project\.supabase\.co/);
    assert.ok(!text.includes(SIGNING) && !text.includes("5e5e"), "the signing key never appears");

    // Without the signing key nothing could be recorded: not ready.
    for (const value of [undefined, "", "too-short", "5e".repeat(16).slice(1)]) {
      const unsigned = await deploymentHealth(async () => ai, { ...env, FOCUS_ANALYSIS_SIGNING_KEY: value }, fetchImpl);
      assert.equal(unsigned.ai.signingKeyConfigured, false, String(value));
      assert.equal(unsigned.ready, false, String(value));
    }

    const outdated = await deploymentHealth(async () => ai, { VERCEL_ENV: "preview" }, (async (url: string | URL) =>
      String(url).endsWith("/auth/v1/health") ? new Response("{}") : new Response(JSON.stringify("20260925214642"))) as typeof fetch);
    assert.equal(outdated.supabase.schemaUpToDate, false);
    assert.equal(outdated.gitSha, null);
    assert.equal(outdated.ready, false);

    // The RPC is missing on a database behind the code (404 from PostgREST).
    const missing = await deploymentHealth(async () => ai, {}, (async (url: string | URL) =>
      String(url).endsWith("/auth/v1/health") ? new Response("{}") : new Response("{}", { status: 404 })) as typeof fetch);
    assert.equal(missing.supabase.schemaVersion, null);
    assert.equal(missing.supabase.schemaUpToDate, false);
  });
});

test("each missing variable is reported, and the deployment is not ready", async () => {
  await withEnv({ NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined }, async () => {
    const health = await deploymentHealth(async () => ({ configured: false, ok: false, model: "m", apiStatus: null, error: "OPENAI_API_KEY_MISSING" }), {}, (async () => {
      throw new Error("must not be called");
    }) as typeof fetch);
    assert.equal(health.supabase.configured, false);
    assert.equal(health.supabase.schemaUpToDate, null);
    assert.equal(health.ai.error, "OPENAI_API_KEY_MISSING");
    assert.equal(health.ready, false);
  });
  for (const [url, key] of [["https://project.supabase.co", undefined], [undefined, KEY], ["http://project.supabase.co", KEY]] as const)
    await withEnv({ NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key, VERCEL: "1" }, async () => {
      const health = await deploymentHealth(async () => ai, {}, (async () => new Response("{}")) as typeof fetch);
      assert.equal(health.supabase.configured, false, `${url} / ${key ? "key" : "no key"}`);
    });
});

async function serve(respond: (path: string, headers: Record<string, string | string[] | undefined>) => { status: number; type?: string; body: string }) {
  const server = createServer((req, res) => {
    const { status, type, body } = respond(req.url ?? "", req.headers);
    res.writeHead(status, { "content-type": type ?? "application/json" });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
}
async function verify(origin: string, env: Record<string, string> = {}) {
  try {
    const { stdout } = await promisify(execFile)(process.execPath, ["scripts/verify-preview.mjs", origin, SHA], { env: { ...process.env, ...env } });
    return { code: 0, out: JSON.parse(stdout) };
  } catch (error) {
    const failed = error as { code: number; stdout: string };
    return { code: failed.code, out: JSON.parse(failed.stdout) };
  }
}

test("the Preview verifier passes only for the expected commit, ready, and says UNVERIFIED otherwise", async () => {
  const ready = { gitSha: SHA, ready: true, environment: "preview", supabase: {}, ai: {} };
  const cases: Array<[string, Parameters<typeof serve>[0], number, string]> = [
    ["ready", () => ({ status: 200, body: JSON.stringify(ready) }), 0, "VERIFIED"],
    ["not ready", () => ({ status: 503, body: JSON.stringify({ ...ready, ready: false }) }), 1, "NOT READY"],
    ["another commit", () => ({ status: 200, body: JSON.stringify({ ...ready, gitSha: "0".repeat(40) }) }), 2, "UNVERIFIED"],
    ["Vercel Authentication page", () => ({ status: 200, type: "text/html", body: "<html>Log in to Vercel</html>" }), 2, "UNVERIFIED"],
    ["401", () => ({ status: 401, type: "text/html", body: "" }), 2, "UNVERIFIED"],
  ];
  for (const [label, respond, code, verdict] of cases) {
    const server = await serve(respond);
    try {
      const result = await verify(server.origin);
      assert.equal(result.code, code, label);
      assert.equal(result.out.verdict, verdict, label);
    } finally {
      server.close();
    }
  }
  // The bypass secret is sent as a header and never printed.
  const server = await serve((_, headers) =>
    headers["x-vercel-protection-bypass"] === "bypass-fixture" ? { status: 200, body: JSON.stringify(ready) } : { status: 401, type: "text/html", body: "" },
  );
  try {
    const result = await verify(server.origin, { VERCEL_AUTOMATION_BYPASS_SECRET: "bypass-fixture" });
    assert.equal(result.out.verdict, "VERIFIED");
    assert.doesNotMatch(JSON.stringify(result.out), /bypass-fixture/);
  } finally {
    server.close();
  }
});
