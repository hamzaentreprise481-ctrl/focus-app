"use client";

import { notFound, useParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, TriangleAlert } from "lucide-react";
import { analyzeEvaluation } from "@/lib/analysis";
import { useDemoData } from "@/lib/demo-data-context";
import { DistributionChart } from "@/components/evaluations/distribution-chart";
import { formatDate, formatScore } from "@/lib/utils";

export default function EvaluationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { dataset } = useDemoData();

  if (!dataset.evaluations.some((e) => e.id === id)) notFound();

  const analysis = analyzeEvaluation(id, dataset);
  const { evaluation } = analysis;

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/app/evaluations"
          className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink"
        >
          <ChevronLeft className="h-4 w-4" />
          Évaluations
        </Link>
        <div className="mt-3">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            {evaluation.name}
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            {formatDate(evaluation.date)} · Seconde 3
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-5">
          <p className="text-sm text-ink-soft">Moyenne de classe</p>
          <p className="mt-2 text-[28px] font-semibold text-ink">
            {analysis.average !== null
              ? `${formatScore(analysis.average)} / 20`
              : "—"}
          </p>
        </div>
        <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-5">
          <p className="text-sm text-ink-soft">Élèves présents</p>
          <p className="mt-2 text-[28px] font-semibold text-ink">
            {analysis.presentCount}
          </p>
        </div>
        <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-5">
          <p className="text-sm text-ink-soft">Compétences testées</p>
          <p className="mt-2 text-[15px] font-medium text-ink">
            {evaluation.skillIds
              .map(
                (sid) =>
                  analysis.skillBreakdown.find((s) => s.skillId === sid)?.name,
              )
              .join(" · ")}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-5">
          <h2 className="text-[15px] font-semibold text-ink">
            Distribution des notes
          </h2>
          <div className="mt-4">
            <DistributionChart distribution={analysis.distribution} />
          </div>
        </section>

        <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-5">
          <h2 className="text-[15px] font-semibold text-ink">
            Difficultés fréquentes par compétence
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            Part des élèves encore fragiles ou non maîtrisés, parmi ceux évalués
            sur cette compétence.
          </p>
          <div className="mt-4 space-y-3">
            {analysis.skillBreakdown.map((skill) => (
              <div
                key={skill.skillId}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="text-ink">{skill.name}</span>
                {skill.weakPercent !== null ? (
                  <span className="font-medium text-ink-soft">
                    {skill.weakPercent}% en difficulté
                    <span className="ml-1 text-xs text-muted">
                      ({skill.sampleSize} évalués)
                    </span>
                  </span>
                ) : (
                  <span className="text-xs text-muted">
                    Données insuffisantes
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-5">
        <h2 className="text-[15px] font-semibold text-ink">
          Élèves en difficulté sur cette évaluation
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          Comparés à leur propre moyenne habituelle, pas à un seuil unique pour
          toute la classe.
        </p>
        {analysis.strugglingStudents.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">
            Aucun signal particulier sur cette évaluation.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {analysis.strugglingStudents.map((s) => (
              <li
                key={s.studentId}
                className="flex items-center justify-between gap-3 py-2.5 text-sm"
              >
                <div className="min-w-0">
                  <Link
                    href={`/app/eleves/${s.studentId}`}
                    className="font-medium text-ink hover:text-brand"
                  >
                    {s.name}
                  </Link>
                  <p className="mt-0.5 text-xs text-muted">{s.reason}</p>
                </div>
                <span className="shrink-0 tabular-nums text-attention">
                  {formatScore(s.score)} / 20
                </span>
              </li>
            ))}
          </ul>
        )}
        {analysis.absentStudents.length > 0 && (
          <div className="mt-4 flex items-start gap-2 rounded-[var(--radius-sm)] bg-watch-soft p-3 text-sm text-watch">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Absent(e)s :{" "}
              {analysis.absentStudents.map((s) => s.name).join(", ")}
              {evaluation.important &&
                " — séquence charnière, un rattrapage est recommandé."}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
