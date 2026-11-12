"use client";

import { useEffect, useRef, useState } from "react";
import { generatePedagogicalAnalysis } from "@/app/(teacher)/app/pedagogy-actions";
import { Button } from "@/components/ui/button";
import {
  batchStopReason,
  batchSummaryText,
  copiesToAnalyse,
  summarizeBatch,
  type BatchItem,
} from "@/lib/pedagogy/batch";
import type { ResponseOverviewRow } from "@/lib/pedagogy/types";

/** Analyse every saved copy of the assessment that has no current analysis. */
export function ClassAnalysisPanel({
  assessmentId,
  students,
  overview,
  blockedReason,
  onRunningChange,
  onProgress,
}: {
  assessmentId: string;
  students: { id: string; name: string }[];
  overview: ReadonlyMap<string, ResponseOverviewRow>;
  /** Why a run cannot start now (unsaved copy, another action in progress). */
  blockedReason: string | null;
  onRunningChange: (running: boolean) => void;
  /** Called after each copy, so the roster shows its new state. */
  onProgress: () => Promise<void>;
}) {
  const queue = copiesToAnalyse(students, overview);
  const pendingReviews = [...overview.values()].reduce((sum, row) => sum + row.pendingRecommendations, 0);
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState<{ index: number; total: number; name: string } | null>(null);
  const [items, setItems] = useState<BatchItem[]>([]);
  const [stopReason, setStopReason] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const stopRequested = useRef(false);
  // A double click must start one run, never start then stop it.
  const started = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function run() {
    if (started.current || running || blockedReason || !queue.length) return;
    started.current = true;
    const todo = [...queue];
    const done: BatchItem[] = [];
    stopRequested.current = false;
    setStopping(false);
    setItems([]);
    setStopReason(null);
    setRunning(true);
    onRunningChange(true);
    try {
      for (const [index, student] of todo.entries()) {
        if (stopRequested.current || !mounted.current) {
          setStopReason("Analyse arrêtée à votre demande. Les copies déjà analysées sont conservées.");
          break;
        }
        setCurrent({ index: index + 1, total: todo.length, name: student.name });
        let code: Parameters<typeof batchStopReason>[1];
        try {
          const result = await generatePedagogicalAnalysis(student.id, assessmentId);
          if (result.ok)
            done.push({
              studentId: student.id,
              name: student.name,
              status: result.analysisStatus,
              recommendationCount: result.recommendationCount,
              reused: result.reused,
            });
          else {
            code = result.code;
            done.push({ studentId: student.id, name: student.name, status: "failed", error: result.error });
          }
        } catch {
          done.push({ studentId: student.id, name: student.name, status: "failed", error: "La requête n’a pas abouti (connexion interrompue ?)." });
        }
        if (!mounted.current) return;
        setItems([...done]);
        try {
          await onProgress();
        } catch {
          // The roster refresh is cosmetic: the analysis itself is saved.
        }
        const reason = batchStopReason(done, code);
        if (reason) {
          setStopReason(reason);
          break;
        }
      }
    } finally {
      started.current = false;
      if (mounted.current) {
        setCurrent(null);
        setRunning(false);
        onRunningChange(false);
      }
    }
  }

  const summary = items.length ? summarizeBatch(items) : null;
  const failures = items.filter((item): item is Extract<BatchItem, { status: "failed" }> => item.status === "failed");

  return (
    <div className="mt-4 rounded-[var(--radius-md)] border border-border bg-paper p-4" aria-labelledby="class-analysis-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h3 id="class-analysis-title" className="text-sm font-semibold text-ink">
            Analyse de la classe
          </h3>
          <p className="mt-1 text-sm text-ink-soft">
            {queue.length
              ? `${queue.length} copie${queue.length > 1 ? "s" : ""} enregistrée${queue.length > 1 ? "s" : ""} sans analyse à jour.`
              : "Toutes les copies enregistrées ont une analyse à jour."}
            {pendingReviews > 0 && ` ${pendingReviews} hypothèse${pendingReviews > 1 ? "s" : ""} attend${pendingReviews > 1 ? "ent" : ""} votre décision.`}
          </p>
          <p className="mt-1 text-xs text-muted">
            Chaque copie est analysée séparément, à partir de ses seules réponses et du corrigé ; vous pouvez arrêter à tout moment
            sans rien perdre de ce qui est déjà analysé.
          </p>
        </div>
        {running ? (
          // Same place, disabled: the second click of a double click lands here.
          <Button size="sm" disabled>
            Analyse en cours…
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() => void run()}
            disabled={!!blockedReason || !queue.length}
            title={blockedReason ?? undefined}
          >
            {queue.length === 1 ? "Analyser la copie non analysée" : queue.length > 1 ? `Analyser les ${queue.length} copies non analysées` : "Rien à analyser"}
          </Button>
        )}
      </div>
      {!running && blockedReason && queue.length > 0 && <p className="mt-2 text-xs text-watch">{blockedReason}</p>}

      {current && (
        <div className="mt-3">
          <div role="status" aria-live="polite">
            <p className="text-sm text-ink">
              Analyse {current.index} / {current.total} : {current.name}…
            </p>
            <progress className="mt-2 h-2 w-full" max={current.total} value={current.index - 1} aria-label="Progression de l’analyse" />
          </div>
          <Button
            className="mt-2"
            variant="secondary"
            size="sm"
            disabled={stopping}
            onClick={() => {
              stopRequested.current = true;
              setStopping(true);
            }}
          >
            {stopping ? "Arrêt après cette copie…" : "Arrêter après cette copie"}
          </Button>
        </div>
      )}
      {!running && summary && (
        <div className="mt-3 space-y-1 text-sm" role="status">
          <p className="text-ink">{batchSummaryText(summary)}</p>
          {stopReason && <p className="text-watch">{stopReason}</p>}
          {failures.length > 0 && (
            <ul className="list-inside list-disc text-xs text-ink-soft">
              {failures.map((item) => (
                <li key={item.studentId}>
                  {item.name} : {item.error}
                </li>
              ))}
            </ul>
          )}
          {summary.hypotheses > 0 && (
            <a href="#hypotheses" className="inline-block font-medium text-brand underline">
              Examiner les hypothèses
            </a>
          )}
        </div>
      )}
    </div>
  );
}
