import { requireDirector } from "@/lib/auth/server";
import { loadDirectorWorkspace } from "@/lib/director/data";
import {
  EmptyNote,
  Measure,
  PaceBadge,
  PageIntro,
} from "@/components/director/indicators";

export default async function DirectorTeachersPage() {
  await requireDirector();
  const workspace = await loadDirectorWorkspace();

  return (
    <div>
      <PageIntro title="Professeurs">
        Indicateurs opérationnels par enseignant : affectations, programme
        déclaré et évalué, données à compléter. FOCUS ne classe pas les
        enseignants et n’utilise pas les notes des élèves pour les comparer.
      </PageIntro>
      {workspace.teachers.length ? (
        <ul className="space-y-4">
          {workspace.teachers.map((teacher) => (
            <li key={teacher.id} className="rounded-xl border border-border bg-white p-5">
              <h2 className="text-lg font-semibold">{teacher.name}</h2>
              <p className="mt-0.5 text-sm text-ink-soft">
                {teacher.classNames.length
                  ? `${teacher.classNames.join(", ")} · ${teacher.subjectNames.join(", ")}`
                  : "Aucune classe affectée"}
              </p>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-ink-soft">Évaluations enregistrées</dt>
                  <dd className="tabular-nums">
                    {teacher.assessments} · dont {teacher.documentedAssessments} avec résultats saisis
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-soft">Séances déclarées</dt>
                  <dd className="tabular-nums">{teacher.lessons}</dd>
                </div>
                <div>
                  <dt className="text-ink-soft">Données à compléter</dt>
                  <dd>
                    {teacher.missing.assessmentsWithoutResults +
                      teacher.missing.assessmentsUnlinked +
                      teacher.missing.rowsWithoutLessons ===
                    0 ? (
                      "Aucune"
                    ) : (
                      <ul className="space-y-0.5">
                        {teacher.missing.assessmentsWithoutResults > 0 && (
                          <li>{teacher.missing.assessmentsWithoutResults} évaluation(s) sans résultat saisi</li>
                        )}
                        {teacher.missing.assessmentsUnlinked > 0 && (
                          <li>{teacher.missing.assessmentsUnlinked} évaluation(s) non reliée(s) au programme</li>
                        )}
                        {teacher.missing.rowsWithoutLessons > 0 && (
                          <li>{teacher.missing.rowsWithoutLessons} classe(s) sans séance déclarée</li>
                        )}
                      </ul>
                    )}
                  </dd>
                </div>
              </dl>
              {teacher.rows.length > 0 && (
                <div className="mt-4 space-y-4 border-t border-border pt-4">
                  {teacher.rows.map((row) => (
                    <div key={row.key} className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium">
                          {row.className} · {row.subjectName}
                        </span>
                        <PaceBadge pace={row.pace} />
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <Measure
                          label="Programme enseigné (déclaré)"
                          part={row.referential.taught}
                          total={row.referential.total}
                          unit="compétences"
                        />
                        <Measure
                          label="Programme restant"
                          part={Math.max(0, row.referential.total - row.referential.taught)}
                          total={row.referential.total}
                          unit="compétences"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyNote>Aucun professeur actif n’est rattaché à cet établissement.</EmptyNote>
      )}
    </div>
  );
}
