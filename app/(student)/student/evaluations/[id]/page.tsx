import { requireStudent } from "@/lib/auth/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MessageCircleQuestion } from "lucide-react";
import { loadStudentAssessmentDetail } from "@/lib/student-data";

const LEVEL_LABEL = {
  mastered: "Maîtrisé",
  developing: "En cours d’acquisition",
  fragile: "Fragile",
  not_mastered: "Non maîtrisé",
} as const;

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
  await requireStudent();
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

      <section className="rounded-xl border border-border bg-white p-6">
        <h2 className="text-lg font-semibold">Compétences évaluées</h2>
        {assessment.competencies.length ? (
          <ul className="mt-3 divide-y divide-border">
            {assessment.competencies.map((competency) => (
              <li key={competency.name} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                <span>{competency.name}</span>
                <span className="font-medium">{LEVEL_LABEL[competency.level]}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-ink-soft">
            Aucun niveau de compétence n’a été saisi par le professeur pour
            cette évaluation.
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

      <Link
        href={`/student/assistant?evaluation=${assessment.id}`}
        className="flex items-center gap-3 rounded-xl border border-border bg-white p-5 hover:border-border-strong"
      >
        <MessageCircleQuestion size={20} aria-hidden="true" className="shrink-0 text-brand" />
        <span>
          <span className="block font-medium">Comprendre cette évaluation avec l’Assistant FOCUS</span>
          <span className="block text-sm text-ink-soft">
            Une aide pour revoir la notion ou t’entraîner. Elle ne modifie ni la
            note ni la correction.
          </span>
        </span>
      </Link>

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
