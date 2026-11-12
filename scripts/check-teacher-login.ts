// Real teacher login check, from any machine that can reach Supabase and the
// deployment. Prints one PASS/FAIL line per step; never prints the password,
// tokens, cookies, keys or row content.
//
//   FOCUS_CHECK_EMAIL=<teacher e-mail> FOCUS_CHECK_PASSWORD=<password> \
//   FOCUS_CHECK_SUPABASE_URL=https://<ref>.supabase.co FOCUS_CHECK_SUPABASE_KEY=<publishable key> \
//   FOCUS_CHECK_APP_URL=https://<deployment> [VERCEL_AUTOMATION_BYPASS_SECRET=…] \
//   npm run check:login -- [--project-ref <ref>]
//
// With the Supabase variables it checks Supabase Auth and RLS directly
// (login, getUser, app_metadata role, profile, assignments, RLS reads,
// schema version, refresh, logout, anonymous denial). With FOCUS_CHECK_APP_URL
// it drives the deployed app like a browser (login form, HttpOnly cookie,
// reload, teacher pages, logout, anonymous redirect). Either or both.

import { checkDeployedLogin } from "../lib/auth/deployed-login-check";
import { diagnoseTeacherLogin, type DiagnosisStep } from "../lib/auth/login-diagnosis";

function required(name: string) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}.`);
    process.exit(2);
  }
  return value;
}

function print(title: string, steps: DiagnosisStep[]) {
  console.log(`\n${title}`);
  for (const step of steps) console.log(`${step.ok ? "PASS" : "FAIL"} ${step.step.padEnd(22)} ${step.detail}`);
}

async function main() {
  const email = required("FOCUS_CHECK_EMAIL");
  const password = required("FOCUS_CHECK_PASSWORD");
  const refIndex = process.argv.indexOf("--project-ref");
  const supabaseUrl = process.env.FOCUS_CHECK_SUPABASE_URL;
  const supabaseKey = process.env.FOCUS_CHECK_SUPABASE_KEY;
  const appUrl = process.env.FOCUS_CHECK_APP_URL;
  if (!(supabaseUrl && supabaseKey) && !appUrl) {
    console.error("Set FOCUS_CHECK_SUPABASE_URL and FOCUS_CHECK_SUPABASE_KEY, FOCUS_CHECK_APP_URL, or both.");
    process.exit(2);
  }
  const results: DiagnosisStep[] = [];
  if (supabaseUrl && supabaseKey) {
    const steps = await diagnoseTeacherLogin({
      url: supabaseUrl,
      key: supabaseKey,
      email,
      password,
      projectRef: refIndex >= 0 ? process.argv[refIndex + 1] : undefined,
    });
    print("Supabase Auth and RLS", steps);
    results.push(...steps);
  }
  if (appUrl) {
    const steps = await checkDeployedLogin({ origin: appUrl, email, password, bypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET });
    print(`Deployed app (${new URL(appUrl).origin})`, steps);
    results.push(...steps);
  }
  process.exit(results.every((step) => step.ok) ? 0 : 1);
}

main().catch(() => {
  console.error("The check could not run (network or unexpected error).");
  process.exit(1);
});
