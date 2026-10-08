"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import {
  loadAssessmentDefinition,
  saveAssessmentDefinition,
} from "@/app/(teacher)/app/pedagogy-actions";
import type {
  AssessmentDefinitionDraft,
  AssessmentDefinitionView,
  DefinitionQuestionDraft,
} from "@/lib/pedagogy/types";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { SectionLoading, Feedback } from "@/components/ui/feedback";

const textarea =
  "mt-1 w-full rounded-[var(--radius-sm)] border border-border-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-soft";

function blankQuestion(): DefinitionQuestionDraft {
  return {
    id: crypto.randomUUID(),
    prompt: "",
    correctionText: "",
    rubricText: "",
    maxPoints: "",
    nodeCodes: [],
  };
}

function snapshot(draft: AssessmentDefinitionDraft | null) {
  return draft
    ? JSON.stringify({
        c: draft.contextText,
        i: draft.instructionsText,
        q: draft.questions,
      })
    : "";
}

export function useUnsavedChangesWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}

export function AssessmentDefinitionEditor({
  assessmentId,
  onSaved,
}: {
  assessmentId: string;
  /** Called after a save that changed the definition. */
  onSaved?: () => void;
}) {
  const [view, setView] = useState<AssessmentDefinitionView | null>(null);
  const [draft, setDraft] = useState<AssessmentDefinitionDraft | null>(null);
  const [saved, setSaved] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);
  const [pendingDeletion, setPendingDeletion] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  const apply = useCallback(
    (result: Awaited<ReturnType<typeof loadAssessmentDefinition>>) => {
      if (!result.ok) {
        setLoadError(result.error);
        return;
      }
      const next: AssessmentDefinitionDraft = {
        assessmentId,
        contextText: result.definition.contextText,
        instructionsText: result.definition.instructionsText,
        questions: result.definition.questions,
      };
      setLoadError(null);
      setView(result.definition);
      setDraft(next);
      setSaved(snapshot(next));
    },
    [assessmentId],
  );
  const load = useCallback(async () => {
    try {
      apply(await loadAssessmentDefinition(assessmentId));
    } catch {
      setLoadError(
        "Le sujet n’a pas pu être chargé. Réessayez sans quitter l’évaluation.",
      );
    }
  }, [apply, assessmentId]);

  useEffect(() => {
    let cancelled = false;
    loadAssessmentDefinition(assessmentId)
      .then((result) => {
        if (!cancelled) apply(result);
      })
      .catch(() => {
        if (!cancelled)
          setLoadError(
            "Le sujet n’a pas pu être chargé. Réessayez sans quitter l’évaluation.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [apply, assessmentId]);

  const dirty = !!draft && snapshot(draft) !== saved;
  useUnsavedChangesWarning(dirty);

  const notionGroups = useMemo(() => {
    const groups = new Map<string, AssessmentDefinitionView["notions"]>();
    for (const notion of view?.notions ?? [])
      groups.set(notion.group, [...(groups.get(notion.group) ?? []), notion]);
    return [...groups.entries()];
  }, [view]);
  const notionTitle = useMemo(
    () =>
      new Map(
        (view?.notions ?? []).map((notion) => [notion.code, notion.title]),
      ),
    [view],
  );

  const update = (index: number, patch: Partial<DefinitionQuestionDraft>) =>
    setDraft((current) => {
      if (!current) return current;
      const questions = [...current.questions];
      questions[index] = { ...questions[index], ...patch };
      return { ...current, questions };
    });
  const move = (index: number, delta: number) =>
    setDraft((current) => {
      if (!current) return current;
      const questions = [...current.questions];
      const target = index + delta;
      if (target < 0 || target >= questions.length) return current;
      [questions[index], questions[target]] = [
        questions[target],
        questions[index],
      ];
      return { ...current, questions };
    });
  const remove = (index: number) =>
    setDraft((current) =>
      current
        ? {
            ...current,
            questions: current.questions.filter((_, i) => i !== index),
          }
        : current,
    );

  async function save(confirmResponseDeletion = false) {
    if (!draft || lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const result = await saveAssessmentDefinition(draft, {
        confirmResponseDeletion,
      });
      if (!result.ok) {
        if ("needsConfirmation" in result && result.needsConfirmation)
          setPendingDeletion(result.needsConfirmation);
        setMessage({ tone: "error", text: result.error });
        return;
      }
      setPendingDeletion(null);
      await load();
      setMessage({
        tone: "ok",
        text: !result.changed
          ? "Aucune modification à enregistrer."
          : `Sujet et corrigé enregistrés.${result.deletedAnswers ? ` ${result.deletedAnswers} réponse(s) d’élèves supprimée(s) avec leurs questions.` : ""}${result.supersededAnalyses ? ` ${result.supersededAnalyses} analyse(s) antérieure(s) remplacée(s) : relancez l’analyse des copies concernées.` : ""}`,
      });
      if (result.changed) onSaved?.();
    } catch {
      setMessage({
        tone: "error",
        text: "L’enregistrement n’a pas abouti. Vos modifications sont conservées ; réessayez.",
      });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  if (loadError)
    return (
      <div
        role="alert"
        className="rounded-[var(--radius-lg)] border border-border bg-surface p-5 text-sm"
      >
        <p>{loadError}</p>
        <Button
          className="mt-3"
          variant="secondary"
          onClick={() => void load()}
        >
          Réessayer
        </Button>
      </div>
    );
  if (!draft || !view)
    return <SectionLoading label="Chargement du sujet et du corrigé…" />;

  const readOnly = !view.editable;
  return (
    <section
      aria-labelledby="definition-title"
      className="rounded-[var(--radius-lg)] border border-border bg-surface p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="definition-title"
            className="text-[17px] font-semibold text-ink"
          >
            Sujet, questions et corrigé
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-soft">
            Commun à toute la classe. L’analyse pédagogique compare la réponse
            exacte de chaque élève à ce corrigé ; une note seule ne produit
            jamais de recommandation.
          </p>
        </div>
        {!readOnly && (
          <span
            role="status"
            className={`text-xs font-medium ${dirty ? "text-watch" : "text-ink-soft"}`}
          >
            {busy
              ? "Enregistrement…"
              : dirty
                ? "Modifications non enregistrées"
                : draft.questions.length
                  ? `${draft.questions.length} question(s) enregistrée(s)`
                  : "Sujet à compléter"}
          </span>
        )}
      </div>
      {readOnly && (
        <p className="mt-3 rounded-lg bg-paper p-3 text-sm text-ink-soft">
          Cette évaluation a été créée par un autre professeur : vous pouvez la
          consulter mais pas la modifier.
        </p>
      )}

      <fieldset disabled={busy}>
        <details className="mt-5 rounded-[var(--radius-sm)] border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Contexte et consignes générales{" "}
            <span className="font-normal text-ink-soft">(facultatif)</span>
          </summary>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="definition-context">
                Sujet ou contexte (facultatif)
              </Label>
              <textarea
                id="definition-context"
                rows={3}
                className={textarea}
                value={draft.contextText}
                disabled={readOnly}
                maxLength={12000}
                onChange={(event) =>
                  setDraft({ ...draft, contextText: event.target.value })
                }
              />
            </div>
            <div>
              <Label htmlFor="definition-instructions">
                Consignes générales (facultatif)
              </Label>
              <textarea
                id="definition-instructions"
                rows={3}
                className={textarea}
                value={draft.instructionsText}
                disabled={readOnly}
                maxLength={12000}
                onChange={(event) =>
                  setDraft({ ...draft, instructionsText: event.target.value })
                }
              />
            </div>
          </div>
        </details>

        <ol className="mt-6 space-y-4">
          {draft.questions.map((question, index) => {
            const answers = view.answersByQuestion[question.id] ?? 0;
            return (
              <li
                key={question.id}
                className="rounded-[var(--radius-md)] border border-border bg-paper p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-ink">
                    Question {index + 1}
                    {answers > 0 && (
                      <span className="ml-2 font-normal text-ink-soft">
                        · {answers} copie(s) saisie(s)
                      </span>
                    )}
                  </h3>
                  {!readOnly && (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Monter la question ${index + 1}`}
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUp className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Descendre la question ${index + 1}`}
                        disabled={index === draft.questions.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDown className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Supprimer la question ${index + 1}`}
                        onClick={() => remove(index)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  )}
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div>
                    <Label htmlFor={`prompt-${question.id}`}>Énoncé</Label>
                    <textarea
                      id={`prompt-${question.id}`}
                      rows={3}
                      required
                      className={textarea}
                      value={question.prompt}
                      disabled={readOnly}
                      maxLength={12000}
                      onChange={(event) =>
                        update(index, { prompt: event.target.value })
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor={`correction-${question.id}`}>
                      Corrigé attendu
                    </Label>
                    <textarea
                      id={`correction-${question.id}`}
                      rows={3}
                      required
                      className={textarea}
                      value={question.correctionText}
                      disabled={readOnly}
                      maxLength={12000}
                      onChange={(event) =>
                        update(index, { correctionText: event.target.value })
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor={`rubric-${question.id}`}>
                      Barème ou critères (facultatif)
                    </Label>
                    <textarea
                      id={`rubric-${question.id}`}
                      rows={2}
                      className={textarea}
                      value={question.rubricText}
                      disabled={readOnly}
                      maxLength={8000}
                      onChange={(event) =>
                        update(index, { rubricText: event.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-3">
                    <div>
                      <Label htmlFor={`max-${question.id}`}>
                        Points maximum (facultatif)
                      </Label>
                      <Input
                        id={`max-${question.id}`}
                        inputMode="decimal"
                        className="max-w-[140px]"
                        value={question.maxPoints}
                        disabled={readOnly}
                        onChange={(event) =>
                          update(index, { maxPoints: event.target.value })
                        }
                      />
                    </div>
                    {view.notions.length > 0 && (
                      <div>
                        <Label htmlFor={`notions-${question.id}`}>
                          Notions évaluées (recommandé)
                        </Label>
                        <div className="flex flex-wrap gap-1.5">
                          {question.nodeCodes.map((code) => (
                            <span
                              key={code}
                              className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 text-xs text-brand-ink"
                            >
                              {notionTitle.get(code) ?? code}
                              {!readOnly && (
                                <button
                                  type="button"
                                  className="ml-0.5 rounded-full px-1 hover:bg-surface"
                                  aria-label={`Retirer ${notionTitle.get(code) ?? code}`}
                                  onClick={() =>
                                    update(index, {
                                      nodeCodes: question.nodeCodes.filter(
                                        (item) => item !== code,
                                      ),
                                    })
                                  }
                                >
                                  ×
                                </button>
                              )}
                            </span>
                          ))}
                        </div>
                        {!readOnly && question.nodeCodes.length < 6 && (
                          <select
                            id={`notions-${question.id}`}
                            className="mt-2 h-10 w-full rounded-[var(--radius-sm)] border border-border-strong bg-surface px-3 text-sm"
                            value=""
                            onChange={(event) =>
                              event.target.value &&
                              update(index, {
                                nodeCodes: [
                                  ...new Set([
                                    ...question.nodeCodes,
                                    event.target.value,
                                  ]),
                                ].sort(),
                              })
                            }
                          >
                            <option value="">
                              Ajouter une notion du programme…
                            </option>
                            {notionGroups.map(([group, notions]) => (
                              <optgroup key={group} label={group}>
                                {notions
                                  .filter(
                                    (notion) =>
                                      !question.nodeCodes.includes(notion.code),
                                  )
                                  .map((notion) => (
                                    <option
                                      key={notion.code}
                                      value={notion.code}
                                    >
                                      {notion.title}
                                    </option>
                                  ))}
                              </optgroup>
                            ))}
                          </select>
                        )}
                        <p className="mt-1 text-xs text-muted">
                          Une erreur ne pourra être rattachée qu’à ces notions,
                          à leurs sous-notions ou à leurs prérequis.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
                {answers > 0 && !readOnly && (
                  <p className="mt-3 text-xs text-ink-soft">
                    Modifier cette question remplacera les analyses déjà faites
                    sur les copies de la classe.
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      </fieldset>

      {draft.questions.length === 0 && (
        <div className="mt-4 rounded-[var(--radius-sm)] bg-paper p-4">
          <p className="text-sm font-medium">Commencez par une question</p>
          <p className="mt-1 text-sm text-ink-soft">
            Ajoutez son énoncé, le corrigé attendu et les notions évaluées. Vous
            pourrez ensuite saisir une première copie.
          </p>
        </div>
      )}

      {!readOnly && (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            disabled={busy || draft.questions.length >= 40}
            onClick={() =>
              setDraft({
                ...draft,
                questions: [...draft.questions, blankQuestion()],
              })
            }
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Ajouter une question
          </Button>
          <Button disabled={busy || !dirty} onClick={() => void save(false)}>
            {busy ? "Enregistrement…" : "Enregistrer le sujet et le corrigé"}
          </Button>
          {dirty && (
            <Button variant="ghost" disabled={busy} onClick={() => void load()}>
              Annuler les modifications
            </Button>
          )}
        </div>
      )}

      {pendingDeletion !== null && (
        <div
          role="alertdialog"
          aria-labelledby="deletion-title"
          className="mt-4 rounded-lg border border-watch bg-watch-soft p-4 text-sm text-watch"
        >
          <p id="deletion-title" className="font-medium">
            {pendingDeletion} réponse(s) d’élèves seront définitivement
            supprimées avec les questions retirées.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void save(true)}
            >
              Supprimer et enregistrer
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setPendingDeletion(null)}
            >
              Garder les questions
            </Button>
          </div>
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
