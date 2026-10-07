// The login diagnosis runs the app's real flow against the Supabase stand-in
// (real schema and RLS in PGlite) and names the step that breaks.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { diagnoseTeacherLogin, isPrivilegedKey, maskEmail } from "../lib/auth/login-diagnosis";
import { LOCAL_TEACHER, NON_TEACHER, startLocalStack, type LocalStack } from "./helpers/local-stack";

let stack: LocalStack;
before(async () => {
  stack = await startLocalStack({ supabasePort: 54361, modelPort: 54369 });
});
after(async () => {
  await stack?.close();
});

const run = (email: string, password: string, extra: { key?: string; projectRef?: string } = {}) =>
  diagnoseTeacherLogin({ url: stack.supabase.url, key: extra.key ?? stack.supabase.publishableKey, email, password, projectRef: extra.projectRef });
const failed = (steps: Awaited<ReturnType<typeof run>>) => steps.filter((step) => !step.ok).map((step) => step.step);

test("a provisioned teacher passes every step: login, session, membership role, profile, RLS, refresh, logout", async () => {
  const steps = await run(LOCAL_TEACHER.email, LOCAL_TEACHER.password);
  assert.deepEqual(failed(steps), [], JSON.stringify(steps, null, 2));
  assert.deepEqual(
    steps.map((step) => step.step),
    ["configuration", "auth_reachable", "password_login", "session_verified", "teacher_role", "profile", "school_membership", "teacher_assignment", "rls_classes", "rls_enrollments", "schema_version", "session_refresh", "logout", "anonymous_denied"],
  );
});

test("teacher access comes from an active school membership, not app_metadata", async () => {
  await stack.db.query("update auth.users set raw_app_meta_data = '{}'::jsonb where id = $1", [LOCAL_TEACHER.id]);
  try {
    const steps = await run(LOCAL_TEACHER.email, LOCAL_TEACHER.password);
    assert.deepEqual(failed(steps), [], JSON.stringify(steps, null, 2));
    assert.match(steps.find((step) => step.step === "teacher_role")!.detail, /school_memberships/);
  } finally {
    await stack.db.query("update auth.users set raw_app_meta_data = '{\"role\":\"teacher\"}'::jsonb where id = $1", [LOCAL_TEACHER.id]);
  }
});

test("an inactive teacher membership is refused even if auth metadata says teacher", async () => {
  await stack.db.query("update public.school_memberships set status = 'disabled' where user_id = $1", [LOCAL_TEACHER.id]);
  try {
    const steps = await run(LOCAL_TEACHER.email, LOCAL_TEACHER.password);
    assert.deepEqual(failed(steps), ["teacher_role"]);
    assert.match(steps.at(-1)!.detail, /Aucune appartenance active/);
  } finally {
    await stack.db.query("update public.school_memberships set status = 'active' where user_id = $1", [LOCAL_TEACHER.id]);
  }
});

test("the former hard-coded credentials stop at the Supabase password step", async () => {
  const steps = await run("prof@focus.fr", "focus1234");
  assert.deepEqual(failed(steps), ["password_login"]);
  assert.match(steps.at(-1)!.detail, /aucun compte avec cette adresse, ou mot de passe différent/);
  assert.doesNotMatch(JSON.stringify(steps), /focus1234|prof@focus\.fr/);
});

test("a wrong password for a real teacher is reported the same way", async () => {
  assert.deepEqual(failed(await run(LOCAL_TEACHER.email, "wrong-password")), ["password_login"]);
});

test("a real account without an active teacher membership stops at the role step", async () => {
  const steps = await run(NON_TEACHER.email, NON_TEACHER.password);
  assert.deepEqual(failed(steps), ["teacher_role"]);
  assert.match(steps.at(-1)!.detail, /Aucune appartenance active/);
});

test("secret keys and another project are refused before any call", async () => {
  const serviceJwt = `x.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.y`;
  assert.ok(isPrivilegedKey(serviceJwt) && isPrivilegedKey("sb_secret_abc") && !isPrivilegedKey("sb_publishable_abc"));
  assert.deepEqual(failed(await run(LOCAL_TEACHER.email, LOCAL_TEACHER.password, { key: "sb_secret_x" })), ["configuration"]);
  assert.deepEqual(failed(await run(LOCAL_TEACHER.email, LOCAL_TEACHER.password, { projectRef: "wznqeofsvbutbvbyxfab" })), ["configuration"]);
  assert.equal(maskEmail("claire.martin@example.test"), "cl***********@example.test");
});
