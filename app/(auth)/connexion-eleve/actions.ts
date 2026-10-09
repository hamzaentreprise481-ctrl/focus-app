"use server";

import { redirect } from "next/navigation";
import { clearAuthCookies, createAuthClient } from "@/lib/auth/server";
import { loginError } from "@/lib/auth/errors";
import {
  hasActiveStudentMembership,
  safeStudentNext,
} from "@/lib/auth/policy";

export async function studentLogin(
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
      error: "La connexion élève n’est pas encore disponible. Réessayez plus tard.",
    };

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) return { error: loginError(error) };

    if (!(await hasActiveStudentMembership(supabase, data.user))) {
      try {
        await supabase.auth.signOut({ scope: "local" });
      } finally {
        await clearAuthCookies();
      }
      return {
        error: "Cet espace est réservé aux comptes élèves autorisés.",
      };
    }
  } catch {
    return { error: "Le service de connexion est momentanément indisponible." };
  }

  redirect(safeStudentNext(form.get("next")));
}

export async function studentLogout() {
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
      ? "/connexion-eleve?deconnexion=locale"
      : "/connexion-eleve?deconnexion=1",
  );
}
