import { test } from "node:test";
import assert from "node:assert/strict";
import { emailLinkType, newPasswordError, passwordUpdateError, resetRequestError } from "../lib/auth/password";

test("new passwords: length, variety, confirmation", () => {
  assert.match(newPasswordError("court", "court")!, /12 caractères/);
  assert.match(newPasswordError("x".repeat(129), "x".repeat(129))!, /128/);
  assert.match(newPasswordError("abababababababab", "abababababababab")!, /trop simple/);
  assert.match(newPasswordError("une phrase assez longue", "une phrase assez longu")!, /pas identiques/);
  assert.equal(newPasswordError("une phrase assez longue", "une phrase assez longue"), null);
});

test("provider errors become actionable messages; unknown addresses stay neutral", () => {
  assert.match(passwordUpdateError({ code: "same_password" }), /différent/);
  assert.match(passwordUpdateError({ code: "weak_password" }), /fuite/);
  assert.match(passwordUpdateError({ status: 429 }), /Patientez/);
  assert.match(passwordUpdateError({ status: 401 }), /expiré/);
  assert.equal(resetRequestError({ code: "user_not_found", status: 400 }), null);
  assert.match(resetRequestError({ code: "over_email_send_rate_limit", status: 429 })!, /Patientez/);
  assert.match(resetRequestError({ status: 503 })!, /indisponible/);
});

test("only recovery and invitation links are accepted", () => {
  assert.equal(emailLinkType("recovery"), "recovery");
  assert.equal(emailLinkType("invite"), "invite");
  for (const value of ["signup", "magiclink", "email_change", "", null, undefined]) assert.equal(emailLinkType(value), null);
});

test("an invitation needs the confirmed project, an HTTPS site, an address and three ids", async () => {
  const { parseInviteArgs } = await import("../lib/auth/invite-plan");
  const env = { SUPABASE_URL: "https://abcd1234.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "fixture", FOCUS_SITE_URL: "https://focus.example.test/x" };
  const ids = ["--school", "11111111-1111-4111-8111-111111111111", "--class", "22222222-2222-4222-8222-222222222222", "--subject", "33333333-3333-4333-8333-333333333333"];
  const ok = parseInviteArgs(["--project-ref", "abcd1234", "--email", "Teacher-A@Example.test", ...ids], env);
  assert.ok("plan" in ok);
  assert.equal(ok.plan.email, "teacher-a@example.test");
  assert.equal(ok.plan.siteUrl, "https://focus.example.test");
  assert.equal(ok.plan.commit, false, "dry run by default");
  const cases: Array<[string[], Record<string, string | undefined>, RegExp]> = [
    [["--project-ref", "other", "--email", "a@b.co", ...ids], env, /--project-ref abcd1234/],
    [["--project-ref", "abcd1234", "--email", "a@b.co", ...ids], { ...env, SUPABASE_SERVICE_ROLE_KEY: undefined }, /SERVICE_ROLE_KEY/],
    [["--project-ref", "abcd1234", "--email", "a@b.co", ...ids], { ...env, FOCUS_SITE_URL: "http://focus.example.test" }, /HTTPS/],
    [["--project-ref", "abcd1234", "--email", "not-an-email", ...ids], env, /--email/],
    [["--project-ref", "abcd1234", "--email", "a@b.co", "--school", "x", "--class", ids[3], "--subject", ids[5]], env, /--school/],
  ];
  for (const [argv, values, message] of cases) {
    const result = parseInviteArgs(argv, values);
    assert.ok("error" in result && message.test(result.error), JSON.stringify(result));
  }
});
