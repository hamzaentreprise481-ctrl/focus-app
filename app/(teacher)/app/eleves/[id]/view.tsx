"use client";
import { ExportPdfButton } from "@/components/reports/export-pdf-button";

import { notFound, useParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { analyzeStudent } from "@/lib/analysis";
import { useSchoolData } from "@/lib/school-data-context";
import { StatusBadge } from "@/components/ui/status-badge";
import { GradeChart } from "@/components/students/grade-chart";
import { SkillMasteryList } from "@/components/students/skill-mastery-list";
import { CreateAccompagnementDialog } from "@/components/students/create-accompagnement-dialog";
import { EvidenceTimeline } from "@/components/students/evidence-timeline";
import { DemoDataState } from "@/components/evaluations/demo-data-state";
import { formatScore } from "@/lib/utils";

export default function StudentProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { dataset, loaded, storageError } = useSchoolData();
  if (!loaded || storageError) return <DemoDataState />;
  const student = dataset.students.find((s) => s.id === id);
  if (!student) notFound();
  const analysis = analyzeStudent(id, dataset);
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
  const nextAction = analysis.recommendedActions[0];

  return (
    <div className="space-y-8">
      <DemoDataState />
      <header>
        <Link
          href={`/app/classes/${student.classId}`}
          className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          {classInfo?.name}
        </Link>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {student.name}
            </h1>
            <p className="mt-1 text-sm text-ink-soft">
              {classInfo?.subject} · {observed.length} évaluations renseignées
            </p>
          </div>
          {analysis.pattern === "donnees_insuffisantes" ? (
            <span className="text-sm text-ink-soft">Recul encore limité</span>
          ) : (
            <StatusBadge status={analysis.status} />
          )}
        </div>
      </header>

      <ExportPdfButton target={{ kind: "student", id: id }} />
      <section
        aria-labelledby="next-step"
        className="rounded-xl border border-border bg-surface p-5 sm:p-6"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-brand">
          Piste à examiner ensemble
        </p>
        <h2 id="next-step" className="mt-3 text-xl font-medium">
          {nextAction?.label ??
            (analysis.pattern === "donnees_insuffisantes"
              ? "Compléter les observations avant de conclure"
              : "Poursuivre les observations")}
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-soft">
          {analysis.summary}
        </p>
        <p className="mt-3 text-xs text-ink-soft">
          Suggestion issue de règles explicites. À confirmer avec votre
          connaissance de l’élève.
        </p>
        {nextAction && (
          <div className="mt-4">
            <CreateAccompagnementDialog
              studentFirstName={student.name.split(" ")[0]}
              actions={analysis.recommendedActions}
            />
          </div>
        )}
      </section>

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
                    .map((s) => `${s.name} (${s.testedCount} observations)`)
                    .join(" · ")
                : "Aucun niveau fragile ou non maîtrisé dans les dernières observations renseignées."}
            </p>
          </div>
        </div>
      </section>

      <section
        className="rounded-xl border border-border bg-surface p-5"
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

      <EvidenceTimeline studentId={id} classId={student.classId} dataset={dataset} />

      <details className="insights-disclosure border-t border-border pt-4">
        <summary className="cursor-pointer rounded-lg py-3 text-lg font-semibold">
          Explorer les notes et l’interprétation
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
          <div className="rounded-lg bg-paper p-4 text-sm">
            <h3 className="font-medium">Interprétation FOCUS</h3>
            <p className="mt-2 leading-relaxed text-ink-soft">
              {analysis.narrative}
            </p>
            <p className="mt-3 text-xs text-ink-soft">
              Cette interprétation ne constitue pas un fait supplémentaire sur
              l’élève.
            </p>
          </div>
        </div>
      </details>
    </div>
  );
}

