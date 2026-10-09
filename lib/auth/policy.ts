import type { SupabaseClient } from "@supabase/supabase-js";

type AuthenticatedUser = { id: string; is_anonymous?: boolean };
type MembershipRole = "admin" | "teacher" | "student" | "parent";

async function hasActiveMembership(
  supabase: SupabaseClient,
  user: AuthenticatedUser | null | undefined,
  role: MembershipRole,
): Promise<boolean> {
  if (!user || user.is_anonymous === true) return false;
  const { data, error } = await supabase
    .from("school_memberships")
    .select("id")
    .eq("user_id", user.id)
    .eq("role", role)
    .eq("status", "active")
    .limit(1);
  return !error && Array.isArray(data) && data.length > 0;
}

/**
 * Teacher authorization is derived from the canonical school membership row.
 * RLS allows an authenticated user to read their own membership, so this check
 * does not need a service-role key and cannot be forged through user metadata.
 */
export async function hasActiveTeacherMembership(
  supabase: SupabaseClient,
  user: AuthenticatedUser | null | undefined,
): Promise<boolean> {
  return hasActiveMembership(supabase, user, "teacher");
}

/** Student authorization follows the same canonical membership rule. */
export async function hasActiveStudentMembership(
  supabase: SupabaseClient,
  user: AuthenticatedUser | null | undefined,
): Promise<boolean> {
  return hasActiveMembership(supabase, user, "student");
}

/**
 * FOCUS Direction is the database role "admin": the RLS policies already give
 * an active school admin read access to their own school (is_school_admin),
 * so no new role or migration is needed. A teacher membership never grants it.
 */
export async function hasActiveDirectorMembership(
  supabase: SupabaseClient,
  user: AuthenticatedUser | null | undefined,
): Promise<boolean> {
  return hasActiveMembership(supabase, user, "admin");
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

function safePortalNext(
  value: unknown,
  root: "/app" | "/student" | "/director",
): string {
  if (typeof value !== "string" || /[\\\r\n\x00-\x1f]/.test(value))
    return root;
  try {
    const url = new URL(value, "https://focus.invalid");
    if (
      url.origin !== "https://focus.invalid" ||
      !(url.pathname === root || url.pathname.startsWith(root + "/"))
    )
      return root;
    // Reject encoded path characters to keep redirects unambiguous.
    if (/%/.test(url.pathname)) return root;
    return url.pathname + url.search + url.hash;
  } catch {
    return root;
  }
}

export function safeNext(value: unknown): string {
  return safePortalNext(value, "/app");
}

export function safeStudentNext(value: unknown): string {
  return safePortalNext(value, "/student");
}

export function safeDirectorNext(value: unknown): string {
  return safePortalNext(value, "/director");
}
