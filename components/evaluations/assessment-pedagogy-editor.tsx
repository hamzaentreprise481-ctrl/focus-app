"use client";

import { useEffect, useState, useTransition } from "react";
import {
  loadAssessmentEvidence,
  saveAssessmentEvidence,
} from "@/app/(teacher)/app/pedagogy-actions";
import type {
  AssessmentEvidenceDraft,
  EvidenceQuestionDraft,
} from "@/lib/pedagogy/types";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

function blankQuestion(position: number): EvidenceQuestionDraft {
  return {
    id: crypto.randomUUID(),
    position,
    prompt: "",
    correctionText: "",
    rubricText: "",
    maxPoints: "",
    responseText: "",
    awardedPoints: "",
    teacherAnnotation: "",
  };
}

export function AssessmentPedagogyEditor({
  assessmentId,
  students,
}: {
  assessmentId: string;
  students: { id: string; name: string }[];
}) {
  const [studentId, setStudentId] = useState(students[0]?.id ?? "");
  const [draft, setDraft] = useState<AssessmentEvidenceDraft | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();

  useEffect(() => {
    if (!studentId) return;
    startLoading(async () => {
      setMessage(null);
      try {
        const loaded = await loadAssessmentEvidence(assessmentId, studentId);
        setDraft({
          ...loaded,
          questions: loaded.questions.length
            ? loaded.questions
            : [blankQuestion(1)],
        });
      } catch {
        setDraft(null);
        setMessage("Impossible de charger les preuves détaillées.");
      }
    });
  }, [assessmentId, studentId]);

  const updateQuestion = (
    index: number,
    patch: Partial<EvidenceQuestionDraft>,
  ) => {
    setDraft((current) => {
      if (!current) return current;
      const questions = [...current.questions];
      questions[index] = { ...questions[index], ...patch };
      return { ...current, questions };
    });
  };

  const addQuestion = () => {
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        questions: [
          ...current.questions,
          blankQuestion(current.questions.length + 1),
        ],
      };
    });
  };

  const save = () => {
    if (!draft) return;
    startSaving(async () => {
      setMessage(null);
      const result = await saveAssessmentEvidence(draft);
      setMessage(
        result.ok
          ? "Sujet, corrigé et réponse enregistrés."
          : result.error,
      );
    });
  };

  if (!students.length)
    return (
      <p className="text-sm text-ink-soft">
        Aucun élève n’est disponible pour cette évaluation.
      </p>
    );

  return (
    <details className="rounded-[var(--radius-lg)] border border-border bg-surface p-5">
      <summary className="cursor-pointer text-[15px] font-semibold text-ink">
        Ajouter les preuves détaillées pour l’IA pédagogique
      </summary>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-soft">
        FOCUS analyse le sujet, le corrigé/barème et la réponse réelle de
        l’élève. Une note globale seule ne déclenche aucune recommandation.
      </p>

      <div className="mt-5">
        <Label htmlFor="pedagogy-student">Élève</Label>
        <select
          id="pedagogy-student"
          value={studentId}
          onChange={(event) => setStudentId(event.target.value)}
          className="mt-1 h-10 w-full max-w-md rounded-lg border border-border-strong bg-surface px-3 text-sm"
        >
          {students.map((student) => (
            <option key={student.id} value={student.id}>
              {student.name}
            </option>
          ))}
        </select>
      </div>

      {loading && (
        <p className="mt-4 text-sm text-ink-soft">Chargement…</p>
      )}

      {draft && !loading && (
        <div className="mt-5 space-y-6">
          <div>
            <Label htmlFor="assessment-context">Sujet / contexte général</Label>
            <textarea
              id="assessment-context"
              value={draft.contextText}
              onChange={(event) =>
                setDraft({ ...draft, contextText: event.target.value })
              }
              rows={3}
              className="mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm"
              placeholder="Ex. Contrôle sur le calcul littéral et les équations."
            />
          </div>
          <div>
            <Label htmlFor="assessment-instructions">Consignes générales</Label>
            <textarea
              id="assessment-instructions"
              value={draft.instructionsText}
              onChange={(event) =>
                setDraft({ ...draft, instructionsText: event.target.value })
              }
              rows={2}
              className="mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm"
              placeholder="Ex. Justifier chaque étape de calcul."
            />
          </div>

          {draft.questions.map((question, index) => (
            <section
              key={question.id}
              className="rounded-xl border border-border bg-paper p-4"
            >
              <h3 className="font-medium">Question {question.position}</h3>
              <div className="mt-4 grid gap-4">
                <div>
                  <Label htmlFor={`prompt-${question.id}`}>
                    Énoncé / exercice
                  </Label>
                  <textarea
                    id={`prompt-${question.id}`}
                    value={question.prompt}
                    onChange={(event) =>
                      updateQuestion(index, { prompt: event.target.value })
                    }
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <Label htmlFor={`correction-${question.id}`}>
                    Corrigé attendu
                  </Label>
                  <textarea
                    id={`correction-${question.id}`}
                    value={question.correctionText}
                    onChange={(event) =>
                      updateQuestion(index, {
                        correctionText: event.target.value,
                      })
                    }
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor={`rubric-${question.id}`}>Barème</Label>
                    <Input
                      id={`rubric-${question.id}`}
                      value={question.rubricText}
                      onChange={(event) =>
                        updateQuestion(index, {
                          rubricText: event.target.value,
                        })
                      }
                      placeholder="Ex. 1 pt méthode, 1 pt résultat"
                    />
                  </div>
                  <div>
                    <Label htmlFor={`max-${question.id}`}>Points max</Label>
                    <Input
                      id={`max-${question.id}`}
                      inputMode="decimal"
                      value={question.maxPoints}
                      onChange={(event) =>
                        updateQuestion(index, {
                          maxPoints: event.target.value,
                        })
                      }
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor={`response-${question.id}`}>
                    Réponse de l’élève
                  </Label>
                  <textarea
                    id={`response-${question.id}`}
                    value={question.responseText}
                    onChange={(event) =>
                      updateQuestion(index, {
                        responseText: event.target.value,
                      })
                    }
                    rows={4}
                    className="mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor={`points-${question.id}`}>
                      Points obtenus (facultatif)
                    </Label>
                    <Input
                      id={`points-${question.id}`}
                      inputMode="decimal"
                      value={question.awardedPoints}
                      onChange={(event) =>
                        updateQuestion(index, {
                          awardedPoints: event.target.value,
                        })
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor={`annotation-${question.id}`}>
                      Annotation professeur (facultatif)
                    </Label>
                    <Input
                      id={`annotation-${question.id}`}
                      value={question.teacherAnnotation}
                      onChange={(event) =>
                        updateQuestion(index, {
                          teacherAnnotation: event.target.value,
                        })
                      }
                    />
                  </div>
                </div>
              </div>
            </section>
          ))}

          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="secondary" onClick={addQuestion}>
              Ajouter une question
            </Button>
            <Button type="button" onClick={save} disabled={saving}>
              {saving ? "Enregistrement…" : "Enregistrer les preuves"}
            </Button>
          </div>
        </div>
      )}

      {message && (
        <p role="status" className="mt-4 text-sm text-ink-soft">
          {message}
        </p>
      )}
    </details>
  );
}
