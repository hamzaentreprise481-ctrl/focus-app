import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import { redirect } from "next/navigation";
import { authConfig } from "./config";
import {
  hasActiveDirectorMembership,
  hasActiveStudentMembership,
  hasActiveTeacherMembership,
} from "./policy";

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

async function authenticatedUser() {
  const supabase = await createAuthClient();
  if (!supabase) return { supabase: null, user: null };
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    return { supabase, user: error ? null : user };
  } catch {
    return { supabase, user: null };
  }
}

export const getTeacher = cache(async () => {
  const { supabase, user } = await authenticatedUser();
  if (!supabase || !user) return null;
  return (await hasActiveTeacherMembership(supabase, user)) ? user : null;
});

export const getStudent = cache(async () => {
  const { supabase, user } = await authenticatedUser();
  if (!supabase || !user) return null;
  return (await hasActiveStudentMembership(supabase, user)) ? user : null;
});

export const getDirector = cache(async () => {
  const { supabase, user } = await authenticatedUser();
  if (!supabase || !user) return null;
  return (await hasActiveDirectorMembership(supabase, user)) ? user : null;
});

export async function requireTeacher() {
  const teacher = await getTeacher();
  if (!teacher) redirect("/connexion");
  return teacher;
}

export async function requireStudent() {
  const student = await getStudent();
  if (!student) redirect("/connexion-eleve");
  return student;
}

export async function requireDirector() {
  const director = await getDirector();
  if (!director) redirect("/connexion-direction");
  return director;
}

export async function clearAuthCookies() {
  const cookieStore = await cookies();
  const config = authConfig();
  if (!config) return;
  const prefix = "sb-" + new URL(config.url).hostname.split(".")[0] + "-auth-token";
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
