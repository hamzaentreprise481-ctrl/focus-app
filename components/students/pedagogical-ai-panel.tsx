"use client";

import { useEffect, useState, useTransition } from "react";
import {
  generatePedagogicalAnalysis,
  loadPedagogicalSnapshot,
} from "@/app/(teacher)/app/pedagogy-actions";
import type { PedagogicalSnapshot } from "@/lib/pedagogy/types";
import { Button } from "@/components/ui/button";

const CONFIDENCE = {
  limitee: "Confiance limitée",
  moderee: "Confiance modérée",
  forte: "Confiance forte",
} as const;

export function PedagogicalAiPanel({ studentId }: { studentId: string }) {
  const [snapshot, setSnapshot] = useState<PedagogicalSnapshot | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [generating, startGenerating] = useTransition();

  const refresh = () => {
    startLoading(async () => {
      try {
        setSnapshot(await loadPedagogicalSnapshot(studentId));
      } catch {
        setMessage("Impossible de charger l’analyse pédagogique.");
      }
    });
  };

  useEffect(() => {
    refresh();
  }, [studentId]);

  const generate = () => {
    startGenerating(async () => {
      setMessage(null);
      const result = await generatePedagogicalAnalysis(studentId);
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setMessage(
        result.analysisStatus === "insufficient_evidence"
          ? `Preuves insuffisantes : ${result.insufficientReason}`
          : result.reused
            ? "Cette version des preuves a déjà été analysée."
            : result.analysisStatus === "errors_found"
              ? `${result.recommendationCount} recommandation(s) fondée(s) sur les erreurs observées.`
              : "Aucune erreur pédagogique n’a été observée dans les preuves fournies.",
      );
      refresh();
    });
  };

  return (
    <section
      aria-labelledby="pedagogical-ai-title"
      className="rounded-xl border border-border bg-surface p-5 sm:p-6"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-brand">
        IA pédagogique · Mathématiques
      </p>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="pedagogical-ai-title" className="text-xl font-medium">
            Analyse des erreurs et prérequis
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-soft">
            FOCUS relie les réponses de l’élève au programme officiel 2026‑2027.
            Une moyenne ou une note isolée ne suffit jamais à produire une
            recommandation.
          </p>
        </div>
        <Button
          type="button"
          onClick={generate}
          disabled={generating || loading || snapshot?.analyzableAssessmentCount === 0}
        >
          {generating ? "Analyse…" : "Analyser les preuves"}
        </Button>
      </div>

      {loading && !snapshot && (
        <p className="mt-4 text-sm text-ink-soft">Chargement des preuves…</p>
      )}

      {snapshot && (
        <div className="mt-5">
          <p className="text-xs text-ink-soft">
            {snapshot.analyzableAssessmentCount} évaluation(s) avec preuves
            exploitables
            {snapshot.latestAnalyzableAssessmentTitle
              ? ` · prochaine analyse : ${snapshot.latestAnalyzableAssessmentTitle}`
              : ""}
          </p>

          {snapshot.latestAnalysisStatus === "insufficient_evidence" && (
            <p className="mt-3 rounded-lg bg-paper p-3 text-sm text-ink-soft">
              <span className="font-medium">Dernière analyse : preuves insuffisantes.</span>
              {snapshot.latestAnalysisReason
                ? ` ${snapshot.latestAnalysisReason}`
                : ""}
            </p>
          )}

          {snapshot.latestAnalysisStatus === "no_error_observed" && (
            <p className="mt-3 rounded-lg bg-paper p-3 text-sm text-ink-soft">
              Dernière analyse : aucune erreur pédagogique identifiable dans les
              preuves fournies.
            </p>
          )}

          {!snapshot.aiConfigured && (
            <p className="mt-3 rounded-lg bg-watch-soft p-3 text-sm text-watch">
              Le moteur IA serveur n’a pas encore de clé API configurée. Les
              preuves peuvent déjà être enregistrées sans lancer d’analyse.
            </p>
          )}

          {snapshot.analyzableAssessmentCount === 0 && (
            <p className="mt-4 text-sm text-ink-soft">
              Ajoutez d’abord, depuis une évaluation, le sujet, le
              corrigé/barème et au moins une réponse de cet élève.
            </p>
          )}

          {snapshot.recommendations.length > 0 && (
            <div className="mt-5 space-y-4">
              {snapshot.recommendations.map((recommendation) => (
                <article
                  key={recommendation.id}
                  className="rounded-xl border border-border bg-paper p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium text-brand">
                        {recommendation.curriculumNodeTitle}
                      </p>
                      <h3 className="mt-1 font-semibold text-ink">
                        {recommendation.difficulty}
                      </h3>
                    </div>
                    <span className="text-xs text-ink-soft">
                      {CONFIDENCE[recommendation.confidence]}
                    </span>
                  </div>

                  <p className="mt-3 text-sm leading-relaxed text-ink-soft">
                    {recommendation.explanation}
                  </p>

                  <div className="mt-4 rounded-lg bg-surface p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                      Preuves
                    </p>
                    {recommendation.evidence.map((evidence) => (
                      <p key={`${recommendation.id}-${evidence.questionId}`} className="mt-2 text-sm">
                        <span className="font-medium">{evidence.questionLabel}</span>
                        {" — "}
                        « {evidence.excerpt} »
                      </p>
                    ))}
                  </div>

                  <div className="mt-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                      Action pédagogique recommandée
                    </p>
                    <p className="mt-1 text-sm text-ink">
                      {recommendation.recommendedAction}
                    </p>
                  </div>

                  {(recommendation.prerequisites.length > 0 ||
                    recommendation.competencies.length > 0) && (
                    <p className="mt-4 text-xs text-ink-soft">
                      {recommendation.prerequisites.length > 0 &&
                        `Prérequis liés : ${recommendation.prerequisites.join(" · ")}. `}
                      {recommendation.competencies.length > 0 &&
                        `Compétences mobilisées : ${recommendation.competencies.join(" · ")}.`}
                    </p>
                  )}

                  <p className="mt-3 text-xs text-muted">
                    Programme officiel : {recommendation.sourceLocator}
                    {recommendation.sourceUrl && (
                      <>
                        {" · "}
                        <a
                          href={recommendation.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="underline hover:text-ink"
                        >
                          source
                        </a>
                      </>
                    )}
                  </p>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {message && (
        <p role="status" className="mt-4 text-sm text-ink-soft">
          {message}
        </p>
      )}
    </section>
  );
}
