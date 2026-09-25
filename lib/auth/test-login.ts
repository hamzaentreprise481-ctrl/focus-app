export const TEST_TEACHER_EMAIL = "prof@focus.fr";
export const TEST_TEACHER_PASSWORD = "focus1234";
export const TEST_TEACHER_COOKIE = "focus-test-professor";
export const TEST_TEACHER_COOKIE_VALUE = "focus-v1";

export function testTeacherLoginEnabled() {
  if (process.env.FOCUS_ENABLE_TEST_LOGIN === "1") return true;
  if (process.env.VERCEL_ENV) return process.env.VERCEL_ENV !== "production";
  return process.env.NODE_ENV !== "production";
}

export function isValidTestTeacherCookie(value: string | undefined) {
  return testTeacherLoginEnabled() && value === TEST_TEACHER_COOKIE_VALUE;
}
