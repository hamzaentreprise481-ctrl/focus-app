import { requireStudent } from "@/lib/auth/server";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { loadStudentAssessments } from "@/lib/student-data";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(value + "T12:00:00"));
}

export default async function StudentAssessmentsPage() {
  await requireStudent();
  const assessments = await loadStudentAssessments();

  return (
    <div className="space-y-7">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-brand">
          Scolarité
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Mes évaluations
        </h1>
        <p className="mt-3 max-w-2xl text-ink-soft">
          Seules les évaluations déjà passées sont affichées. Une note apparaît
          lorsqu’un résultat a été saisi pour votre compte.
        </p>
      </header>

      <div className="divide-y divide-border rounded-xl border border-border bg-white">
        {assessments.length ? (
          assessments.map((assessment) => (
            <Link
              key={assessment.id}
              href={"/student/evaluations/" + assessment.id}
              className="flex items-center justify-between gap-5 p-5 hover:bg-paper sm:p-6"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold">{assessment.title}</h2>
                  {assessment.important && (
                    <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand-ink">
                      Évaluation importante
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-ink-soft">
                  {assessment.subject} · {formatDate(assessment.date)}
                </p>
                {assessment.teacherComment && (
                  <p className="mt-2 line-clamp-1 text-sm text-ink-soft">
                    {assessment.teacherComment}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-4">
                <span
                  className={
                    assessment.status === "graded"
                      ? "font-semibold text-ink"
                      : "text-sm text-ink-soft"
                  }
                >
                  {assessment.status === "graded"
                    ? String(assessment.score) + "/20"
                    : assessment.status === "absent"
                      ? "Absent"
                      : "Correction en attente"}
                </span>
                <ArrowRight size={17} aria-hidden="true" />
              </div>
            </Link>
          ))
        ) : (
          <div className="p-7 text-sm text-ink-soft">
            Aucune évaluation passée n’est encore disponible pour votre classe.
          </div>
        )}
      </div>
    </div>
  );
}
