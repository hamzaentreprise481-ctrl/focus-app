import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeStudent,
  analyzeEvaluation,
  computeSkillMasteries,
} from "../lib/analysis";
import {
  gradeFromRow,
  parseScoreInput,
  validDate,
} from "../lib/evaluation-entry";
import {
  loadOverlay,
  persistOverlay,
  validateOverlay,
} from "../lib/demo-store";
import { formatDate } from "../lib/utils";
import type { EvaluationDataset, Evaluation } from "../lib/types";

const evaluation: Evaluation = {
  id: "demo-test",
  name: "Observation",
  date: "2026-09-11",
  classId: "seconde-3",
  skillIds: ["equations"],
  important: false,
};
const studentId = "lucas-bernard";
test("competency-only entry survives saving and contributes to both profile and class evidence", () => {
  const grade = gradeFromRow(
    studentId,
    evaluation.id,
    { scoreInput: "", absent: false, levels: { equations: "fragile" } },
    evaluation.skillIds,
  )!;
  const data = validateOverlay({
    evaluations: [evaluation],
    rawGrades: [grade],
  });
  assert.equal(grade.score, null);
  assert.equal(grade.absent, false);
  assert.equal(
    computeSkillMasteries(studentId, data).find(
      (s) => s.skillId === "equations",
    )?.testedCount,
    1,
  );
  assert.equal(
    analyzeEvaluation(evaluation.id, data).skillBreakdown[0].sampleSize,
    1,
  );
  assert.equal(analyzeEvaluation(evaluation.id, data).average, null);
  assert.equal(analyzeEvaluation(evaluation.id, data).presentCount, 1);
  assert.equal(analyzeEvaluation(evaluation.id, data).unrecordedCount, 30);
});
test("blank, zero, absence and explicit skill levels are different observations", () => {
  const row = { scoreInput: "", absent: false, levels: {} };
  assert.equal(gradeFromRow(studentId, evaluation.id, row, []), null);
  assert.equal(
    gradeFromRow(studentId, evaluation.id, { ...row, scoreInput: "0" }, [])
      ?.score,
    0,
  );
  assert.deepEqual(
    gradeFromRow(
      studentId,
      evaluation.id,
      { scoreInput: "15", absent: true, levels: { equations: "maitrise" } },
      evaluation.skillIds,
    ),
    { studentId, evaluationId: evaluation.id, score: null, absent: true },
  );
});
test("deselected competencies cannot silently persist in saved results", () => {
  const grade = gradeFromRow(
    studentId,
    evaluation.id,
    {
      scoreInput: "13,5",
      absent: false,
      levels: { equations: "maitrise", factorisation: "fragile" },
    },
    ["equations"],
  );
  assert.equal(grade?.score, 13.5);
  assert.deepEqual(grade?.skillLevels, { equations: "maitrise" });
});
test("invalid score formats and impossible dates are rejected", () => {
  for (const value of ["Infinity", "NaN", "0x10", "1e1", "-1", "20.01", "abc"])
    assert.ok(parseScoreInput(value).error, value);
  for (const value of ["", "2026-02-30", "2026-13-01", "2026-2-1"])
    assert.equal(validDate(value), false, value);
  assert.equal(validDate("2028-02-29"), true);
});
test("missing observations are never narrated as normal progression", () => {
  const a = analyzeStudent(studentId, {
    evaluations: [evaluation],
    rawGrades: [],
  });
  assert.equal(a.pattern, "donnees_insuffisantes");
  assert.equal(a.average, null);
  assert.equal(a.evolutionWindow, 0);
  assert.match(a.summary, /Pas assez/);
});
test("unrelated classes do not affect a student timeline or mastery", () => {
  const other = { ...evaluation, classId: "other-class" };
  const a = analyzeStudent(studentId, {
    evaluations: [other],
    rawGrades: [
      {
        studentId,
        evaluationId: other.id,
        score: 1,
        absent: false,
        skillLevels: { equations: "fragile" },
      },
    ],
  });
  assert.equal(a.timeline.length, 0);
  assert.equal(a.average, null);
  assert.ok(a.skillMasteries.every((s) => s.testedCount === 0));
});
test("historical evaluation analysis cannot use future results as its baseline", () => {
  const future = { ...evaluation, id: "demo-future", date: "2026-09-12" };
  const data: EvaluationDataset = {
    evaluations: [evaluation, future],
    rawGrades: [
      { studentId, evaluationId: evaluation.id, score: 8, absent: false },
      { studentId, evaluationId: future.id, score: 20, absent: false },
    ],
  };
  assert.equal(
    analyzeEvaluation(evaluation.id, data).strugglingStudents.length,
    0,
  );
});
test("evolution labels count evaluations rather than intervals", () => {
  const data: EvaluationDataset = { evaluations: [], rawGrades: [] };
  for (let i = 0; i < 3; i++) {
    const e = { ...evaluation, id: `demo-${i}`, date: `2026-09-${11 + i}` };
    data.evaluations.push(e);
    data.rawGrades.push({
      studentId,
      evaluationId: e.id,
      score: 15 - i,
      absent: false,
    });
  }
  assert.equal(analyzeStudent(studentId, data).evolutionWindow, 3);
});
test("corrupt persisted shapes, foreign students and duplicate grades are rejected", () => {
  for (const value of [
    null,
    {},
    { evaluations: [null], rawGrades: [] },
    { evaluations: [evaluation, evaluation], rawGrades: [] },
    {
      evaluations: [evaluation],
      rawGrades: [
        {
          studentId: "foreign",
          evaluationId: evaluation.id,
          score: 12,
          absent: false,
        },
      ],
    },
  ])
    assert.throws(() => validateOverlay(value));
  const g = {
    studentId,
    evaluationId: evaluation.id,
    score: 12,
    absent: false,
  };
  assert.throws(() =>
    validateOverlay({ evaluations: [evaluation], rawGrades: [g, g] }),
  );
});
test("storage failures are visible and corrupt data is never erased during reads", () => {
  const records = new Map<string, string>();
  let unavailable = false;
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => records.get(key) ?? null,
        setItem: (key: string, value: string) => {
          if (unavailable) throw new Error("QuotaExceededError");
          records.set(key, value);
        },
      },
    },
  });
  try {
    persistOverlay({ evaluations: [evaluation], rawGrades: [] }, "teacher-a");
    assert.equal(loadOverlay("teacher-a").evaluations.length, 1);
    assert.equal(loadOverlay("teacher-b").evaluations.length, 0);
    unavailable = true;
    assert.throws(
      () => persistOverlay({ evaluations: [], rawGrades: [] }, "teacher-a"),
      /Enregistrement impossible/,
    );
    assert.equal(loadOverlay("teacher-a").evaluations.length, 1);
    records.set("focus-demo-overlay-v2:teacher-a", "{corrupt");
    assert.throws(() => loadOverlay("teacher-a"), /conservés/);
    assert.equal(records.get("focus-demo-overlay-v2:teacher-a"), "{corrupt");
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
test("school dates do not move to the previous day in another timezone", () => {
  const old = process.env.TZ;
  process.env.TZ = "America/Montreal";
  try {
    assert.match(formatDate("2026-09-11"), /^11 septembre 2026$/);
  } finally {
    if (old === undefined) delete process.env.TZ;
    else process.env.TZ = old;
  }
});
