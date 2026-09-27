"use client";
import { ExportPdfButton } from "@/components/reports/export-pdf-button";

import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { analyzeClass } from "@/lib/analysis";
import { DataLoadState } from "@/components/evaluations/data-load-state";
import { useSchoolData } from "@/lib/school-data-context";
import { StudentRoster } from "@/components/students/student-roster";
import {
  ClassRecentEvaluations,
  ClassSkillSignals,
  ClassStudentGroups,
} from "@/components/classes/class-overview";

export default function ClassRosterPage() {
  const { slug } = useParams<{ slug: string }>();
  const { dataset, loaded, storageError } = useSchoolData();

  if (!loaded || storageError) return <DataLoadState />;
  if (!dataset.classes.some((c) => c.id === slug)) notFound();

  const overview = analyzeClass(slug, dataset);
  const { classInfo, studentAnalyses } = overview;
  const evaluations = dataset.evaluations
    .filter((e) => e.classId === slug)
    .sort((a, b) => b.date.localeCompare(a.date));
  const latest = evaluations[0];

  return (
    <div className="space-y-10">
      <DataLoadState />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-ink-soft">
            {classInfo.subject}
            {classInfo.level ? ` · ${classInfo.level}` : ""}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            {classInfo.name}
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            {classInfo.studentIds.length} élève{classInfo.studentIds.length > 1 ? "s" : ""} ·{" "}
            {evaluations.length} évaluation{evaluations.length > 1 ? "s" : ""}
            {latest ? ` · dernière le ${formatDate(latest.date)}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild>
            <Link href={`/app/evaluations/nouvelle?classe=${encodeURIComponent(slug)}`}>
              Ajouter une évaluation
            </Link>
          </Button>
          <ExportPdfButton target={{ kind: "class", id: slug }} />
        </div>
      </header>

      {!classInfo.studentIds.length ? (
        <p className="rounded-xl border border-border bg-surface p-5 text-sm text-ink-soft">
          Aucun élève n’est inscrit dans cette classe. Les inscriptions sont
          gérées par l’établissement ; elles apparaîtront ici dès qu’elles
          seront enregistrées.
        </p>
      ) : !evaluations.length ? (
        <p className="rounded-xl border border-border bg-surface p-5 text-sm text-ink-soft">
          Aucune évaluation pour l’instant. Ajoutez la première : FOCUS
          proposera une lecture de la classe dès que des résultats seront
          saisis.
        </p>
      ) : (
        <>
          <ClassStudentGroups overview={overview} />
          <ClassSkillSignals overview={overview} dataset={dataset} />
        </>
      )}

      <ClassRecentEvaluations overview={overview} dataset={dataset} />

      <section id="eleves" className="scroll-mt-5" aria-labelledby="roster-title">
        <h2 id="roster-title" className="mb-4 text-lg font-semibold">
          Tous les élèves
        </h2>
        <StudentRoster analyses={studentAnalyses} skills={dataset.skills} />
      </section>
    </div>
  );
}
