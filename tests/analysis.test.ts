import { defaultDataset } from "../lib/demo/dataset";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeStudent,
  analyzeEvaluation,
  computeSkillMasteries,
} from "../lib/analysis";
import type { EvaluationDataset, SkillLevel } from "../lib/types";
function fixture(scores: number[], levels?: SkillLevel[]): EvaluationDataset {
  return {
    ...defaultDataset, evaluations: scores.map((_, i) => ({
      id: `t${i}`,
      name: `Test ${i}`,
      date: `2026-01-${String(i + 1).padStart(2, "0")}`,
      classId: "seconde-3",
      skillIds: ["equations"],
      important: false,
    })),
    rawGrades: scores.map((score, i) => ({
      studentId: "lucas-bernard",
      evaluationId: `t${i}`,
      score,
      absent: false,
      ...(levels ? { skillLevels: { equations: levels[i] } } : {}),
    })),
  };
}
test("a stable score below 10 is not automatically a difficulty", () => {
  const data = fixture([7, 7, 7, 7]);
  assert.equal(analyzeStudent("lucas-bernard", data).status, "normal");
  assert.equal(analyzeEvaluation("t3", data).strugglingStudents.length, 0);
});
test("global grades never imply competency mastery", () => {
  for (const score of [2, 19])
    assert.ok(
      computeSkillMasteries(
        "lucas-bernard",
        fixture([score, score, score]),
      ).every((s) => s.percent === null && s.confidence === "aucune"),
    );
});
test("one observation remains uncertain; coherent repeated observations increase confidence", () => {
  assert.equal(
    computeSkillMasteries("lucas-bernard", fixture([12], ["fragile"])).find(
      (s) => s.skillId === "equations",
    )?.confidence,
    "limitee",
  );
  assert.equal(
    computeSkillMasteries(
      "lucas-bernard",
      fixture([12, 12, 12], ["fragile", "fragile", "fragile"]),
    ).find((s) => s.skillId === "equations")?.confidence,
    "forte",
  );
  assert.equal(
    computeSkillMasteries(
      "lucas-bernard",
      fixture([12, 12, 12], ["fragile", "maitrise", "non_maitrise"]),
    ).find((s) => s.skillId === "equations")?.confidence,
    "moderee",
  );
});
test("preserves the existing narratives and their distinctions", () => {
  const expected = {
    "lucas-bernard": "difficulte_persistante",
    "adam-benali": "absence_sequence_importante",
    "lea-dubois": "baisse_reguliere",
    "emma-leroy": "progression_recente",
    "hugo-lambert": "note_ponctuelle",
  };
  for (const [id, pattern] of Object.entries(expected))
    assert.equal(analyzeStudent(id, defaultDataset).pattern, pattern);
});
test("an absent student does not receive inferred competencies", () => {
  const data = fixture([12], ["maitrise"]);
  data.rawGrades[0].absent = true;
  assert.ok(
    computeSkillMasteries("lucas-bernard", data).every(
      (s) => s.percent === null,
    ),
  );
});
