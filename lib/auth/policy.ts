import type { SupabaseClient } from "@supabase/supabase-js";

type AuthenticatedUser = { id: string; is_anonymous?: boolean };

/**
 * Teacher authorization is derived from the canonical school membership row.
 * RLS allows an authenticated user to read their own membership, so this check
 * does not need a service-role key and cannot be forged through user metadata.
 */
export async function hasActiveTeacherMembership(
  supabase: SupabaseClient,
  user: AuthenticatedUser | null | undefined,
): Promise<boolean> {
  if (!user || user.is_anonymous === true) return false;
  const { data, error } = await supabase
    .from("school_memberships")
    .select("id")
    .eq("user_id", user.id)
    .eq("role", "teacher")
    .eq("status", "active")
    .limit(1);
  return !error && Array.isArray(data) && data.length > 0;
}

/** @deprecated Metadata is not the authorization source of truth. */
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
