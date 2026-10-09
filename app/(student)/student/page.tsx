import Link from "next/link";
import { ArrowRight, ClipboardCheck, TrendingUp } from "lucide-react";
import {
  loadStudentAssessments,
  loadStudentIdentity,
  loadStudentProgress,
} from "@/lib/student-data";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(value + "T12:00:00"));
}

export default async function StudentHomePage() {
  const [identity, assessments, progress] = await Promise.all([
    loadStudentIdentity(),
    loadStudentAssessments(),
    loadStudentProgress(),
  ]);
  const recent = assessments.slice(0, 3);
  const graded = assessments.filter((item) => item.status === "graded");
  const mastered = progress.filter((item) => item.level === "mastered").length;

  return (
    <div className="space-y-9">
      <section>
        <p className="text-xs font-semibold uppercase tracking-widest text-brand">
          Votre espace
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Bonjour {identity.name}.
        </h1>
        <p className="mt-3 max-w-2xl text-ink-soft">
          Consultez ce qui a été saisi et validé par vos professeurs. FOCUS
          n’affiche pas ici de conclusion brute générée par l’IA.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-white p-5">
          <p className="text-sm text-ink-soft">Évaluations corrigées</p>
          <p className="mt-2 text-3xl font-semibold">{graded.length}</p>
        </div>
        <div className="rounded-xl border border-border bg-white p-5">
          <p className="text-sm text-ink-soft">Compétences suivies</p>
          <p className="mt-2 text-3xl font-semibold">{progress.length}</p>
        </div>
        <div className="rounded-xl border border-border bg-white p-5">
          <p className="text-sm text-ink-soft">Compétences maîtrisées</p>
          <p className="mt-2 text-3xl font-semibold">{mastered}</p>
        </div>
      </section>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Dernières évaluations</h2>
            <p className="mt-1 text-sm text-ink-soft">
              Les évaluations passées de votre classe, avec votre résultat
              lorsqu’il est disponible.
            </p>
          </div>
          <Link
            href="/student/evaluations"
            className="text-sm font-medium text-brand"
          >
            Tout voir →
          </Link>
        </div>

        <div className="mt-5 divide-y divide-border rounded-xl border border-border bg-white">
          {recent.length ? (
            recent.map((assessment) => (
              <Link
                key={assessment.id}
                href={"/student/evaluations/" + assessment.id}
                className="flex items-center justify-between gap-4 p-5 hover:bg-paper"
              >
                <div className="min-w-0">
                  <p className="font-medium">{assessment.title}</p>
                  <p className="mt-1 text-sm text-ink-soft">
                    {assessment.subject} · {formatDate(assessment.date)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-4">
                  <span className="text-sm font-semibold">
                    {assessment.status === "graded"
                      ? String(assessment.score) + "/20"
                      : assessment.status === "absent"
                        ? "Absent"
                        : "En attente"}
                  </span>
                  <ArrowRight size={17} aria-hidden="true" />
                </div>
              </Link>
            ))
          ) : (
            <div className="p-6 text-sm text-ink-soft">
              Aucune évaluation passée n’est encore disponible.
            </div>
          )}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Link
          href="/student/evaluations"
          className="rounded-xl border border-border bg-white p-5 hover:border-border-strong"
        >
          <ClipboardCheck size={20} className="text-brand" aria-hidden="true" />
          <h2 className="mt-4 font-semibold">Mes évaluations</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Notes, commentaires du professeur et réponses déjà enregistrées.
          </p>
        </Link>
        <Link
          href="/student/progression"
          className="rounded-xl border border-border bg-white p-5 hover:border-border-strong"
        >
          <TrendingUp size={20} className="text-brand" aria-hidden="true" />
          <h2 className="mt-4 font-semibold">Ma progression</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Les compétences renseignées dans vos évaluations, sans diagnostic
            IA non validé.
          </p>
        </Link>
      </section>
    </div>
  );
}
