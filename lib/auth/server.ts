import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import { redirect } from "next/navigation";
import { authConfig } from "./config";
import { isTeacher } from "./policy";

export async function createAuthClient() {
  const config = authConfig();
  if (!config) return null;
  const cookieStore = await cookies();
  return createServerClient(config.url, config.key, {
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: !!process.env.VERCEL || config.url.startsWith("https:"),
      path: "/",
    },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(values) {
        // Server Components cannot write cookies; proxy refreshes them first.
        try {
          values.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          /* read-only render */
        }
      },
    },
  });
}

export const getTeacher = cache(async () => {
  const supabase = await createAuthClient();
  if (!supabase) return null;
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    return !error && isTeacher(user) ? user : null;
  } catch {
    return null;
  }
});

/** Call again in every future server data reader and mutation, not only layouts. */
export async function requireTeacher() {
  const teacher = await getTeacher();
  if (!teacher) redirect("/connexion");
  return teacher;
}

/** Only called by server actions; also clears chunked cookies after provider errors. */
export async function clearAuthCookies() {
  const cookieStore = await cookies();
  const config = authConfig();
  if (!config) return;
  const prefix = `sb-${new URL(config.url).hostname.split(".")[0]}-auth-token`;
  for (const cookie of cookieStore.getAll()) {
    if (
      cookie.name === prefix ||
      (cookie.name.startsWith(prefix + ".") &&
        /^\d+$/.test(cookie.name.slice(prefix.length + 1)))
    ) {
      cookieStore.set(cookie.name, "", {
        maxAge: 0,
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: !!process.env.VERCEL || config.url.startsWith("https:"),
      });
    }
  }
}
