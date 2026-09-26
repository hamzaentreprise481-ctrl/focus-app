"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createAuthClient, clearAuthCookies } from "@/lib/auth/server";
import { loginError } from "@/lib/auth/errors";
import { isTeacher, safeNext } from "@/lib/auth/policy";
import {
  TEST_TEACHER_COOKIE,
  TEST_TEACHER_COOKIE_VALUE,
  TEST_TEACHER_EMAIL,
  TEST_TEACHER_PASSWORD,
  testTeacherLoginEnabled,
} from "@/lib/auth/test-login";

export async function login(
  _previous: { error: string } | null,
  form: FormData,
) {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (
    !email.includes("@") ||
    email.length > 254 ||
    !password ||
    password.length > 1024
  ) {
    return { error: "Renseignez votre adresse e-mail et votre mot de passe." };
  }
  if (testTeacherLoginEnabled() && email.toLowerCase() === TEST_TEACHER_EMAIL) {
    if (password !== TEST_TEACHER_PASSWORD)
      return { error: "Identifiants incorrects." };

    const cookieStore = await cookies();
    cookieStore.set(TEST_TEACHER_COOKIE, TEST_TEACHER_COOKIE_VALUE, {
      httpOnly: true,
      sameSite: "lax",
      secure: !!process.env.VERCEL,
      path: "/",
    });
    redirect("/app");
  }

  const supabase = await createAuthClient();
  if (!supabase)
    return {
      error:
        "La connexion professeur n’est pas encore disponible. Réessayez plus tard.",
    };
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error)
      return {
        error: loginError(error),
      };
    if (!isTeacher(data.user)) {
      try {
        await supabase.auth.signOut({ scope: "local" });
      } finally {
        await clearAuthCookies();
      }
      return {
        error: "Cet espace est réservé aux comptes professeurs autorisés.",
      };
    }
  } catch {
    return { error: "Le service de connexion est momentanément indisponible." };
  }
  redirect(safeNext(form.get("next")));
}

export async function logout() {
  const supabase = await createAuthClient();
  let providerFailed = false;
  try {
    if (supabase) {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      providerFailed = !!error;
    }
  } catch {
    providerFailed = true;
  } finally {
    await clearAuthCookies();
  }
  redirect(
    providerFailed
      ? "/connexion?deconnexion=locale"
      : "/connexion?deconnexion=1",
  );
}
