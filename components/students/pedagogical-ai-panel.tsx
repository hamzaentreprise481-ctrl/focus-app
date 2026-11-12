"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  generatePedagogicalAnalysis,
  loadPedagogicalSnapshot,
  reviewPedagogicalRecommendation,
} from "@/app/(teacher)/app/pedagogy-actions";
import type {
  PedagogicalRecommendationView,
  PedagogicalSnapshot,
} from "@/lib/pedagogy/types";
import { Button } from "@/components/ui/button";
import { Feedback, SectionLoading } from "@/components/ui/feedback";
import { formatDate } from "@/lib/utils";
import {
  ANALYSIS_STATUS_LABEL,
  analysisOutcomeMessage,
  CONFIDENCE_LABEL,
  RECOMMENDATION_STATUS_LABEL,
} from "@/components/students/pedagogy-labels";

export function RecommendationCard({
  recommendation,
  onDecide,
  busy,
}: {
  recommendation: PedagogicalRecommendationView;
  onDecide?: (decision: "validate" | "dismiss", note: string) => void;
  busy?: boolean;
}) {
  const [note, setNote] = useState(recommendation.teacherNote ?? "");
  const confirmed = recommendation.status === "validated";
  const pending = recommendation.status === "pending";
  const decisionControls = onDecide ? (
    <div className="mt-4 border-t border-border pt-4">
      <p className="mb-2 text-sm font-semibold">Votre décision</p>
      {pending && (
        <p className="mb-3 text-xs text-ink-soft">
          Confirmer ajoute l’observation au suivi. Écarter conserve la
          proposition dans l’historique sans la compter comme difficulté
          confirmée.
        </p>
      )}
      <label
        htmlFor={`note-${recommendation.id}`}
        className="block text-xs font-medium text-ink-soft"
      >
        Note (facultatif) — lisible par les professeurs de cette matière dans la
        classe, jamais par l’élève
      </label>
      <textarea
        id={`note-${recommendation.id}`}
        rows={2}
        maxLength={1000}
        value={note}
        disabled={busy}
        onChange={(event) => setNote(event.target.value)}
        className="mt-1 w-full rounded-[var(--radius-sm)] border border-border-strong bg-surface px-3 py-2 text-sm"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        {!confirmed && (
          <Button disabled={busy} onClick={() => onDecide("validate", note)}>
            Confirmer l’observation
          </Button>
        )}
        {recommendation.status !== "dismissed" && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => onDecide("dismiss", note)}
          >
            Écarter
          </Button>
        )}
        {busy && (
          <span role="status" className="self-center text-sm text-ink-soft">
            Décision en cours…
          </span>
        )}
      </div>
    </div>
  ) : null;
  return (
    <article
      className={`recommendation-${recommendation.status} rounded-[var(--radius-md)] border border-border bg-surface p-4 sm:p-5`}
      aria-label={`${RECOMMENDATION_STATUS_LABEL[recommendation.status]} : ${recommendation.curriculumNodeTitle}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border pb-3">
        <p
          className={`text-sm font-semibold ${confirmed ? "text-normal" : pending ? "text-watch" : "text-ink-soft"}`}
        >
          {RECOMMENDATION_STATUS_LABEL[recommendation.status]}
        </p>
        <p className="text-xs text-ink-soft">
          {recommendation.assessmentTitle} ·{" "}
          {formatDate(recommendation.assessmentDate)}
        </p>
      </div>
      <div className="mt-4 grid gap-5 xl:grid-cols-2">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
            Preuve · réponse de l’élève
          </h4>
          <div className="mt-2 space-y-2">
            {recommendation.evidence.map((evidence, index) => (
              <blockquote
                key={`${evidence.questionId}-${index}`}
                className="evidence-quote"
              >
                <p className="mb-1 text-xs font-medium text-ink-soft">
                  {evidence.questionLabel}
                </p>
                <p className="text-base text-ink">« {evidence.excerpt} »</p>
              </blockquote>
            ))}
          </div>
          <div className="mt-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
              Niveau de preuve
            </h4>
            <p className="mt-1 text-sm">
              {CONFIDENCE_LABEL[recommendation.confidence]}
            </p>
            <p className="mt-1 text-xs text-ink-soft">
              Fondé sur l’historique des observations. Une confiance forte ne
              remplace pas votre décision.
            </p>
          </div>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
            {pending
              ? "Interprétation proposée par FOCUS"
              : confirmed
                ? "Interprétation confirmée par le professeur"
                : "Interprétation conservée dans l’historique"}
          </h4>
          <h3 className="mt-2 text-base font-semibold">
            {recommendation.difficulty}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            {recommendation.explanation}
          </p>
          <dl className="mt-4">
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
              Notion concernée
            </dt>
            <dd className="mt-1 text-sm font-medium">
              {recommendation.curriculumNodeTitle}
            </dd>
          </dl>
          <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-soft">
            Piste de travail proposée
          </h4>
          <p className="mt-1 text-sm leading-relaxed">
            {recommendation.recommendedAction}
          </p>
        </div>
      </div>
      {(recommendation.catalogue.length > 0 ||
        recommendation.sourceLocator) && (
        <details className="mt-4 border-t border-border pt-3">
          <summary className="cursor-pointer text-sm font-medium text-brand">
            Repères pédagogiques et source du programme
          </summary>
          {recommendation.catalogue.length > 0 && (
            <>
              <ul className="mt-3 space-y-3 text-sm text-ink-soft">
                {recommendation.catalogue.map((entry) => (
                  <li key={entry.code}>
                    <span className="font-medium text-ink">
                      {entry.kind === "typical_error"
                        ? "Erreur type"
                        : "Remédiation"}{" "}
                      :
                    </span>{" "}
                    {entry.text}
                    {entry.check && (
                      <p className="mt-1 text-xs">
                        Vérification : {entry.check.prompt}
                        {entry.check.expectedAnswer
                          ? ` — attendu : ${entry.check.expectedAnswer}`
                          : ""}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-ink-soft">
                Propositions éditoriales FOCUS, à adapter par le professeur ;
                aucune fréquence n’a été mesurée.
              </p>
            </>
          )}
          {(recommendation.prerequisites.length > 0 ||
            recommendation.competencies.length > 0) && (
            <p className="mt-3 text-xs text-ink-soft">
              {recommendation.prerequisites.length > 0 &&
                `Prérequis liés : ${recommendation.prerequisites.join(" · ")}. `}
              {recommendation.competencies.length > 0 &&
                `Compétences mobilisées : ${recommendation.competencies.join(" · ")}.`}
            </p>
          )}
          <p className="mt-3 text-xs text-ink-soft">
            Programme officiel : {recommendation.sourceLocator}
            {recommendation.sourceUrl && (
              <>
                {" "}
                ·{" "}
                <a
                  href={recommendation.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  Consulter la source
                </a>
              </>
            )}
          </p>
        </details>
      )}
      {recommendation.teacherNote && !pending && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-medium text-brand">
            Note du professeur
          </summary>
          <p className="mt-2 whitespace-pre-wrap text-ink-soft">
            {recommendation.teacherNote}
          </p>
        </details>
      )}
      {recommendation.decidedAt && (
        <p className="mt-1 text-xs text-ink-soft">
          Décision du {formatDate(recommendation.decidedAt.slice(0, 10))}
        </p>
      )}
      {pending
        ? decisionControls
        : decisionControls && (
            <details className="mt-4 border-t border-border pt-3">
              <summary className="cursor-pointer text-sm font-medium text-brand">
                Revoir la décision
              </summary>
              {decisionControls}
            </details>
          )}
    </article>
  );
}

export function PedagogicalAiPanel({ studentId }: { studentId: string }) {
  const [snapshot, setSnapshot] = useState<PedagogicalSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const lock = useRef(false);

  const apply = useCallback(
    (result: Awaited<ReturnType<typeof loadPedagogicalSnapshot>>) => {
      if (!result.ok) {
        setLoadError(result.error);
        return;
      }
      setLoadError(null);
      setSnapshot(result.snapshot);
    },
    [],
  );
  const refresh = useCallback(async () => {
    try {
      apply(await loadPedagogicalSnapshot(studentId));
    } catch {
      setLoadError("Le suivi pédagogique n’a pas pu être chargé.");
    }
  }, [apply, studentId]);

  useEffect(() => {
    let cancelled = false;
    loadPedagogicalSnapshot(studentId)
      .then((result) => {
        if (!cancelled) apply(result);
      })
      .catch(() => {
        if (!cancelled)
          setLoadError("Le suivi pédagogique n’a pas pu être chargé.");
      });
    return () => {
      cancelled = true;
    };
  }, [apply, studentId]);

  async function run(key: string, action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusyId(key);
    setMessage(null);
    try {
      await action();
    } catch {
      setMessage({
        tone: "error",
        text: "L’action n’a pas pu être vérifiée. Rechargez le suivi avant de réessayer.",
      });
    } finally {
      lock.current = false;
      setBusyId(null);
    }
  }

  const analyze = (assessmentId?: string) =>
    run(assessmentId ?? "next", async () => {
      const result = await generatePedagogicalAnalysis(studentId, assessmentId);
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      setMessage({ tone: "ok", text: analysisOutcomeMessage(result) });
      await refresh();
    });

  const decide = (id: string, decision: "validate" | "dismiss", note: string) =>
    run(id, async () => {
      const result = await reviewPedagogicalRecommendation(id, decision, note);
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
        await refresh();
        return;
      }
      setMessage({
        tone: "ok",
        text:
          decision === "validate"
            ? "Observation confirmée."
            : "Hypothèse écartée : elle ne comptera plus dans l’historique de l’élève.",
      });
      await refresh();
    });

  const pending =
    snapshot?.active.filter((item) => item.status === "pending") ?? [];
  const confirmed =
    snapshot?.active.filter((item) => item.status === "validated") ?? [];
  const toAnalyze =
    snapshot?.assessments.filter((item) => item.needsAnalysis) ?? [];

  return (
    <section
      id="suivi-pedagogique"
      aria-labelledby="pedagogical-ai-title"
      className="rounded-xl border border-border bg-surface p-5 sm:p-6"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
        Suivi fondé sur les copies · Mathématiques
      </p>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="pedagogical-ai-title" className="text-xl font-medium">
            Ce que montrent les copies
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-soft">
            Chaque piste s’appuie sur un extrait exact d’une réponse de l’élève
            et sur une notion du programme 2026‑2027. Une note seule ne produit
            jamais de recommandation, et vous gardez la décision.
          </p>
        </div>
        {toAnalyze.length > 0 && snapshot?.aiConfigured && (
          <Button disabled={busyId !== null} onClick={() => void analyze()}>
            {busyId === "next"
              ? "Analyse en cours…"
              : `Analyser la copie la plus récente (${toAnalyze.length} en attente)`}
          </Button>
        )}
      </div>

      {loadError && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-border p-4 text-sm"
        >
          <p>{loadError}</p>
          <Button
            className="mt-3"
            variant="secondary"
            onClick={() => void refresh()}
          >
            Réessayer
          </Button>
        </div>
      )}
      {!snapshot && !loadError && (
        <div className="mt-4">
          <SectionLoading label="Chargement du suivi…" />
        </div>
      )}

      {snapshot && (
        <div className="mt-5 space-y-6">
          {!snapshot.aiConfigured && (
            <p className="rounded-lg bg-watch-soft p-3 text-sm text-watch">
              L’analyse automatique n’est pas activée sur ce serveur. Les copies
              saisies restent enregistrées et pourront être analysées plus tard.
            </p>
          )}

          {snapshot.notions.length > 0 && (
            <div id="notions-suivies" className="scroll-mt-6">
              <h3 className="text-sm font-semibold text-ink">
                Notions suivies dans le temps
              </h3>
              <p className="mt-0.5 text-xs text-ink-soft">
                « Sans erreur observée » signifie qu’une question portant sur la
                notion a été analysée sans erreur ; ce n’est pas une maîtrise
                acquise.
              </p>
              <ul className="mt-2 space-y-2">
                {snapshot.notions.map((notion) => (
                  <li
                    key={notion.code}
                    className="rounded-[var(--radius-md)] border border-border px-4 py-3 text-sm"
                  >
                    <p className="font-medium text-ink">{notion.title}</p>
                    <ol className="mt-2 space-y-2 text-sm">
                      {notion.observations.map((observation) => (
                        <li
                          key={`${observation.assessmentId}-${observation.kind}`}
                        >
                          <Link
                            className="text-brand underline"
                            href={`/app/evaluations/${observation.assessmentId}?eleve=${studentId}#copies`}
                          >
                            {formatDate(observation.assessmentDate)}
                          </Link>{" "}
                          ·{" "}
                          {observation.kind === "no_error"
                            ? "sans erreur observée"
                            : observation.teacherDecision === "validated"
                              ? "erreur confirmée"
                              : observation.teacherDecision === "dismissed"
                                ? "hypothèse écartée"
                                : "hypothèse à examiner"}
                        </li>
                      ))}
                    </ol>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {confirmed.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-ink">
                Observations confirmées ({confirmed.length})
              </h3>
              <div className="mt-3 space-y-3">
                {confirmed.map((item) => (
                  <RecommendationCard
                    key={item.id}
                    recommendation={item}
                    busy={busyId !== null}
                    onDecide={(decision, note) =>
                      void decide(item.id, decision, note)
                    }
                  />
                ))}
              </div>
            </div>
          )}

          {pending.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-ink">
                À examiner ({pending.length})
              </h3>
              <p className="mt-0.5 text-xs text-ink-soft">
                Hypothèses proposées par l’IA : elles ne sont pas des constats
                tant que vous ne les confirmez pas.
              </p>
              <div className="mt-3 space-y-3">
                {pending.map((item) => (
                  <RecommendationCard
                    key={item.id}
                    recommendation={item}
                    busy={busyId !== null}
                    onDecide={(decision, note) =>
                      void decide(item.id, decision, note)
                    }
                  />
                ))}
              </div>
            </div>
          )}

          {snapshot.assessments.length === 0 ? (
            <p className="rounded-lg bg-paper p-3 text-sm text-ink-soft">
              Aucune copie détaillée pour cet élève. Depuis une évaluation,
              ajoutez le sujet et le corrigé, puis saisissez la réponse de
              l’élève : l’analyse devient alors possible.{" "}
              <Link
                href="/app/evaluations"
                className="font-medium text-brand underline"
              >
                Ouvrir les évaluations
              </Link>
            </p>
          ) : (
            <div>
              <h3 className="text-sm font-semibold text-ink">
                Copies détaillées
              </h3>
              <ul className="mt-2 divide-y divide-border rounded-[var(--radius-md)] border border-border">
                {snapshot.assessments.map((assessment) => (
                  <li
                    key={assessment.assessmentId}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/app/evaluations/${assessment.assessmentId}?eleve=${studentId}#copies`}
                        className="font-medium text-brand hover:underline"
                      >
                        {assessment.title}
                      </Link>
                      <p className="text-xs text-muted">
                        {formatDate(assessment.date)} ·{" "}
                        {assessment.answeredCount}/{assessment.questionCount}{" "}
                        réponse(s) saisie(s) ·{" "}
                        {assessment.answeredCount === 0
                          ? "pas de réponse saisie"
                          : assessment.status
                            ? `analyse : ${ANALYSIS_STATUS_LABEL[assessment.status]}`
                            : "pas encore analysée"}
                      </p>
                      {assessment.status === "insufficient_evidence" &&
                        assessment.reason && (
                          <p className="mt-0.5 text-xs text-ink-soft">
                            {assessment.reason}
                          </p>
                        )}
                    </div>
                    {assessment.needsAnalysis && snapshot.aiConfigured && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busyId !== null}
                        onClick={() => void analyze(assessment.assessmentId)}
                      >
                        {busyId === assessment.assessmentId
                          ? "Analyse…"
                          : "Analyser"}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {snapshot.history.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm font-medium text-ink-soft">
                Historique : hypothèses écartées ou remplacées (
                {snapshot.history.length})
              </summary>
              <div className="mt-3 space-y-3">
                {snapshot.history.map((item) => (
                  <RecommendationCard
                    key={item.id}
                    recommendation={item}
                    busy={busyId === item.id}
                    // A dismissal can be revisited; superseded hypotheses are frozen.
                    onDecide={
                      item.status === "dismissed"
                        ? (decision, note) =>
                            void decide(item.id, decision, note)
                        : undefined
                    }
                  />
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {message && (
        <div className="mt-4">
          <Feedback tone={message.tone === "error" ? "error" : "success"}>
            {message.text}
          </Feedback>
        </div>
      )}
    </section>
  );
}
