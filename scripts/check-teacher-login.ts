// Diagnose a teacher login against the real Supabase project, from any
// machine that can reach it. Uses the publishable key only and prints one
// PASS/FAIL line per step of the app's flow; never prints the password,
// tokens, keys or row content.
//
//   FOCUS_CHECK_SUPABASE_URL=https://<ref>.supabase.co \
//   FOCUS_CHECK_SUPABASE_KEY=<publishable key> \
//   FOCUS_CHECK_EMAIL=<teacher e-mail> FOCUS_CHECK_PASSWORD=<password> \
//   npm run check:login -- [--project-ref <ref>]

import { diagnoseTeacherLogin } from "../lib/auth/login-diagnosis";

function required(name: string) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}.`);
    process.exit(2);
  }
  return value;
}

async function main() {
  const refIndex = process.argv.indexOf("--project-ref");
  const steps = await diagnoseTeacherLogin({
    url: required("FOCUS_CHECK_SUPABASE_URL"),
    key: required("FOCUS_CHECK_SUPABASE_KEY"),
    email: required("FOCUS_CHECK_EMAIL"),
    password: required("FOCUS_CHECK_PASSWORD"),
    projectRef: refIndex >= 0 ? process.argv[refIndex + 1] : undefined,
  });
  for (const step of steps) console.log(`${step.ok ? "PASS" : "FAIL"} ${step.step.padEnd(18)} ${step.detail}`);
  process.exit(steps.every((step) => step.ok) ? 0 : 1);
}

main().catch(() => {
  console.error("The check could not run (network or unexpected error).");
  process.exit(1);
});
