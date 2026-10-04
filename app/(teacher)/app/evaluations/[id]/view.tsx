"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { analyzeEvaluation } from "@/lib/analysis";
import { useSchoolData } from "@/lib/school-data-context";
import { Button } from "@/components/ui/button";
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/feedback";
import { DataLoadState } from "@/components/evaluations/data-load-state";
import { AssessmentEvidenceWorkspace } from "@/components/evaluations/assessment-evidence-workspace";
import { DeleteEvaluationButton } from "@/components/evaluations/delete-evaluation-button";
import { DistributionChart } from "@/components/evaluations/distribution-chart";
import { ExportPdfButton } from "@/components/reports/export-pdf-button";
import { formatDate, formatScore } from "@/lib/utils";

export default function EvaluationDetailPage({
  initialStudentId,
}: {
  initialStudentId?: string;
}) {
  const { id } = useParams<{ id: string }>();
  const { dataset, loaded, storageError, editableEvaluationIds } =
    useSchoolData();
  if (!loaded || storageError) return <DataLoadState />;
  if (!dataset.evaluations.some((e) => e.id === id))
    return (
      <EmptyState
        title="Évaluation introuvable dans votre espace"
        description="Cette évaluation n’existe pas dans les données auxquelles ce compte professeur a accès."
        action={
          <Button variant="secondary" asChild>
            <Link href="/app/evaluations">Retour aux évaluations</Link>
          </Button>
        }
      />
    );

  const analysis = analyzeEvaluation(id, dataset);
  const { evaluation } = analysis;
  const classInfo = dataset.classes.find((c) => c.id === evaluation.classId);
  const classStudents = dataset.students
    .filter((s) => s.classId === evaluation.classId)
    .map(({ id: studentId, name }) => ({ id: studentId, name }));
  return (
    <div className="space-y-6">
      <div>
        <Breadcrumbs
          items={[
            { label: "Accueil", href: "/app" },
            {
              label: classInfo?.name ?? "Classe",
              href: `/app/classes/${evaluation.classId}`,
            },
            { label: "Évaluation" },
          ]}
        />
        <PageHeader
          title={evaluation.name}
          description={`${formatDate(evaluation.date)} · ${classInfo?.name ?? "Classe"} · ${classInfo?.subject ?? ""}`}
          actions={<ExportPdfButton target={{ kind: "evaluation", id }} />}
        />
      </div>
      <AssessmentEvidenceWorkspace
        assessmentId={id}
        students={classStudents}
        initialStudentId={initialStudentId}
      />
      <details
        id="resultats"
        className="insights-disclosure scroll-mt-6 rounded-[var(--radius-lg)] border border-border bg-surface p-5"
      >
        <summary className="cursor-pointer font-semibold">
          Notes et compétences saisies{" "}
          <span className="ml-2 text-sm font-normal text-ink-soft">
            {analysis.recordedCount} / {classStudents.length} élèves renseignés
          </span>
        </summary>
        <div className="mt-5 space-y-6">
          <p className="text-sm text-ink-soft">
            Les notes et les niveaux ci-dessous ont été saisis par les
            enseignants. Les cases vides restent non renseignées ; les
            hypothèses sur les copies se décident séparément ci-dessus.
          </p>
          {editableEvaluationIds.includes(id) && (
            <div className="flex flex-wrap gap-3">
              <Button variant="secondary" asChild>
                <Link href={`/app/evaluations/${id}/modifier`}>
                  Compléter ou corriger les résultats
                </Link>
              </Button>
              <DeleteEvaluationButton
                evaluationId={id}
                evaluationName={evaluation.name}
                resultCount={analysis.recordedCount}
              />
            </div>
          )}
          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-sm text-ink-soft">Moyenne renseignée</dt>
              <dd className="mt-1 text-xl font-semibold">
                {analysis.average === null
                  ? "Aucune note"
                  : `${formatScore(analysis.average)} / 20`}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-ink-soft">Résultats hors absences</dt>
              <dd className="mt-1 text-xl font-semibold">
                {analysis.presentCount}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-ink-soft">Compétences renseignées</dt>
              <dd className="mt-1 text-sm">
                {evaluation.skillIds
                  .map((sid) => dataset.skills.find((s) => s.id === sid)?.name)
                  .filter(Boolean)
                  .join(" · ") || "Aucune compétence renseignée"}
              </dd>
            </div>
          </dl>
          {analysis.average !== null && (
            <div className="grid gap-6 lg:grid-cols-2">
              <section>
                <h2 className="mb-4 text-base font-semibold">
                  Distribution des notes
                </h2>
                <DistributionChart distribution={analysis.distribution} />
              </section>
              <section>
                <h2 className="text-base font-semibold">
                  Niveaux fragiles par compétence
                </h2>
                <p className="mt-1 text-sm text-ink-soft">
                  Niveaux fragiles ou non maîtrisés parmi les élèves évalués sur
                  cette compétence.
                </p>
                <ul className="mt-3 divide-y divide-border">
                  {analysis.skillBreakdown.map((skill) => (
                    <li
                      key={skill.skillId}
                      className="flex flex-wrap justify-between gap-2 py-3 text-sm"
                    >
                      <span>{skill.name}</span>
                      <span className="text-ink-soft">
                        {skill.weakPercent === null
                          ? "Données insuffisantes"
                          : `${skill.weakPercent}% · ${skill.sampleSize} élèves documentés`}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          )}
          {analysis.strugglingStudents.length > 0 && (
            <section>
              <h2 className="text-base font-semibold">
                Résultats à regarder de plus près
              </h2>
              <p className="mt-1 text-sm text-ink-soft">
                Indices issus des notes et des compétences saisies, à
                contextualiser avec les copies.
              </p>
              <ul className="mt-3 divide-y divide-border">
                {analysis.strugglingStudents.map((s) => (
                  <li
                    key={s.studentId}
                    className="flex items-start justify-between gap-3 py-3 text-sm"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/app/eleves/${s.studentId}`}
                        className="font-medium text-brand"
                      >
                        {s.name}
                      </Link>
                      <p className="mt-1 text-xs text-ink-soft">{s.reason}</p>
                    </div>
                    <span className="shrink-0 text-ink-soft">
                      {formatScore(s.score)} / 20
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {analysis.absentStudents.length > 0 && (
            <p className="text-sm text-ink-soft">
              Absences renseignées :{" "}
              {analysis.absentStudents.map((s) => s.name).join(", ")}. Aucun
              défaut de maîtrise n’est déduit de cette absence.
            </p>
          )}
        </div>
      </details>
    </div>
  );
}
