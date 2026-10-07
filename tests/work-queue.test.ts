import { test } from "node:test";
import assert from "node:assert/strict";
import { classWorkItems } from "../lib/pedagogy/work-queue";
import type { EvaluationDataset } from "../lib/types";

const dataset: EvaluationDataset = {
  classes: [
    { id: "c1", name: "Seconde 2", level: "Seconde", subject: "Mathématiques", teacher: "Claire Martin", studentIds: ["s1", "s2", "s3"] },
    { id: "c2", name: "Seconde 4", level: "Seconde", subject: "Mathématiques", teacher: "Claire Martin", studentIds: ["s9"] },
  ],
  students: [
    { id: "s1", name: "Ana", classId: "c1" },
    { id: "s2", name: "Bilal", classId: "c1" },
    { id: "s3", name: "Chloé", classId: "c1" },
    { id: "s9", name: "Zoé", classId: "c2" },
  ],
  skills: [],
  evaluations: [
    { id: "old", name: "Contrôle 1", date: "2026-09-10", classId: "c1", skillIds: [], important: false },
    { id: "new", name: "Contrôle 2", date: "2026-09-20", classId: "c1", skillIds: [], important: false },
    { id: "other-class", name: "Contrôle Z", date: "2026-09-21", classId: "c2", skillIds: [], important: false },
    { id: "not-math", name: "Hors queue", date: "2026-09-22", classId: "c1", skillIds: [], important: false },
  ],
  rawGrades: [{ studentId: "s3", evaluationId: "new", score: null, absent: true }],
};

test("dashboard items: reviews, analyses and missing evidence of the class, newest first", () => {
  const items = classWorkItems(
    {
      aiConfigured: true,
      assessments: [
        { assessmentId: "old", questionCount: 0, answeredStudentIds: [], needsAnalysisStudentIds: [], pendingReviews: [] },
        {
          assessmentId: "new",
          questionCount: 3,
          answeredStudentIds: ["s1"],
          needsAnalysisStudentIds: [],
          pendingReviews: [{ studentId: "s1", count: 2 }],
        },
        { assessmentId: "other-class", questionCount: 1, answeredStudentIds: ["s9"], needsAnalysisStudentIds: ["s9"], pendingReviews: [] },
      ],
    },
    "c1",
    dataset,
  );
  assert.equal(items.tracked, true);
  assert.deepEqual(items.review, [
    { kind: "review", studentId: "s1", studentName: "Ana", evaluationId: "new", evaluationName: "Contrôle 2", count: 2 },
  ]);
  assert.deepEqual(items.analyse, []);
  // s3 is absent from "new": one copy (s2) is missing, not two.
  assert.deepEqual(items.evidence, [
    { kind: "copies", evaluationId: "new", evaluationName: "Contrôle 2", entered: 1, expected: 2, firstMissingStudentId: "s2" },
    { kind: "subject", evaluationId: "old", evaluationName: "Contrôle 1" },
  ]);
});

test("a class with no tracked mathematics assessment shows no queue", () => {
  const items = classWorkItems({ aiConfigured: false, assessments: [] }, "c1", dataset);
  assert.equal(items.tracked, false);
  const other = classWorkItems(
    {
      aiConfigured: false,
      assessments: [{ assessmentId: "other-class", questionCount: 1, answeredStudentIds: ["s9"], needsAnalysisStudentIds: ["s9"], pendingReviews: [] }],
    },
    "c2",
    dataset,
  );
  assert.deepEqual(other.analyse, [{ kind: "analyse", evaluationId: "other-class", evaluationName: "Contrôle Z", studentIds: ["s9"] }]);
  assert.deepEqual(other.evidence, []);
});
