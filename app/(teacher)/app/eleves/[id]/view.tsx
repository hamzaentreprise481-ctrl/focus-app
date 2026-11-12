"use client";
import { ExportPdfButton } from "@/components/reports/export-pdf-button";

import { notFound, useParams, useSearchParams } from "next/navigation";
import { analyzeStudent } from "@/lib/analysis";
import { useSchoolData } from "@/lib/school-data-context";
import { Breadcrumbs, SectionNav } from "@/components/ui/page-header";
import { GradeChart } from "@/components/students/grade-chart";
import { SkillMasteryList } from "@/components/students/skill-mastery-list";
import { StudentSynthesis } from "@/components/students/student-synthesis";
import { EvidenceTimeline } from "@/components/students/evidence-timeline";
import { DataLoadState } from "@/components/evaluations/data-load-state";
import { formatScore } from "@/lib/utils";
import { PedagogicalAiPanel } from "@/components/students/pedagogical-ai-panel";

export default function StudentProfilePage() {
  const { id } = useParams<{ id: string }>();
  const requestedClass = useSearchParams().get("classe");
  const { dataset, loaded, storageError } = useSchoolData();
  if (!loaded || storageError) return <DataLoadState />;
  // A pupil enrolled in several of the teacher's classes: the class the
  // record was opened from, else the first enrollment.
  const student =
    dataset.students.find((s) => s.id === id && s.classId === requestedClass) ??
    dataset.students.find((s) => s.id === id);
  if (!student) notFound();
  const analysis = analyzeStudent(id, dataset, student.classId);
  const classInfo = dataset.classes.find((c) => c.id === student.classId);
  const documented = analysis.skillMasteries.filter((s) => s.testedCount > 0);
  const strengths = documented.filter(
    (s) =>
      s.lastTwoLevels.length > 0 &&
      s.lastTwoLevels.every((l) => l === "maitrise"),
  );
  const fragile = documented.filter((s) =>
    ["fragile", "non_maitrise"].includes(s.lastTwoLevels.at(-1) ?? ""),
  );
  const observed = dataset.rawGrades.filter(
    (g) =>
      g.studentId === id &&
      analysis.timeline.some((t) => t.evaluation.id === g.evaluationId),
  );

  return (
    <div className="space-y-8">
      <DataLoadState />
      <header>
        <Breadcrumbs
          items={[
            { label: "Accueil", href: "/app" },
            {
              label: classInfo?.name ?? "Classe",
              href: `/app/classes/${student.classId}`,
            },
            { label: "Suivi individuel" },
          ]}
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {student.name}
            </h1>
            <p className="mt-1 text-sm text-ink-soft">
              {classInfo?.name} · {classInfo?.subject} · {observed.length}{" "}
              évaluation{observed.length > 1 ? "s" : ""} renseignée
              {observed.length > 1 ? "s" : ""}
            </p>
          </div>
          <ExportPdfButton target={{ kind: "student", id, classId: student.classId }} />
        </div>
      </header>

      <SectionNav
        label="Dans la fiche élève"
        items={[
          { label: "Copies et observations", href: "#suivi-pedagogique" },
          { label: "Compétences", href: "#competences" },
          { label: "Évaluations dans le temps", href: "#evolution" },
        ]}
      />

      <PedagogicalAiPanel studentId={id} />
      <StudentSynthesis
        analysis={analysis}
        firstName={student.name.split(" ")[0]}
      />
      <section aria-labelledby="observations">
        <h2 id="observations" className="text-lg font-semibold">
          Ce qui a été observé
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          Les niveaux ci-dessous proviennent des compétences renseignées,
          indépendamment des notes.
        </p>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <div className="border-t border-border pt-4">
            <h3 className="font-medium">Points d’appui</h3>
            <p className="mt-2 text-sm text-ink-soft">
              {strengths.length
                ? strengths.map((s) => s.name).join(" · ")
                : "Aucun niveau « maîtrisé » renseigné dans les dernières observations disponibles."}
            </p>
            <p className="mt-2 text-xs text-ink-soft">
              Niveau « maîtrisé » sur la ou les deux dernières observations. Le
              recul est indiqué dans le détail.
            </p>
          </div>
          <div className="border-t border-border pt-4">
            <h3 className="font-medium">À vérifier ou à retravailler</h3>
            <p className="mt-2 text-sm text-ink-soft">
              {fragile.length
                ? fragile
                    .map(
                      (s) =>
                        `${s.name} (${s.testedCount} observation${s.testedCount > 1 ? "s" : ""})`,
                    )
                    .join(" · ")
                : "Aucun niveau fragile ou non maîtrisé dans les dernières observations renseignées."}
            </p>
          </div>
        </div>
      </section>

      <section
        className="rounded-xl border border-border bg-surface p-5"
        id="competences"
        aria-labelledby="skills-title"
      >
        <h2 id="skills-title" className="text-lg font-semibold">
          Compétences et évolution
        </h2>
        <p className="mb-5 mt-2 text-sm text-ink-soft">
          Les pourcentages sont des indices de synthèse des niveaux saisis, pas
          des taux de réussite mesurés.
        </p>
        <SkillMasteryList skills={analysis.skillMasteries} />
      </section>

      <div id="evolution" className="scroll-mt-6">
        <EvidenceTimeline
          studentId={id}
          classId={student.classId}
          dataset={dataset}
        />
      </div>

      <details className="insights-disclosure border-t border-border pt-4">
        <summary className="cursor-pointer rounded-lg py-3 text-lg font-semibold">
          Explorer les notes
        </summary>
        <div className="mt-4 space-y-6">
          <div className="flex flex-wrap gap-x-12 gap-y-5 text-sm">
            <div>
              <p className="text-ink-soft">Moyenne des notes renseignées</p>
              <p className="mt-1 text-xl font-medium">
                {analysis.average !== null
                  ? `${formatScore(analysis.average)} / 20`
                  : "Aucune note"}
              </p>
            </div>
            <div>
              <p className="text-ink-soft">Évolution</p>
              <p className="mt-1 text-xl font-medium">
                {analysis.evolution !== null
                  ? `${analysis.evolution > 0 ? "+" : ""}${formatScore(analysis.evolution)} points`
                  : "Recul insuffisant"}
              </p>
              {analysis.evolution !== null && (
                <p className="mt-1 text-xs text-ink-soft">
                  Sur les {analysis.evolutionWindow} dernières évaluations
                  notées
                </p>
              )}
            </div>
          </div>
          {analysis.average !== null && (
            <GradeChart timeline={analysis.timeline} />
          )}
        </div>
      </details>
    </div>
  );
}
