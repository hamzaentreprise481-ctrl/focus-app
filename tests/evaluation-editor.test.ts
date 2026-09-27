import "./helpers/dom";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EvaluationEditor } from "../components/evaluations/evaluation-editor";
import { SchoolDataProvider, type SchoolData, type SaveResult } from "../lib/school-data-context";
import type { EvaluationDataset, Evaluation, RawGrade } from "../lib/types";

afterEach(cleanup);
const dataset: EvaluationDataset = {
  classes: [
    { id: "a", name: "Classe A", level: "Première", subject: "Physique", teacher: "Test", studentIds: ["a"] },
    { id: "b", name: "Classe B", level: "Première", subject: "Physique", teacher: "Test", studentIds: ["b"] },
  ],
  students: [{ id: "a", name: "Élève A", classId: "a" }, { id: "b", name: "Élève B", classId: "b" }],
  skills: [], evaluations: [], rawGrades: [],
};
const evaluation: Evaluation = { id: "demo-test", name: "Test", date: "2026-09-25", classId: "b", skillIds: [], important: false };
function mount(saveEvaluation: SchoolData["saveEvaluation"], edit = false) {
  return render(createElement(SchoolDataProvider, { value: {
    dataset, loaded: true, storageError: null, retryStorage: () => {}, editableEvaluationIds: [evaluation.id], saveEvaluation,
  } }, createElement(EvaluationEditor, edit ? { initialEvaluation: evaluation, initialGrades: [{ studentId: "b", evaluationId: evaluation.id, score: 12, absent: false }] } : { initialClassId: "b" })));
}
function fill() {
  fireEvent.change(screen.getByLabelText("Nom de l’évaluation"), { target: { value: "Mesures" } });
  fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-09-25" } });
  fireEvent.change(screen.getByLabelText("Note de Élève B sur 20"), { target: { value: "0" } });
}

test("editor selects the requested class and waits for confirmation before reporting success", async () => {
  let finish!: (result: SaveResult) => void;
  let calls = 0;
  let savedGrades: RawGrade[] = [];
  mount(async (e, grades) => {
    calls++;
    assert.equal(e.classId, "b");
    savedGrades = grades;
    return new Promise<SaveResult>((resolve) => { finish = resolve; });
  });
  fill();
  assert.equal(screen.queryByLabelText("Note de Élève A sur 20"), null);
  const button = screen.getByRole("button", { name: "Enregistrer l’évaluation" });
  fireEvent.click(button);
  fireEvent.click(button);
  assert.equal(calls, 1);
  assert.equal((button as HTMLButtonElement).disabled, true);
  assert.equal(screen.queryByText("Évaluation enregistrée"), null);
  assert.equal(savedGrades[0].score, 0);
  await act(async () => finish({ ok: true }));
  assert.ok(screen.getByText("Évaluation enregistrée"));
});

test("failed async saves preserve the form and reuse the same id on retry", async () => {
  const ids: string[] = [];
  mount(async (e) => {
    ids.push(e.id);
    if (ids.length === 1) throw new Error("network failure");
    return { ok: true };
  });
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Enregistrer l’évaluation" }));
  await waitFor(() => assert.match(screen.getByRole("alert").textContent!, /saisie est conservée/));
  assert.equal((screen.getByLabelText("Note de Élève B sur 20") as HTMLInputElement).value, "0");
  fireEvent.click(screen.getByRole("button", { name: "Enregistrer l’évaluation" }));
  await waitFor(() => assert.ok(screen.getByText("Évaluation enregistrée")));
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
});

test("editing can clear the last observation instead of retaining an incorrect grade", async () => {
  let saved: RawGrade[] | undefined;
  mount(async (_, grades) => { saved = grades; return { ok: true }; }, true);
  fireEvent.change(screen.getByLabelText("Note de Élève B sur 20"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Enregistrer l’évaluation" }));
  await waitFor(() => assert.ok(screen.getByText("Évaluation mise à jour")));
  assert.deepEqual(saved, []);
});
