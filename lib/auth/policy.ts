/** Authorization uses provider-managed metadata, never user-editable metadata. */
export function isTeacher(
  user:
    | { app_metadata?: Record<string, unknown>; is_anonymous?: boolean }
    | null
    | undefined,
): boolean {
  return (
    !!user &&
    user.is_anonymous !== true &&
    user.app_metadata?.role === "teacher"
  );
}

export function safeNext(value: unknown): string {
  if (typeof value !== "string" || /[\\\r\n\x00-\x1f]/.test(value))
    return "/app";
  try {
    const url = new URL(value, "https://focus.invalid");
    if (
      url.origin !== "https://focus.invalid" ||
      !(url.pathname === "/app" || url.pathname.startsWith("/app/"))
    )
      return "/app";
    // Reject encoded path characters to keep redirects unambiguous.
    if (/%/.test(url.pathname)) return "/app";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/app";
  }
}
