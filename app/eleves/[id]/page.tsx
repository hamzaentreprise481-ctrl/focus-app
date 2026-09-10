"use client";

import { notFound, useParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Info } from "lucide-react";
import { analyzeStudent, CONFIDENCE_LABEL } from "@/lib/analysis";
import { studentById } from "@/lib/data/students";
import { classById } from "@/lib/data/class-info";
import { useDemoData } from "@/lib/demo-data-context";
import { StatusBadge } from "@/components/ui/status-badge";
import { GradeChart } from "@/components/students/grade-chart";
import { SkillMasteryList } from "@/components/students/skill-mastery-list";
import { CreateAccompagnementDialog } from "@/components/students/create-accompagnement-dialog";
import { formatScore } from "@/lib/utils";

export default function StudentProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { dataset } = useDemoData();
  const student = studentById.get(id);
  if (!student) notFound();

  const analysis = analyzeStudent(id, dataset);
  const classInfo = classById.get(student.classId);
  const firstName = student.name.split(" ")[0];

  return (
    <div className="space-y-8">
      <div>
        <Link
          href={`/classes/${student.classId}`}
          className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink"
        >
          <ChevronLeft className="h-4 w-4" />
          {classInfo?.name}
        </Link>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">{student.name}</h1>
            <p className="mt-1 text-sm text-ink-soft">{classInfo?.name}</p>
          </div>
          <StatusBadge status={analysis.status} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-5">
          <p className="text-sm text-ink-soft">Moyenne générale en mathématiques</p>
          <p className="mt-2 text-[32px] font-semibold leading-none tracking-tight text-ink">
            {analysis.average !== null ? formatScore(analysis.average) : "—"}
            <span className="text-base font-normal text-muted"> / 20</span>
          </p>
        </div>
        <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-5">
          <p className="text-sm text-ink-soft">Évolution</p>
          <p className="mt-2 text-[32px] font-semibold leading-none tracking-tight text-ink">
            {analysis.evolution !== null ? (
              <>
                {analysis.evolution > 0 ? "+" : ""}
                {formatScore(analysis.evolution)}
                <span className="text-base font-normal text-muted"> pts</span>
              </>
            ) : (
              "—"
            )}
          </p>
          <p className="mt-1 text-xs text-muted">sur les {analysis.evolutionWindow} dernières évaluations</p>
        </div>
        <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-5">
          <p className="text-sm text-ink-soft">Compétence la plus fragile</p>
          <p className="mt-2 text-[19px] font-semibold leading-tight text-ink">
            {analysis.weakestSkill?.name ?? "Données insuffisantes"}
          </p>
          <p className="mt-1 text-xs text-muted">
            {analysis.weakestSkill
              ? `${analysis.weakestSkill.percent}% de maîtrise estimée · ${CONFIDENCE_LABEL[analysis.weakestSkill.confidence]}`
              : ""}
          </p>
        </div>
      </div>

      <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-5">
        <h2 className="text-[15px] font-semibold text-ink">Évolution des résultats</h2>
        <div className="mt-4">
          <GradeChart timeline={analysis.timeline} />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-5">
          <h2 className="text-[15px] font-semibold text-ink">Compétences</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Saisies indépendamment de la note globale — le niveau de preuve varie selon le nombre d&rsquo;évaluations
            disponibles.
          </p>
          <div className="mt-4">
            <SkillMasteryList skills={analysis.skillMasteries} />
          </div>
        </section>

        <div className="space-y-6">
          <section className="rounded-[var(--radius-lg)] border border-brand-soft bg-brand-soft/40 p-5">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-brand" />
              <h2 className="text-[15px] font-semibold text-brand-ink">Analyse FOCUS</h2>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-ink-soft">{analysis.narrative}</p>
            <p className="mt-3 text-xs text-muted">
              Signal généré à partir des données disponibles — à confirmer par votre propre analyse. FOCUS ne décide
              de rien à la place de l&rsquo;enseignant.
            </p>
          </section>

          <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-5">
            <h2 className="text-[15px] font-semibold text-ink">Actions recommandées</h2>
            {analysis.recommendedActions.length > 0 ? (
              <ul className="mt-4 space-y-2">
                {analysis.recommendedActions.map((action, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-border px-3 py-2 text-sm"
                  >
                    <span className="text-ink">{action.label}</span>
                    <span className="shrink-0 text-xs text-muted">{action.minutes} min</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-ink-soft">Aucune action particulière recommandée pour le moment.</p>
            )}
            <div className="mt-4">
              <CreateAccompagnementDialog studentFirstName={firstName} actions={analysis.recommendedActions} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
