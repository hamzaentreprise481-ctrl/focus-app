import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizedResponses,
  scanCopyIssue,
  type ScanCopyCandidate,
  type ScanQuestion,
} from "../lib/scan-import-core";

const questions: ScanQuestion[] = [
  { id: "11111111-1111-4111-8111-111111111111", position: 1, prompt: "Q1", maxPoints: 4 },
  { id: "22222222-2222-4222-8222-222222222222", position: 2, prompt: "Q2", maxPoints: 6 },
];

function copy(patch: Partial<ScanCopyCandidate> = {}): ScanCopyCandidate {
  return {
    studentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    studentNameRead: "Alice Martin",
    identificationConfidence: 0.99,
    groupingConfidence: 0.99,
    transcriptionConfidence: 0.95,
    startPage: 1,
    endPage: 3,
    score: 14.5,
    scoreConfidence: 0.99,
    responses: [
      {
        questionId: questions[0].id,
        responseText: "x = 2",
        awardedPoints: "4",
        teacherAnnotation: "OK",
      },
      {
        questionId: questions[1].id,
        responseText: "Calcul",
        awardedPoints: "3,5",
        teacherAnnotation: "",
      },
    ],
    warnings: [],
    ...patch,
  };
}

test("scan import auto-accepts only a high-confidence known student", () => {
  const ids = new Set(["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]);
  assert.equal(scanCopyIssue(copy(), ids, questions), null);
  assert.equal(
    scanCopyIssue(copy({ identificationConfidence: 0.7 }), ids, questions),
    "Nom de l’élève à confirmer.",
  );
  assert.equal(
    scanCopyIssue(copy({ scoreConfidence: 0.7 }), ids, questions),
    "Note à confirmer.",
  );
  assert.equal(
    scanCopyIssue(copy({ warnings: ["page ambiguë"] }), ids, questions),
    "page ambiguë",
  );
});

test("scan import refuses impossible awarded points", () => {
  const ids = new Set(["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]);
  const candidate = copy({
    responses: [
      {
        questionId: questions[0].id,
        responseText: "x = 2",
        awardedPoints: "5",
        teacherAnnotation: "",
      },
      {
        questionId: questions[1].id,
        responseText: "suite",
        awardedPoints: "2",
        teacherAnnotation: "",
      },
    ],
  });
  assert.equal(
    scanCopyIssue(candidate, ids, questions),
    "Points attribués à confirmer.",
  );
});

test("scan import sends missing scores and incomplete grouping to review", () => {
  const ids = new Set(["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]);
  assert.equal(
    scanCopyIssue(copy({ score: null }), ids, questions),
    "Note non détectée : à confirmer.",
  );
  assert.equal(
    scanCopyIssue(copy({ startPage: 4, endPage: 2 }), ids, questions),
    "Séparation des pages à confirmer.",
  );
  assert.equal(
    scanCopyIssue(copy({ responses: copy().responses.slice(0, 1) }), ids, questions),
    "Toutes les questions n’ont pas été reconnues.",
  );
});

test("scan import normalizes every assessment question and decimal commas", () => {
  const candidate = copy({
    responses: [
      {
        questionId: questions[1].id,
        responseText: "  réponse  ",
        awardedPoints: "3,5",
        teacherAnnotation: "  vu  ",
      },
    ],
  });
  assert.deepEqual(normalizedResponses(candidate, questions), [
    {
      questionId: questions[0].id,
      responseText: "",
      awardedPoints: "",
      teacherAnnotation: "",
    },
    {
      questionId: questions[1].id,
      responseText: "réponse",
      awardedPoints: "3.5",
      teacherAnnotation: "vu",
    },
  ]);
});
