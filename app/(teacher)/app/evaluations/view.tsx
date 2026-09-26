"use client";

import { DataLoadState } from "@/components/evaluations/data-load-state";
import Link from "next/link";
import { ChevronRight, Plus, Users, Sparkles } from "lucide-react";
import { analyzeEvaluation } from "@/lib/analysis";
import { useSchoolData } from "@/lib/school-data-context";
import { Button } from "@/components/ui/button";
import { formatDate, formatScore } from "@/lib/utils";

export default function EvaluationsPage() {
  const { dataset, loaded, storageError, editableEvaluationIds } = useSchoolData();
  const evaluations = [...dataset.evaluations].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  if (!loaded || storageError) return <DataLoadState />;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            Évaluations
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            Seconde 3 — Mathématiques
          </p>
        </div>
        <Button asChild>
          <Link href="/app/evaluations/nouvelle">
            <Plus className="h-4 w-4" />
            Nouvelle évaluation
          </Link>
        </Button>
      </div>

      <div className="space-y-2">
        {evaluations.map((evaluation) => {
          const analysis = analyzeEvaluation(evaluation.id, dataset);
          const isNew = editableEvaluationIds.includes(evaluation.id);
          return (
            <Link
              key={evaluation.id}
              href={`/app/evaluations/${evaluation.id}`}
              className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-border bg-surface p-5 transition-colors hover:border-border-strong hover:bg-paper sm:flex-row sm:items-center sm:gap-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[15px] font-medium text-ink">
                    {evaluation.name}
                  </p>
                  {evaluation.important && (
                    <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand-ink">
                      Séquence charnière
                    </span>
                  )}
                  {isNew && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-normal-soft px-2 py-0.5 text-xs font-medium text-normal">
                      <Sparkles className="h-3 w-3" />
                      Ajoutée en démo
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-ink-soft">
                  {formatDate(evaluation.date)}
                </p>
              </div>
              <div className="flex items-center gap-6 text-sm">
                <div className="text-right">
                  <p className="text-xs text-muted">Moyenne classe</p>
                  <p className="font-semibold text-ink">
                    {analysis.average !== null
                      ? `${formatScore(analysis.average)} / 20`
                      : "—"}
                  </p>
                </div>
                <div className="hidden items-center gap-1.5 text-ink-soft sm:flex">
                  <Users className="h-3.5 w-3.5" />
                  {analysis.presentCount}
                  {analysis.absentStudents.length > 0 && (
                    <span className="text-muted">
                      · {analysis.absentStudents.length} absent(s)
                    </span>
                  )}
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
