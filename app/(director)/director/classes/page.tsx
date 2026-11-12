import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requireDirector } from "@/lib/auth/server";
import { loadDirectorWorkspace } from "@/lib/director/data";
import {
  EmptyNote,
  Measure,
  PaceBadge,
  PageIntro,
} from "@/components/director/indicators";

export default async function DirectorClassesPage() {
  await requireDirector();
  const workspace = await loadDirectorWorkspace();

  return (
    <div>
      <PageIntro title="Classes">
        Chaque classe avec ses enseignants, ses matières et l’avancement
        déclaré et évalué par matière. Les élèves ne sont pas listés ici :
        les indicateurs sont agrégés.
      </PageIntro>
      {workspace.classes.length ? (
        <ul className="grid gap-4 lg:grid-cols-2">
          {workspace.classes.map((classRow) => (
            <li key={classRow.id}>
              <Link
                href={`/director/classes/${classRow.id}`}
                className="block h-full rounded-xl border border-border bg-white p-5 hover:border-border-strong"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold">{classRow.name}</h2>
                    <p className="mt-0.5 text-sm text-ink-soft">
                      {classRow.level ?? "Niveau non renseigné"} · {classRow.enrolled} élève
                      {classRow.enrolled > 1 ? "s" : ""}
                    </p>
                  </div>
                  <ArrowRight size={18} aria-hidden="true" className="mt-1 text-ink-soft" />
                </div>
                <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-ink-soft">Enseignants</dt>
                    <dd>{classRow.teacherNames.join(", ") || "Aucun enseignant affecté"}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-soft">Matières</dt>
                    <dd>{classRow.subjectNames.join(", ") || "Aucune matière"}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-soft">Compétences évaluées</dt>
                    <dd className="tabular-nums">{classRow.competenciesEvaluated}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-soft">Points de vigilance</dt>
                    <dd className="tabular-nums">{classRow.alerts.length}</dd>
                  </div>
                </dl>
                <div className="mt-4 space-y-3 border-t border-border pt-4">
                  {classRow.rows.length ? (
                    classRow.rows.map((row) => (
                      <div key={row.key} className="space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-medium">{row.subjectName}</span>
                          <PaceBadge pace={row.pace} />
                        </div>
                        <Measure
                          label="Programme enseigné"
                          part={row.referential.taught}
                          total={row.referential.total}
                          unit="compétences"
                        />
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-ink-soft">
                      Aucune matière n’est encore suivie dans FOCUS pour cette classe.
                    </p>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyNote>
          Aucune classe n’est enregistrée pour cet établissement. Les classes
          sont créées par l’administrateur FOCUS de l’établissement.
        </EmptyNote>
      )}
    </div>
  );
}
