// The deployed-app login check drives the built app like a browser against
// the Supabase stand-in (real schema and RLS): it must pass for a
// provisioned teacher, stop at the right step otherwise, and report a
// database that is behind the code.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { checkDeployedLogin } from "../../lib/auth/deployed-login-check";
import { LOCAL_TEACHER, NON_TEACHER, startLocalStack, type LocalStack } from "../helpers/local-stack";

const LIVE_HEAD = "20260925214642_supersede_edited_analysis_runs.sql";
const apps: ChildProcess[] = [];
const stacks: LocalStack[] = [];

async function startApp(port: number, stack: LocalStack) {
  const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port), "-H", "127.0.0.1"], {
    env: { ...process.env, ...stack.env },
    stdio: "ignore",
  });
  apps.push(app);
  for (let i = 0; i < 80; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/connexion`);
      return `http://127.0.0.1:${port}`;
    } catch {
      await delay(250);
    }
  }
  throw new Error("app did not start");
}

let current: string;
let behind: string;
before(async () => {
  const stack = await startLocalStack({ supabasePort: 54371, modelPort: 54379 });
  const oldStack = await startLocalStack({ supabasePort: 54381, modelPort: 54389, upTo: LIVE_HEAD });
  stacks.push(stack, oldStack);
  [current, behind] = await Promise.all([startApp(3130, stack), startApp(3131, oldStack)]);
});
after(async () => {
  for (const app of apps) app.kill("SIGTERM");
  await Promise.all(stacks.map((stack) => stack.close()));
});

const failed = (steps: Awaited<ReturnType<typeof checkDeployedLogin>>) => steps.filter((step) => !step.ok).map((step) => step.step);

test("a provisioned teacher: login, HttpOnly cookie, reload, class/students/assessments pages, logout, anonymous denial", async () => {
  const steps = await checkDeployedLogin({ origin: current, email: LOCAL_TEACHER.email, password: LOCAL_TEACHER.password });
  assert.deepEqual(failed(steps), [], JSON.stringify(steps, null, 2));
  assert.deepEqual(
    steps.map((step) => step.step),
    ["login_page", "login_submit", "session_cookie", "teacher_home", "reload", "page /app/classes", "page /app/eleves", "page /app/evaluations", "logout_form", "logout", "after_logout", "anonymous_denied"],
  );
});

test("the former demo credentials and a non-teacher account stop at the login step", async () => {
  assert.deepEqual(failed(await checkDeployedLogin({ origin: current, email: "prof@focus.fr", password: "focus1234" })), ["login_submit"]);
  assert.deepEqual(failed(await checkDeployedLogin({ origin: current, email: NON_TEACHER.email, password: NON_TEACHER.password })), ["login_submit"]);
});

test("against a database still at the live head, the login works and the missing migrations are named", async () => {
  const steps = await checkDeployedLogin({ origin: behind, email: LOCAL_TEACHER.email, password: LOCAL_TEACHER.password });
  const byStep = new Map(steps.map((step) => [step.step, step]));
  assert.equal(byStep.get("login_submit")?.ok, true);
  assert.equal(byStep.get("session_cookie")?.ok, true);
  assert.equal(byStep.get("anonymous_denied")?.ok, true);
  assert.ok(steps.some((step) => !step.ok && /base (n’est )?pas à jour/.test(step.detail)), JSON.stringify(steps, null, 2));
});

test("an unreachable deployment is reported, not mistaken for a login failure", async () => {
  assert.deepEqual(failed(await checkDeployedLogin({ origin: "http://127.0.0.1:9", email: "a@b.c", password: "x" })), ["app_reachable"]);
});
