import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { loadStudentAssessmentDetail } from "@/lib/student-data";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(value + "T12:00:00"));
}

export default async function StudentAssessmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const assessment = await loadStudentAssessmentDetail(id);
  if (!assessment) notFound();

  return (
    <div className="space-y-7">
      <Link
        href="/student/evaluations"
        className="inline-flex items-center gap-2 text-sm font-medium text-brand"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        Mes évaluations
      </Link>

      <header className="rounded-xl border border-border bg-white p-6 sm:p-7">
        <p className="text-sm font-medium text-brand">{assessment.subject}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          {assessment.title}
        </h1>
        <p className="mt-2 text-sm text-ink-soft">
          {formatDate(assessment.date)}
        </p>
        <div className="mt-6 border-t border-border pt-5">
          <p className="text-sm text-ink-soft">Votre résultat</p>
          <p className="mt-1 text-3xl font-semibold">
            {assessment.status === "graded"
              ? String(assessment.score) + "/20"
              : assessment.status === "absent"
                ? "Absent"
                : "En attente de correction"}
          </p>
        </div>
      </header>

      <section className="rounded-xl border border-border bg-white p-6">
        <h2 className="text-lg font-semibold">Retour du professeur</h2>
        {assessment.teacherComment ? (
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-ink-soft">
            {assessment.teacherComment}
          </p>
        ) : (
          <p className="mt-3 text-sm text-ink-soft">
            Aucun commentaire général n’a encore été saisi.
          </p>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold">Mes réponses enregistrées</h2>
        <p className="mt-1 text-sm text-ink-soft">
          FOCUS affiche uniquement les éléments auxquels votre compte élève a
          déjà accès. Les contenus réservés au professeur restent masqués.
        </p>
        <div className="mt-5 space-y-4">
          {assessment.responses.length ? (
            assessment.responses.map((response, index) => (
              <article
                key={response.id}
                className="rounded-xl border border-border bg-white p-5"
              >
                <div className="flex flex-wrap justify-between gap-3">
                  <h3 className="font-medium">Réponse {index + 1}</h3>
                  {response.awardedPoints !== null && (
                    <span className="text-sm font-medium text-ink-soft">
                      {response.awardedPoints} point
                      {response.awardedPoints > 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6">
                  {response.responseText}
                </p>
                {response.teacherAnnotation && (
                  <div className="mt-4 rounded-lg bg-paper p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                      Annotation du professeur
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm">
                      {response.teacherAnnotation}
                    </p>
                  </div>
                )}
              </article>
            ))
          ) : (
            <div className="rounded-xl border border-border bg-white p-6 text-sm text-ink-soft">
              Aucune réponse détaillée n’est encore disponible pour cette
              évaluation.
            </div>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-brand-soft p-5">
        <h2 className="font-semibold text-brand-ink">
          Analyse pédagogique FOCUS
        </h2>
        <p className="mt-2 text-sm leading-6 text-brand-ink">
          Cette partie restera masquée tant que le pipeline d’analyse et la
          validation professeur ne sont pas suffisamment fiabilisés. Aucune
          conclusion IA brute n’est présentée à l’élève.
        </p>
      </section>
    </div>
  );
}
