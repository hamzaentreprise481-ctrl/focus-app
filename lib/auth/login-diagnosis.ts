// Step-by-step diagnosis of a teacher login against a real Supabase project,
// with the publishable key only: the same calls the app makes (password
// grant, server-verified getUser, active teacher membership, profile, RLS reads,
// refresh, logout). Reports what failed and where; never returns a token,
// key, password or row content.

import { createClient } from "@supabase/supabase-js";

export interface DiagnosisStep {
  step: string;
  ok: boolean;
  detail: string;
}

export interface DiagnosisInput {
  url: string;
  key: string;
  email: string;
  password: string;
  /** Expected project ref (subdomain); refuses to run against another project. */
  projectRef?: string;
}

export function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!domain) return "(adresse invalide)";
  return `${local.slice(0, 2)}${"*".repeat(Math.max(1, local.length - 2))}@${domain}`;
}

/** A secret or service-role key must never be used for this check. */
export function isPrivilegedKey(key: string) {
  if (key.startsWith("sb_secret_")) return true;
  const parts = key.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { role?: string };
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

export async function diagnoseTeacherLogin(input: DiagnosisInput): Promise<DiagnosisStep[]> {
  const steps: DiagnosisStep[] = [];
  const add = (step: string, ok: boolean, detail: string) => {
    steps.push({ step, ok, detail });
    return ok;
  };

  let origin: URL;
  try {
    origin = new URL(input.url);
  } catch {
    add("configuration", false, "L’URL Supabase n’est pas une URL valide.");
    return steps;
  }
  if (isPrivilegedKey(input.key)) {
    add("configuration", false, "Clé secrète ou service_role refusée : utiliser la clé publiable (celle de NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).");
    return steps;
  }
  if (input.projectRef && origin.hostname.split(".")[0] !== input.projectRef) {
    add("configuration", false, `L’URL vise le projet « ${origin.hostname.split(".")[0]} », pas « ${input.projectRef} ».`);
    return steps;
  }
  add("configuration", true, `Projet ${origin.hostname}, clé publiable.`);

  try {
    const health = await fetch(new URL("/auth/v1/health", origin), { headers: { apikey: input.key } });
    if (!add("auth_reachable", health.ok, health.ok ? "Supabase Auth répond." : `Supabase Auth répond ${health.status} (clé ou URL incorrecte ?).`))
      return steps;
  } catch {
    add("auth_reachable", false, "Supabase Auth est injoignable depuis cette machine.");
    return steps;
  }

  const client = () => createClient(input.url, input.key, { auth: { persistSession: false, autoRefreshToken: false } });
  const supabase = client();
  const { data: signIn, error: signInError } = await supabase.auth.signInWithPassword({ email: input.email, password: input.password });
  if (signInError || !signIn.session) {
    // Older Auth API versions only carry the reason in the message.
    const code =
      signInError?.code ??
      (signInError && /invalid login credentials/i.test(signInError.message) ? "invalid_credentials" : signInError ? `http_${signInError.status}` : "no_session");
    const detail =
      code === "invalid_credentials"
        ? `Supabase refuse ${maskEmail(input.email)} : aucun compte avec cette adresse, ou mot de passe différent (Supabase ne distingue pas les deux).`
        : code === "email_not_confirmed"
          ? "Le compte existe mais son adresse n’est pas confirmée."
          : `Connexion refusée par Supabase (${code}).`;
    add("password_login", false, detail);
    return steps;
  }
  add("password_login", true, `Session créée pour ${maskEmail(input.email)}.`);

  const { data: verified, error: userError } = await supabase.auth.getUser(signIn.session.access_token);
  if (!add("session_verified", !userError && !!verified.user, userError ? `getUser refusé (${userError.code ?? userError.status}).` : "getUser() vérifie la session côté Auth."))
    return steps;
  const user = verified.user!;

  const { count: activeTeacherMemberships, error: teacherMembershipError } = await supabase
    .from("school_memberships")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("role", "teacher")
    .eq("status", "active");
  if (
    !add(
      "teacher_role",
      !teacherMembershipError && (activeTeacherMemberships ?? 0) > 0,
      teacherMembershipError
        ? `Lecture du rôle professeur refusée (${teacherMembershipError.code ?? "error"}).`
        : (activeTeacherMemberships ?? 0) > 0
          ? "Rôle professeur actif confirmé dans school_memberships."
          : "Aucune appartenance active avec role = teacher : l’application refuse ce compte.",
    )
  )
    return steps;

  const count = async (table: string, column: string, value?: string) => {
    let query = supabase.from(table).select(column, { count: "exact", head: true });
    if (value) query = query.eq(column, value);
    const { count: rows, error } = await query;
    return error ? { rows: null, code: error.code ?? "error" } : { rows: rows ?? 0, code: null };
  };

  const profile = await count("profiles", "id", user.id);
  add("profile", profile.rows === 1, profile.code ? `Lecture du profil refusée (${profile.code}).` : profile.rows === 1 ? "Profil lu." : "Aucune ligne profiles pour ce compte.");
  const memberships = await count("school_memberships", "user_id", user.id);
  add(
    "school_membership",
    (memberships.rows ?? 0) > 0,
    memberships.code ? `Lecture refusée (${memberships.code}).` : `${memberships.rows} appartenance(s) à un établissement.`,
  );
  const assignments = await count("teacher_assignments", "teacher_id", user.id);
  add(
    "teacher_assignment",
    (assignments.rows ?? 0) > 0,
    assignments.code ? `Lecture refusée (${assignments.code}).` : `${assignments.rows} affectation(s) classe/matière.`,
  );
  const classes = await count("classes", "id");
  add("rls_classes", (classes.rows ?? 0) > 0, classes.code ? `Lecture refusée (${classes.code}).` : `${classes.rows} classe(s) visible(s) sous RLS.`);
  const enrollments = await count("student_enrollments", "id");
  add("rls_enrollments", enrollments.rows !== null, enrollments.code ? `Lecture refusée (${enrollments.code}).` : `${enrollments.rows} inscription(s) d’élèves visible(s).`);

  const schema = await supabase.rpc("focus_schema_version");
  add(
    "schema_version",
    !schema.error,
    schema.error ? "focus_schema_version() absente : les migrations de la V1 ne sont pas appliquées sur ce projet." : `Schéma ${String(schema.data)}.`,
  );

  const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession({ refresh_token: signIn.session.refresh_token });
  add("session_refresh", !refreshError && !!refreshed.session, refreshError ? `Rafraîchissement refusé (${refreshError.code ?? refreshError.status}).` : "La session se renouvelle (survit à un rechargement).");

  const refreshToken = refreshed.session?.refresh_token ?? signIn.session.refresh_token;
  const { error: logoutError } = await supabase.auth.signOut({ scope: "global" });
  const reuse = await client().auth.refreshSession({ refresh_token: refreshToken });
  add(
    "logout",
    !logoutError && !!reuse.error,
    logoutError ? `Déconnexion refusée (${logoutError.code ?? logoutError.status}).` : reuse.error ? "Déconnexion : le jeton de renouvellement est révoqué." : "Le jeton reste utilisable après déconnexion.",
  );

  const anonymous = client();
  const { data: anonRows, error: anonError } = await anonymous.from("classes").select("id").limit(1);
  add("anonymous_denied", !!anonError || (anonRows ?? []).length === 0, "Sans session, aucune classe n’est lisible.");
  return steps;
}
