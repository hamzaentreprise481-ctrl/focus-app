"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createSecretAdminClient } from "@/lib/auth/admin";
import { createAuthClient, requireDirector } from "@/lib/auth/server";

type State = { ok?: boolean; error?: string } | null;

async function origin() {
  const configured = process.env.FOCUS_SITE_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      /* fall back to the request */
    }
  }
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const proto =
    h.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");
  return proto + "://" + host;
}

export async function inviteStudent(
  _previous: State,
  form: FormData,
): Promise<State> {
  const director = await requireDirector();
  const firstName = String(form.get("first_name") ?? "").trim();
  const lastName = String(form.get("last_name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const classId = String(form.get("class_id") ?? "").trim();

  if (!firstName || !lastName || firstName.length > 80 || lastName.length > 80)
    return { error: "Renseignez le prénom et le nom de l’élève." };
  if (!email.includes("@") || email.length > 254)
    return { error: "Adresse e-mail invalide." };
  if (!/^[0-9a-f-]{36}$/i.test(classId))
    return { error: "Classe invalide." };

  const admin = createSecretAdminClient();
  if (!admin)
    return {
      error:
        "La création de comptes est désactivée : SUPABASE_SECRET_KEY n’est pas configurée sur le serveur.",
    };

  const supabase = await createAuthClient();
  if (!supabase) return { error: "FOCUS n’est pas configuré." };

  const membershipResponse = await supabase
    .from("school_memberships")
    .select("school_id")
    .eq("user_id", director.id)
    .eq("role", "admin")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (membershipResponse.error || !membershipResponse.data)
    return { error: "Aucun établissement de direction actif." };

  const schoolId = (membershipResponse.data as { school_id: string }).school_id;
  const classResponse = await supabase
    .from("classes")
    .select("id,school_id,academic_year_id")
    .eq("id", classId)
    .eq("school_id", schoolId)
    .maybeSingle();
  if (classResponse.error || !classResponse.data)
    return { error: "Cette classe n’appartient pas à votre établissement." };

  const classRow = classResponse.data as {
    id: string;
    school_id: string;
    academic_year_id: string;
  };

  const { data: invited, error: inviteError } =
    await admin.auth.admin.inviteUserByEmail(email, {
      data: { display_name: firstName + " " + lastName },
      redirectTo: (await origin()) + "/auth/confirm?type=invite",
    });

  if (inviteError || !invited.user) {
    const message = inviteError?.message?.toLowerCase() ?? "";
    return {
      error: message.includes("already")
        ? "Un compte existe déjà avec cette adresse e-mail."
        : "L’invitation n’a pas pu être créée.",
    };
  }

  const userId = invited.user.id;
  const rollback = async () => {
    try {
      await admin.auth.admin.deleteUser(userId);
    } catch {
      /* best-effort rollback */
    }
  };

  const profile = await admin.from("profiles").insert({
    id: userId,
    first_name: firstName,
    last_name: lastName,
  });
  if (profile.error) {
    await rollback();
    return { error: "Le profil élève n’a pas pu être créé." };
  }

  const membership = await admin.from("school_memberships").insert({
    school_id: schoolId,
    user_id: userId,
    role: "student",
    status: "active",
  });
  if (membership.error) {
    await rollback();
    return { error: "Le rôle élève n’a pas pu être attribué." };
  }

  const enrollment = await admin.from("student_enrollments").insert({
    school_id: schoolId,
    student_id: userId,
    class_id: classRow.id,
    academic_year_id: classRow.academic_year_id,
  });
  if (enrollment.error) {
    await rollback();
    return { error: "L’inscription de l’élève à la classe a échoué." };
  }

  revalidatePath("/director");
  revalidatePath("/director/eleves");
  return { ok: true };
}
