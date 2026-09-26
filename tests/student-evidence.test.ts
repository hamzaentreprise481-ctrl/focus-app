import { defaultDataset } from "../lib/demo/dataset";
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeStudent } from "../lib/analysis";
import { studentEvidence, filterStudentRoster, latestSkillLevel } from "../lib/student-evidence";
import type { EvaluationDataset } from "../lib/types";

const studentId = "lucas-bernard";
function fixture(): EvaluationDataset {
  return {
    ...defaultDataset, evaluations: [
      { id: "zero", name: "Zéro", date: "2026-09-01", classId: "seconde-3", skillIds: ["equations"], important: false },
      { id: "skills", name: "Observation", date: "2026-09-02", classId: "seconde-3", skillIds: ["equations", "vecteurs"], important: false },
      { id: "absent", name: "Absence", date: "2026-09-03", classId: "seconde-3", skillIds: ["equations"], important: false },
      { id: "missing", name: "À saisir", date: "2026-09-04", classId: "seconde-3", skillIds: ["equations"], important: false },
      { id: "other", name: "Autre classe", date: "2026-09-05", classId: "other-class", skillIds: ["equations"], important: false },
    ],
    rawGrades: [
      { studentId, evaluationId: "zero", score: 0, absent: false },
      { studentId, evaluationId: "skills", score: null, absent: false, skillLevels: { equations: "fragile", statistiques: "maitrise" } },
      { studentId, evaluationId: "absent", score: null, absent: true, skillLevels: { equations: "maitrise" } },
      { studentId, evaluationId: "other", score: 19, absent: false, skillLevels: { equations: "maitrise" } },
      { studentId: "adam-benali", evaluationId: "missing", score: 17, absent: false, skillLevels: { equations: "maitrise" } },
    ],
  };
}

test("evidence preserves zero, absence, competency-only and missing as distinct states", () => {
  const data = fixture();
  const before = JSON.stringify(data);
  const rows = studentEvidence(studentId, "seconde-3", data);
  assert.deepEqual(rows.map((row) => [row.evaluation.id, row.state, row.score]), [
    ["missing", "missing", null], ["absent", "absent", null],
    ["skills", "skills_only", null], ["zero", "graded", 0],
  ]);
  assert.deepEqual(rows[0].levels, {});
  assert.deepEqual(rows[1].levels, {});
  assert.deepEqual(rows[2].levels, { equations: "fragile" });
  assert.deepEqual(rows[3].levels, {});
  assert.equal(JSON.stringify(data), before);
});

test("empty grade objects are not presented as competency observations", () => {
  const data = fixture();
  data.rawGrades.push({ studentId, evaluationId: "missing", score: null, absent: false });
  assert.equal(studentEvidence(studentId, "seconde-3", data)[0].state, "missing");
});

test("latest competency filter ignores unrelated grades and later absences or missing observations", () => {
  const data = fixture();
  const analysis = analyzeStudent(studentId, { ...defaultDataset, ...data });
  assert.equal(latestSkillLevel(analysis, "equations"), "fragile");
  assert.equal(latestSkillLevel(analysis, "vecteurs"), null);
  const options = { query: "", status: "all" as const, skillId: "equations", level: "fragile" as const };
  assert.equal(filterStudentRoster([analysis], options).length, 1);
  assert.equal(filterStudentRoster([analysis], { ...options, level: "maitrise" }).length, 0);
  assert.equal(filterStudentRoster([analysis], { ...options, skillId: "vecteurs", level: "missing" }).length, 1);
  assert.equal(filterStudentRoster([analysis], { ...options, skillId: "vecteurs", level: "non_maitrise" }).length, 0);
});

test("name, status and skill filters combine without changing the original roster", () => {
  const base = analyzeStudent(studentId, fixture());
  const roster = [
    { ...base, studentId: "zoe", name: "Zoé Martin", status: "normal" as const },
    { ...base, studentId: "lea", name: "Léa Dubois", status: "attention" as const },
  ];
  const options = { query: " LEA ", status: "attention" as const, skillId: "equations", level: "fragile" as const };
  assert.deepEqual(filterStudentRoster(roster, options).map((row) => row.studentId), ["lea"]);
  assert.equal(filterStudentRoster(roster, { ...options, status: "normal" }).length, 0);
  assert.deepEqual(filterStudentRoster(roster, { query: "", status: "all", skillId: "", level: "all" }).map((row) => row.studentId), ["lea", "zoe"]);
  assert.deepEqual(roster.map((row) => row.studentId), ["zoe", "lea"]);
});

test("a new explicit observation updates the filtered group and dated evidence together", () => {
  const data = fixture();
  data.rawGrades.push({ studentId, evaluationId: "missing", score: null, absent: false, skillLevels: { equations: "en_cours" } });
  const analysis = analyzeStudent(studentId, { ...defaultDataset, ...data });
  assert.equal(latestSkillLevel(analysis, "equations"), "en_cours");
  assert.equal(studentEvidence(studentId, "seconde-3", data)[0].levels.equations, "en_cours");
  assert.equal(filterStudentRoster([analysis], { query: "", status: "all", skillId: "equations", level: "fragile" }).length, 0);
});
