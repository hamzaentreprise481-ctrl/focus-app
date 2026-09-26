import { createAuthClient, requireTeacher } from "@/lib/auth/server";
import { teacherDisplayName } from "@/lib/supabase-school-data";

type AssignmentRow = {
  class: { name: string; level: string | null } | null;
  subject: { name: string } | null;
  school: { name: string } | null;
};

async function loadAccount(teacherId: string) {
  const supabase = await createAuthClient();
  if (!supabase) return null;
  const [profile, assignments] = await Promise.all([
    supabase.from("profiles").select("first_name,last_name").eq("id", teacherId).maybeSingle(),
    supabase
      .from("teacher_assignments")
      .select("class:classes(name,level),subject:subjects(name),school:schools(name)")
      .eq("teacher_id", teacherId),
  ]);
  if (profile.error || assignments.error) return null;
  const row = profile.data as { first_name: string | null; last_name: string | null } | null;
  return {
    name:
      [row?.first_name, row?.last_name]
        .filter((value): value is string => !!value?.trim())
        .join(" ") || null,
    assignments: (assignments.data ?? []) as unknown as AssignmentRow[],
  };
}

export default async function ParametresPage() {
  const teacher = await requireTeacher();
  const account = await loadAccount(teacher.id);
  const schools = [
    ...new Set(
      (account?.assignments ?? [])
        .map((row) => row.school?.name)
        .filter((value): value is string => !!value),
    ),
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Paramètres</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Votre compte et vos affectations, tels qu’enregistrés par votre établissement.
        </p>
      </div>

      {!account && (
        <p role="alert" className="rounded-lg border border-border bg-surface p-4 text-sm">
          Impossible de lire votre compte pour le moment. Rechargez la page ; si le problème
          persiste, contactez la personne qui a ouvert votre accès.
        </p>
      )}

      <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-5">
        <h2 className="text-[15px] font-semibold text-ink">Compte</h2>
        <dl className="mt-4 space-y-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
            <dt className="text-ink-soft">Nom</dt>
            <dd className="font-medium text-ink">{account?.name ?? teacherDisplayName(teacher)}</dd>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
            <dt className="text-ink-soft">Adresse e-mail</dt>
            <dd className="font-medium text-ink">{"email" in teacher && teacher.email ? teacher.email : "—"}</dd>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <dt className="text-ink-soft">Établissement</dt>
            <dd className="font-medium text-ink">{schools.length ? schools.join(", ") : "Aucun établissement affecté"}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-5">
        <h2 className="text-[15px] font-semibold text-ink">Classes et matières</h2>
        {account && account.assignments.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">
            Aucune classe n’est encore affectée à ce compte. Les affectations sont gérées par
            l’administration de votre établissement.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border text-sm">
            {(account?.assignments ?? []).map((row, index) => (
              <li key={index} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="font-medium text-ink">
                  {row.class?.name ?? "Classe"}
                  {row.class?.level ? ` · ${row.class.level}` : ""}
                </span>
                <span className="text-ink-soft">{row.subject?.name ?? "Matière"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-5">
        <h2 className="text-[15px] font-semibold text-ink">Mot de passe et accès</h2>
        <p className="mt-2 text-sm text-ink-soft">
          Les comptes professeurs sont ouverts par l’équipe FOCUS. Pour changer de mot de passe
          ou modifier une affectation, contactez la personne qui vous a invité.
        </p>
      </section>
    </div>
  );
}
