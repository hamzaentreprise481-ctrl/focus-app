"use server";

import { redirect } from "next/navigation";
import { createAuthClient } from "@/lib/auth/server";
import { isTeacher, safeNext } from "@/lib/auth/policy";

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
        error:
          "Connexion impossible. Vérifiez vos identifiants ou réessayez dans quelques instants.",
      };
    if (!isTeacher(data.user)) {
      await supabase.auth.signOut({ scope: "local" });
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
  if (supabase) await supabase.auth.signOut({ scope: "local" });
  redirect("/connexion?deconnexion=1");
}
