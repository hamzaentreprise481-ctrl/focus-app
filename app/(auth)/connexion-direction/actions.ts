"use server";

import { redirect } from "next/navigation";
import { clearAuthCookies, createAuthClient } from "@/lib/auth/server";
import { loginError } from "@/lib/auth/errors";
import {
  hasActiveDirectorMembership,
  safeDirectorNext,
} from "@/lib/auth/policy";

export async function directorLogin(
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

  const supabase = await createAuthClient();
  if (!supabase)
    return {
      error: "La connexion direction n’est pas encore disponible.",
    };

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) return { error: loginError(error) };

    if (!(await hasActiveDirectorMembership(supabase, data.user))) {
      try {
        await supabase.auth.signOut({ scope: "local" });
      } finally {
        await clearAuthCookies();
      }
      return {
        error: "Cet espace est réservé aux comptes de direction autorisés.",
      };
    }
  } catch {
    return { error: "Le service de connexion est momentanément indisponible." };
  }

  redirect(safeDirectorNext(form.get("next")));
}

export async function directorLogout() {
  const supabase = await createAuthClient();
  try {
    if (supabase) await supabase.auth.signOut({ scope: "local" });
  } finally {
    await clearAuthCookies();
  }
  redirect("/connexion-direction?deconnexion=1");
}
