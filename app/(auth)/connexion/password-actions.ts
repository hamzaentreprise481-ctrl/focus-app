"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clearAuthCookies, createAuthClient } from "@/lib/auth/server";
import { newPasswordError, passwordUpdateError, resetRequestError } from "@/lib/auth/password";
import { isTeacher } from "@/lib/auth/policy";

type State = { error?: string; sent?: boolean } | null;

/** The site's own origin for e-mail links (Supabase also checks its allow-list). */
async function siteOrigin() {
  const configured = process.env.FOCUS_SITE_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      /* fall back to the request */
    }
  }
  const list = await headers();
  const host = list.get("x-forwarded-host") ?? list.get("host") ?? "localhost";
  const proto = list.get("x-forwarded-proto") ?? (host.startsWith("127.0.0.1") || host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function requestPasswordReset(_previous: State, form: FormData): Promise<State> {
  const email = String(form.get("email") ?? "").trim();
  if (!email.includes("@") || email.length > 254) return { error: "Renseignez votre adresse e-mail professionnelle." };
  const supabase = await createAuthClient();
  if (!supabase) return { error: "L’espace professeur n’est pas encore disponible." };
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${await siteOrigin()}/auth/confirm?type=recovery`,
    });
    const message = error ? resetRequestError(error) : null;
    if (message) return { error: message };
  } catch {
    return { error: "Le service est momentanément indisponible. Réessayez dans quelques instants." };
  }
  // Same answer whether or not the address has an account.
  return { sent: true };
}

export async function setNewPassword(_previous: State, form: FormData): Promise<State> {
  const password = String(form.get("password") ?? "");
  const confirmation = String(form.get("confirmation") ?? "");
  const invalid = newPasswordError(password, confirmation);
  if (invalid) return { error: invalid };
  const supabase = await createAuthClient();
  if (!supabase) return { error: "L’espace professeur n’est pas encore disponible." };
  let teacher = false;
  try {
    const { data: current, error: sessionError } = await supabase.auth.getUser();
    if (sessionError || !current.user) return { error: "Le lien a expiré. Demandez un nouveau lien de réinitialisation." };
    const { data, error } = await supabase.auth.updateUser({ password });
    if (error) return { error: passwordUpdateError(error) };
    teacher = isTeacher(data.user);
    if (!teacher) {
      // The password is set, but access still depends on the administrator.
      try {
        await supabase.auth.signOut({ scope: "local" });
      } finally {
        await clearAuthCookies();
      }
      return {
        error:
          "Votre mot de passe est enregistré, mais ce compte n’a pas encore accès à l’espace professeur. Contactez la personne qui vous a invité.",
      };
    }
  } catch {
    return { error: "Le mot de passe n’a pas pu être enregistré. Réessayez dans quelques instants." };
  }
  redirect("/app?mot-de-passe=1");
}
