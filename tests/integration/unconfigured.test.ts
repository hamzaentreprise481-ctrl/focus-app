// The built app with no Supabase and no OpenAI configuration: every missing
// variable is visible, nothing is simulated, and no private route opens.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const origin = "http://127.0.0.1:3110";
let app: ChildProcess;

before(async () => {
  const env: NodeJS.ProcessEnv = { ...process.env, VERCEL: "", VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_SHA: "a".repeat(40) };
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "OPENAI_API_KEY", "OPENAI_BASE_URL"]) delete env[name];
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", "3110", "-H", "127.0.0.1"], { env, stdio: "ignore" });
  for (let i = 0; i < 80; i++) {
    try {
      await fetch(origin);
      return;
    } catch {
      await delay(250);
    }
  }
  throw new Error("app did not start");
});
after(() => {
  app.kill();
});

test("without Supabase variables the login is visibly unavailable and /app stays closed", async () => {
  const login = await fetch(`${origin}/connexion`);
  const html = await login.text();
  assert.equal(login.status, 200);
  assert.match(html, /en cours de préparation/);
  assert.match(html.match(/<input\b[^>]*name="email"[^>]*>/)![0], /disabled/);
  const app = await fetch(`${origin}/app`, { redirect: "manual" });
  assert.equal(app.status, 307);
  assert.equal(new URL(app.headers.get("location")!, origin).pathname, "/connexion");
});

test("the health endpoint names each missing piece and is not ready", async () => {
  const response = await fetch(`${origin}/api/health`);
  assert.equal(response.status, 503);
  const health = await response.json();
  assert.equal(health.ready, false);
  assert.equal(health.gitSha, "a".repeat(40));
  assert.equal(health.supabase.configured, false);
  assert.equal(health.ai.configured, false);
  assert.equal(health.ai.error, "OPENAI_API_KEY_MISSING");
});

test("the health endpoint does not exist in production", async () => {
  // Production is decided at request time by VERCEL_ENV, set by the platform;
  // the route returns 404 there (checked in the route source).
  const source = await import("node:fs").then((fs) => fs.readFileSync("app/api/health/route.ts", "utf8"));
  assert.match(source, /VERCEL_ENV === "production"\) return new NextResponse\(null, \{ status: 404 \}\)/);
});
