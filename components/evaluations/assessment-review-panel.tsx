"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadAssessmentReview, reviewPedagogicalRecommendation } from "@/app/(teacher)/app/pedagogy-actions";
import { RecommendationCard } from "@/components/students/pedagogical-ai-panel";
import type { PedagogicalRecommendationView } from "@/lib/pedagogy/types";

type Item = { studentId: string; recommendation: PedagogicalRecommendationView };

/**
 * Every current hypothesis of the assessment, grouped by student, decided in
 * place. Nothing enters a student's follow-up without the teacher's decision.
 */
export function AssessmentReviewPanel({
  assessmentId,
  students,
  version,
  onDecided,
}: {
  assessmentId: string;
  students: { id: string; name: string }[];
  /** Changes after an analysis, to reload the list. */
  version: number;
  onDecided: () => void;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"pending" | "decided">("pending");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const lock = useRef(false);

  const apply = useCallback((result: Awaited<ReturnType<typeof loadAssessmentReview>>) => {
    if (!result.ok) {
      setLoadError(result.error);
      return;
    }
    setLoadError(null);
    setItems(result.items);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadAssessmentReview(assessmentId).then((result) => {
      if (!cancelled) apply(result);
    });
    return () => {
      cancelled = true;
    };
  }, [apply, assessmentId, version]);

  async function decide(recommendationId: string, decision: "validate" | "dismiss", note: string) {
    if (lock.current) return;
    lock.current = true;
    setBusyId(recommendationId);
    setMessage(null);
    try {
      const result = await reviewPedagogicalRecommendation(recommendationId, decision, note);
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      setMessage({
        tone: "ok",
        text: decision === "validate" ? "Observation confirmée : elle entre dans le suivi de l’élève." : "Hypothèse écartée : elle n’entre pas dans le suivi.",
      });
      apply(await loadAssessmentReview(assessmentId));
      onDecided();
    } finally {
      lock.current = false;
      setBusyId(null);
    }
  }

  if (loadError)
    return (
      <section id="hypotheses" className="scroll-mt-6 rounded-[var(--radius-lg)] border border-border bg-surface p-5" role="alert">
        <p className="text-sm text-ink-soft">{loadError}</p>
      </section>
    );
  // Nothing analysed with a finding yet: the copies section says what to do.
  if (!items || !items.length) return null;

  const pending = items.filter((item) => item.recommendation.status === "pending");
  const decided = items.filter((item) => item.recommendation.status !== "pending");
  const shown = filter === "pending" ? pending : decided;
  const nameOf = new Map(students.map((student) => [student.id, student.name]));
  const byStudent = new Map<string, Item[]>();
  for (const item of shown) byStudent.set(item.studentId, [...(byStudent.get(item.studentId) ?? []), item]);
  const groups = [...byStudent.entries()].sort(([a], [b]) => (nameOf.get(a) ?? a).localeCompare(nameOf.get(b) ?? b, "fr"));

  return (
    <section id="hypotheses" aria-labelledby="hypotheses-title" className="scroll-mt-6 rounded-[var(--radius-lg)] border border-border bg-surface p-5 sm:p-6">
      <h2 id="hypotheses-title" className="text-[17px] font-semibold text-ink">
        Hypothèses de l’analyse
      </h2>
      <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-soft">
        Chaque hypothèse cite un extrait exact de la copie et une notion du programme. Elle n’entre dans le suivi de l’élève que si vous
        la confirmez ; vous pouvez revenir sur une décision tant que la copie n’a pas changé.
      </p>
      <div className="mt-4 flex gap-2" role="group" aria-label="Filtrer les hypothèses">
        <button
          type="button"
          aria-pressed={filter === "pending"}
          onClick={() => setFilter("pending")}
          className={`rounded-full border px-3 py-1 text-sm ${filter === "pending" ? "border-brand bg-brand-soft text-brand-ink" : "border-border-strong text-ink-soft"}`}
        >
          À examiner ({pending.length})
        </button>
        <button
          type="button"
          aria-pressed={filter === "decided"}
          onClick={() => setFilter("decided")}
          className={`rounded-full border px-3 py-1 text-sm ${filter === "decided" ? "border-brand bg-brand-soft text-brand-ink" : "border-border-strong text-ink-soft"}`}
        >
          Décidées ({decided.length})
        </button>
      </div>
      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={`mt-3 text-sm ${message.tone === "error" ? "text-watch" : "text-ink-soft"}`}>
          {message.text}
        </p>
      )}
      {!groups.length ? (
        <p className="mt-4 text-sm text-ink-soft">
          {filter === "pending" ? "Aucune hypothèse n’attend votre décision pour cette évaluation." : "Aucune décision prise pour l’instant."}
        </p>
      ) : (
        <div className="mt-4 space-y-6">
          {groups.map(([studentId, group]) => (
            <div key={studentId}>
              <h3 className="flex flex-wrap items-baseline justify-between gap-2 text-[15px] font-semibold text-ink">
                {nameOf.get(studentId) ?? "Élève"}
                <Link href={`/app/eleves/${studentId}#suivi-pedagogique`} className="text-xs font-medium text-brand underline">
                  Suivi de l’élève
                </Link>
              </h3>
              <div className="mt-2 space-y-3">
                {group.map(({ recommendation }) => (
                  <RecommendationCard
                    key={recommendation.id}
                    recommendation={recommendation}
                    busy={busyId !== null}
                    onDecide={(decision, note) => void decide(recommendation.id, decision, note)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
