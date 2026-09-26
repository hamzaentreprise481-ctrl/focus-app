"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  generatePedagogicalAnalysis,
  loadResponseOverview,
  loadStudentEvidence,
  saveStudentEvidence,
} from "@/app/(teacher)/app/pedagogy-actions";
import type { ResponseOverviewRow, StudentEvidenceView, StudentResponseDraft } from "@/lib/pedagogy/types";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useUnsavedChangesWarning } from "@/components/evaluations/assessment-definition-editor";
import { ANALYSIS_STATUS_LABEL, analysisOutcomeMessage } from "@/components/students/pedagogy-labels";

const textarea =
  "mt-1 w-full rounded-[var(--radius-sm)] border border-border-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-soft";

export function StudentEvidenceEditor({
  assessmentId,
  students,
  definitionVersion,
  initialStudentId,
}: {
  assessmentId: string;
  students: { id: string; name: string }[];
  /** Changes when the definition was saved, to reload the questions. */
  definitionVersion: number;
  /** Student to open first (dashboard links), when in this class. */
  initialStudentId?: string;
}) {
  const [studentId, setStudentId] = useState(
    students.some((student) => student.id === initialStudentId) ? initialStudentId! : (students[0]?.id ?? ""),
  );
  const [overview, setOverview] = useState<Map<string, ResponseOverviewRow>>(new Map());
  const [questionCount, setQuestionCount] = useState<number | null>(null);
  const [evidence, setEvidence] = useState<StudentEvidenceView | null>(null);
  const [draft, setDraft] = useState<StudentResponseDraft[]>([]);
  const [saved, setSaved] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string; link?: boolean } | null>(null);
  const [busy, setBusy] = useState<"save" | "analyze" | null>(null);
  const lock = useRef(false);
  const scrolled = useRef(false);

  const applyOverview = useCallback((result: Awaited<ReturnType<typeof loadResponseOverview>>) => {
    if (result.ok) {
      setOverview(new Map(result.rows.map((row) => [row.studentId, row])));
      setQuestionCount(result.questionCount);
    }
  }, []);
  const refreshOverview = useCallback(async () => applyOverview(await loadResponseOverview(assessmentId)), [applyOverview, assessmentId]);

  const applyEvidence = useCallback((result: Awaited<ReturnType<typeof loadStudentEvidence>>) => {
    if (!result.ok) {
      setLoadError(result.error);
      return;
    }
    setLoadError(null);
    setEvidence(result.evidence);
    setDraft(result.evidence.responses);
    setSaved(JSON.stringify(result.evidence.responses));
    // Opened from a dashboard link: the section only has its height now.
    if (!scrolled.current && window.location.hash === "#copies") {
      scrolled.current = true;
      requestAnimationFrame(() => document.getElementById("copies")?.scrollIntoView({ block: "start" }));
    }
  }, []);
  const loadStudent = useCallback(
    async (id: string) => applyEvidence(await loadStudentEvidence(assessmentId, id)),
    [applyEvidence, assessmentId],
  );

  useEffect(() => {
    let cancelled = false;
    loadResponseOverview(assessmentId).then((result) => {
      if (!cancelled) applyOverview(result);
    });
    return () => {
      cancelled = true;
    };
  }, [applyOverview, assessmentId, definitionVersion]);
  useEffect(() => {
    if (!studentId) return;
    let cancelled = false;
    loadStudentEvidence(assessmentId, studentId).then((result) => {
      if (!cancelled) applyEvidence(result);
    });
    return () => {
      cancelled = true;
    };
  }, [applyEvidence, assessmentId, studentId, definitionVersion]);

  const dirty = JSON.stringify(draft) !== saved;
  useUnsavedChangesWarning(dirty);

  const change = (index: number, patch: Partial<StudentResponseDraft>) =>
    setDraft((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  const selectStudent = (id: string) => {
    if (dirty && !window.confirm("Les modifications de cette copie ne sont pas enregistrées. Changer d’élève quand même ?")) return;
    setMessage(null);
    setEvidence(null);
    setStudentId(id);
  };

  async function save(thenNext = false) {
    if (!evidence || lock.current) return;
    lock.current = true;
    setBusy("save");
    setMessage(null);
    try {
      const result = await saveStudentEvidence(assessmentId, studentId, draft);
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      setSaved(JSON.stringify(draft));
      await refreshOverview();
      const text = !result.changed
        ? "Aucune modification à enregistrer."
        : `Copie enregistrée.${result.supersededAnalyses ? " L’analyse précédente de cette copie est remplacée : relancez l’analyse." : ""}`;
      if (thenNext) {
        const index = students.findIndex((student) => student.id === studentId);
        const next = students[index + 1];
        if (next) {
          setStudentId(next.id);
          setMessage({ tone: "ok", text: `${text} Élève suivant : ${next.name}.` });
          return;
        }
      }
      setMessage({ tone: "ok", text });
    } finally {
      lock.current = false;
      setBusy(null);
    }
  }

  async function analyze() {
    if (lock.current) return;
    lock.current = true;
    setBusy("analyze");
    setMessage(null);
    try {
      const result = await generatePedagogicalAnalysis(studentId, assessmentId);
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      setMessage({ tone: "ok", text: analysisOutcomeMessage(result), link: true });
      await Promise.all([refreshOverview(), loadStudent(studentId)]);
    } finally {
      lock.current = false;
      setBusy(null);
    }
  }

  if (!students.length)
    return <p className="text-sm text-ink-soft">Aucun élève n’est inscrit dans la classe de cette évaluation.</p>;

  const current = overview.get(studentId);
  const studentName = students.find((student) => student.id === studentId)?.name ?? "l’élève";

  return (
    <section id="copies" aria-labelledby="copies-title" className="scroll-mt-6 rounded-[var(--radius-lg)] border border-border bg-surface p-5 sm:p-6">
      <h2 id="copies-title" className="text-[17px] font-semibold text-ink">
        Copies des élèves
      </h2>
      <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-soft">
        Recopiez la réponse exacte de l’élève (calculs compris), les points attribués et, si besoin, votre annotation. Une copie vide
        n’est jamais interprétée comme une erreur.
      </p>

      {questionCount === 0 ? (
        <p className="mt-4 rounded-lg bg-paper p-3 text-sm text-ink-soft">
          Ajoutez d’abord les questions et le corrigé ci-dessus, puis revenez saisir les copies.
        </p>
      ) : (
        <div className="mt-5 grid gap-5 lg:grid-cols-[260px_1fr]">
          <div>
            <Label htmlFor="copy-student">Élève</Label>
            <select
              id="copy-student"
              className="h-10 w-full rounded-[var(--radius-sm)] border border-border-strong bg-surface px-3 text-sm lg:hidden"
              value={studentId}
              onChange={(event) => selectStudent(event.target.value)}
            >
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.name}
                  {overview.get(student.id)?.answeredCount ? ` · ${overview.get(student.id)!.answeredCount} réponse(s)` : ""}
                </option>
              ))}
            </select>
            <ul className="hidden max-h-[520px] overflow-y-auto rounded-[var(--radius-md)] border border-border lg:block" aria-label="Élèves de la classe">
              {students.map((student) => {
                const row = overview.get(student.id);
                return (
                  <li key={student.id}>
                    <button
                      type="button"
                      aria-current={student.id === studentId ? "true" : undefined}
                      className={`flex w-full items-center justify-between gap-2 border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-paper ${student.id === studentId ? "bg-brand-soft font-medium text-brand-ink" : "text-ink"}`}
                      onClick={() => selectStudent(student.id)}
                    >
                      <span className="truncate">{student.name}</span>
                      <span className="shrink-0 text-xs text-muted">
                        {!row?.answeredCount
                          ? "—"
                          : row.needsAnalysis
                            ? "à analyser"
                            : row.pendingRecommendations
                              ? `${row.pendingRecommendations} à examiner`
                              : row.analysisStatus
                                ? "analysée"
                                : `${row.answeredCount} rép.`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div>
            {loadError && (
              <div role="alert" className="rounded-lg border border-border p-4 text-sm">
                <p>{loadError}</p>
                <Button className="mt-3" variant="secondary" onClick={() => void loadStudent(studentId)}>
                  Réessayer
                </Button>
              </div>
            )}
            {!loadError && !evidence && (
              <p role="status" className="text-sm text-ink-soft">
                Chargement de la copie…
              </p>
            )}
            {evidence && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void save(false);
                }}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-[15px] font-semibold text-ink">Copie de {studentName}</h3>
                  {evidence.analysis?.status && (
                    <span className="text-xs text-ink-soft">
                      Analyse actuelle : {ANALYSIS_STATUS_LABEL[evidence.analysis.status]}
                    </span>
                  )}
                  {evidence.analysis?.needsAnalysis && <span className="text-xs font-medium text-watch">Copie non analysée depuis la dernière saisie</span>}
                </div>
                <ol className="mt-3 space-y-4">
                  {evidence.questions.map((question, index) => {
                    const response = draft[index];
                    if (!response) return null;
                    return (
                      <li key={question.id} className="rounded-[var(--radius-md)] border border-border bg-paper p-4">
                        <details>
                          <summary className="cursor-pointer text-sm font-semibold text-ink">
                            Question {question.position}
                            {question.maxPoints !== null && <span className="font-normal text-ink-soft"> · sur {question.maxPoints} pt(s)</span>}
                            <span className="ml-2 font-normal text-ink-soft">{question.prompt.slice(0, 80)}{question.prompt.length > 80 ? "…" : ""}</span>
                          </summary>
                          <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{question.prompt}</p>
                          <p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">
                            <span className="font-medium">Corrigé : </span>
                            {question.correctionText}
                          </p>
                        </details>
                        <Label htmlFor={`response-${question.id}`} className="mt-3">
                          Réponse de l’élève
                        </Label>
                        <textarea
                          id={`response-${question.id}`}
                          rows={3}
                          className={textarea}
                          value={response.responseText}
                          maxLength={20000}
                          disabled={!evidence.editable}
                          placeholder="Laisser vide si l’élève n’a pas répondu"
                          onChange={(event) => change(index, { responseText: event.target.value })}
                        />
                        <div className="mt-3 grid gap-3 sm:grid-cols-[160px_1fr]">
                          <div>
                            <Label htmlFor={`points-${question.id}`}>Points attribués</Label>
                            <Input
                              id={`points-${question.id}`}
                              inputMode="decimal"
                              value={response.awardedPoints}
                              disabled={!evidence.editable}
                              onChange={(event) => change(index, { awardedPoints: event.target.value })}
                            />
                          </div>
                          <div>
                            <Label htmlFor={`annotation-${question.id}`}>Votre annotation (facultatif)</Label>
                            <textarea
                              id={`annotation-${question.id}`}
                              rows={2}
                              className={textarea}
                              value={response.teacherAnnotation}
                              maxLength={5000}
                              disabled={!evidence.editable}
                              onChange={(event) => change(index, { teacherAnnotation: event.target.value })}
                            />
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
                {evidence.editable ? (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Button type="submit" disabled={busy !== null || !dirty}>
                      {busy === "save" ? "Enregistrement…" : "Enregistrer la copie"}
                    </Button>
                    <Button variant="secondary" disabled={busy !== null || !dirty} onClick={() => void save(true)}>
                      Enregistrer et passer à l’élève suivant
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy !== null || dirty || !current?.answeredCount}
                      title={dirty ? "Enregistrez d’abord la copie" : undefined}
                      onClick={() => void analyze()}
                    >
                      {busy === "analyze" ? "Analyse en cours…" : "Analyser cette copie"}
                    </Button>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-ink-soft">Lecture seule : cette évaluation appartient à un autre professeur.</p>
                )}
              </form>
            )}
            {message && (
              <p role={message.tone === "error" ? "alert" : "status"} className={`mt-4 text-sm ${message.tone === "error" ? "text-watch" : "text-ink-soft"}`}>
                {message.text}
                {message.link && (
                  <>
                    {" "}
                    <Link className="font-medium text-brand underline" href={`/app/eleves/${studentId}#suivi-pedagogique`}>
                      Voir le suivi de {studentName}
                    </Link>
                  </>
                )}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
