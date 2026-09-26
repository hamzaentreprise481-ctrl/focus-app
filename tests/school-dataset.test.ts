import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeClass, analyzeEvaluation, analyzeStudent } from "../lib/analysis";
import type { EvaluationDataset } from "../lib/types";

function school(): EvaluationDataset {
  return {
    classes: [
      { id: "class-a", name: "Première A", level: "Première", subject: "Physique", teacher: "Test", studentIds: ["student-a"] },
      { id: "class-b", name: "Première B", level: "Première", subject: "Physique", teacher: "Test", studentIds: ["student-b"] },
    ],
    students: [
      { id: "student-a", classId: "class-a", name: "Élève A" },
      { id: "student-b", classId: "class-b", name: "Élève B" },
    ],
    skills: [{ id: "skill-a", name: "Mesurer" }],
    evaluations: [
      { id: "eval-a", name: "Mesures", date: "2026-09-25", classId: "class-a", skillIds: ["skill-a"], important: false },
      { id: "eval-b", name: "Mesures", date: "2026-09-25", classId: "class-b", skillIds: ["skill-a"], important: false },
    ],
    rawGrades: [
      { studentId: "student-a", evaluationId: "eval-a", score: 0, absent: false, skillLevels: { "skill-a": "fragile" } },
      { studentId: "student-b", evaluationId: "eval-b", score: 20, absent: false, skillLevels: { "skill-a": "maitrise" } },
    ],
  };
}

test("analysis uses arbitrary supplied class, student and skill identities", () => {
  const data = school();
  const a = analyzeClass("class-a", data);
  assert.equal(a.counts.total, 1);
  assert.equal(a.studentAnalyses[0].name, "Élève A");
  assert.equal(a.studentAnalyses[0].average, 0);
  assert.equal(a.weakestSkills[0].name, "Mesurer");
  assert.equal(analyzeEvaluation("eval-a", data).unrecordedCount, 0);
  assert.equal(analyzeEvaluation("eval-b", data).average, 20);
});

test("editing supplied observations immediately recomputes all analytical views", () => {
  const data = school();
  data.rawGrades[0].score = 13;
  data.rawGrades[0].skillLevels = { "skill-a": "en_cours" };
  assert.equal(analyzeStudent("student-a", data).average, 13);
  assert.equal(analyzeClass("class-a", data).studentAnalyses[0].average, 13);
  assert.equal(analyzeEvaluation("eval-a", data).average, 13);
  assert.equal(analyzeStudent("student-b", data).average, 20);
});

test("empty or unrelated datasets never fall back to demo identities", () => {
  const empty: EvaluationDataset = { classes: [], students: [], skills: [], evaluations: [], rawGrades: [] };
  assert.throws(() => analyzeStudent("lucas-bernard", empty), /introuvable/);
  assert.throws(() => analyzeClass("seconde-3", school()), /introuvable/);
  assert.doesNotMatch(readFileSync("lib/analysis.ts", "utf8"), /from ["'][^"']*(?:demo|data\/)/);
});
