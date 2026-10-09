"use client";

import { useActionState, useMemo, useState } from "react";
import { createLesson } from "@/app/(teacher)/app/seances/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";

type Assignment = {
  id: string;
  className: string;
  subjectName: string;
  subjectId: string;
};

type Competency = {
  id: string;
  subjectId: string;
  name: string;
};

export function LessonForm({
  assignments,
  competencies,
}: {
  assignments: Assignment[];
  competencies: Competency[];
}) {
  const [state, action, pending] = useActionState(createLesson, null);
  const [assignmentId, setAssignmentId] = useState(assignments[0]?.id ?? "");
  const selected = assignments.find((row) => row.id === assignmentId);
  const visibleCompetencies = useMemo(
    () =>
      selected
        ? competencies.filter((row) => row.subjectId === selected.subjectId)
        : [],
    [competencies, selected],
  );

  return (
    <form action={action} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="lesson-assignment">Classe · matière</Label>
          <select
            id="lesson-assignment"
            name="assignment_id"
            value={assignmentId}
            onChange={(event) => setAssignmentId(event.target.value)}
            required
            className="mt-1 min-h-10 w-full rounded-lg border border-border-strong bg-white px-3 text-sm"
          >
            {assignments.map((row) => (
              <option key={row.id} value={row.id}>
                {row.className} · {row.subjectName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="lesson-date">Date</Label>
          <input
            id="lesson-date"
            name="date"
            type="date"
            defaultValue={new Date().toISOString().slice(0, 10)}
            required
            className="mt-1 min-h-10 w-full rounded-lg border border-border-strong bg-white px-3 text-sm"
          />
        </div>
      </div>

      <div>
        <Label htmlFor="lesson-summary">Résumé de la séance</Label>
        <textarea
          id="lesson-summary"
          name="summary"
          rows={4}
          maxLength={2000}
          required
          placeholder="Ex. Développement et factorisation : distributivité simple, exercices 1 à 6."
          className="mt-1 w-full rounded-lg border border-border-strong bg-white px-3 py-2 text-sm"
        />
      </div>

      <fieldset>
        <legend className="text-sm font-medium">Compétences travaillées</legend>
        <p className="mt-1 text-xs text-ink-soft">
          Ces liens alimentent la vue d’avancement Director.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {visibleCompetencies.map((competency) => (
            <label
              key={competency.id}
              className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm"
            >
              <input
                type="checkbox"
                name="competency_id"
                value={competency.id}
                className="mt-0.5"
              />
              <span>{competency.name}</span>
            </label>
          ))}
          {!visibleCompetencies.length && (
            <p className="text-sm text-ink-soft">
              Aucune compétence n’est disponible pour cette matière.
            </p>
          )}
        </div>
      </fieldset>

      {state?.error && (
        <p role="alert" className="rounded-lg bg-watch-soft p-3 text-sm text-watch">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="rounded-lg bg-normal-soft p-3 text-sm text-normal">
          Séance enregistrée.
        </p>
      )}

      <Button type="submit" disabled={pending || !assignments.length}>
        {pending ? "Enregistrement…" : "Enregistrer la séance"}
      </Button>
    </form>
  );
}
