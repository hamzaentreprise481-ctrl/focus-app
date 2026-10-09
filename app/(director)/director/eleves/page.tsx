import { StudentInviteForm } from "@/components/director/student-invite-form";
import { secretAdminConfigured } from "@/lib/auth/admin";
import { loadDirectorData } from "@/lib/director-data";

export default async function DirectorStudentsPage() {
  const data = await loadDirectorData();
  const provisioning = secretAdminConfigured();

  return (
    <div className="space-y-9">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-brand">ÉLÈVES</p>
        <h1 className="mt-2 text-3xl font-semibold">Suivi des élèves</h1>
        <p className="mt-3 text-ink-soft">
          Vue établissement. Les notes restent saisies par les professeurs, jamais par l’élève.
        </p>
      </header>

      <section className="rounded-xl border border-border bg-white p-6">
        <h2 className="text-lg font-semibold">Créer un accès Student</h2>
        <p className="mt-2 text-sm leading-6 text-ink-soft">
          FOCUS envoie une invitation : aucun mot de passe n’est choisi par la direction.
        </p>
        {!provisioning && (
          <p className="mt-4 rounded-lg bg-watch-soft p-4 text-sm leading-6 text-watch">
            Provisionnement désactivé tant que la clé serveur Supabase n’est pas configurée.
            Le reste du portail Student fonctionne sans cette clé.
          </p>
        )}
        <div className="mt-5">
          <StudentInviteForm classes={data.classOptions} enabled={provisioning} />
        </div>
      </section>

      <section className="overflow-x-auto rounded-xl border border-border bg-white">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-paper text-ink-soft">
            <tr>
              <th className="p-4 font-medium">Élève</th>
              <th className="p-4 font-medium">Classe</th>
              <th className="p-4 font-medium">Notes disponibles</th>
              <th className="p-4 font-medium">Moyenne observée</th>
              <th className="p-4 font-medium">Absences aux évaluations</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.students.map((row) => (
              <tr key={row.id}>
                <td className="p-4 font-medium">{row.name}</td>
                <td className="p-4">{row.className}</td>
                <td className="p-4">{row.gradesCount}</td>
                <td className="p-4 font-semibold">{row.average === null ? "—" : row.average.toFixed(1) + "/20"}</td>
                <td className="p-4">{row.absences}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
