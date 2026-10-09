// What FOCUS keeps from a machine reading of a handwritten copy: the
// legibility of each answer is computed from the reader's status AND the
// markers in its text (never from a confidence number), evidence may only
// rest on passages read with certainty, and nothing uncertain is imported
// without the teacher.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  excerptIsReliable,
  legibilityOf,
  markerRanges,
  normalizeMarkers,
  scanCopyIssue,
  teacherCheckedLegibility,
  transcriptionLooksCorrected,
  type ScanCopyCandidate,
  type ScanQuestion,
  type ScanResponseCandidate,
} from "../lib/scan-import-core";

const STUDENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const questions: ScanQuestion[] = [
  { id: "11111111-1111-4111-8111-111111111111", position: 1, prompt: "Développer (x+5)²", maxPoints: 2, correctionText: "x² + 10x + 25" },
  { id: "22222222-2222-4222-8222-222222222222", position: 2, prompt: "Résoudre 4x − 7 = 13", maxPoints: 2, correctionText: "x = 5" },
];

const response = (questionId: string, patch: Partial<ScanResponseCandidate> = {}): ScanResponseCandidate => ({
  questionId,
  responseText: "x² + 25",
  awardedPoints: "0",
  teacherAnnotation: "",
  legibility: "lisible",
  crossedOut: "",
  ...patch,
});

const copy = (patch: Partial<ScanCopyCandidate> = {}): ScanCopyCandidate => ({
  studentId: STUDENT,
  studentNameRead: "Lucas Bernard",
  identificationConfidence: 0.99,
  groupingConfidence: 0.99,
  startPage: 1,
  endPage: 1,
  score: 11,
  scoreConfidence: 0.99,
  responses: [response(questions[0].id), response(questions[1].id, { responseText: "4x = 20 ; x = 5", awardedPoints: "2" })],
  warnings: [],
  ...patch,
});

test("legibility comes from the status and the markers, not from a confidence", () => {
  assert.equal(legibilityOf("ecrite", "4x = 20 ; x = 5"), "lisible");
  // The reader said "written" but left a marker: it is partial whatever it says.
  assert.equal(legibilityOf("ecrite", "B = x² + [illisible] + 25"), "partielle");
  assert.equal(legibilityOf("ecrite", "x = [?7]"), "partielle");
  assert.equal(legibilityOf("partielle", "x = 5"), "partielle");
  // Only markers and separators: nothing reliable was read.
  assert.equal(legibilityOf("partielle", "[illisible] ; [illisible]"), "illisible");
  assert.equal(legibilityOf("illisible", ""), "illisible");
  assert.equal(legibilityOf("illisible", "x"), "illisible");
  // Empty is "no answer" only when the reader saw an empty space.
  assert.equal(legibilityOf("vide", ""), "vide");
  assert.equal(legibilityOf("absente", ""), "absente");
  assert.equal(legibilityOf("absente", "x = 5"), "partielle");
  assert.equal(normalizeMarkers("a [ Illisible ] b"), "a [illisible] b");
  assert.deepEqual(markerRanges("x [?7] = [illisible]"), [[2, 6], [9, 20]]);
});

test("the teacher's checked text is authoritative: only the markers left in it count", () => {
  assert.equal(teacherCheckedLegibility("partielle", "B = x² + 10x + 25"), "lisible");
  assert.equal(teacherCheckedLegibility("lisible", "B = x² + [illisible]"), "partielle");
  assert.equal(teacherCheckedLegibility("illisible", ""), "illisible");
  assert.equal(teacherCheckedLegibility("absente", ""), "absente");
  assert.equal(teacherCheckedLegibility("lisible", ""), "vide");
});

test("evidence may only quote what was read with certainty", () => {
  const text = "B = x² + [?10x] + 25 ; B = x² + 25";
  assert.equal(excerptIsReliable("x² + 25", text), true, "a second, clean occurrence exists");
  assert.equal(excerptIsReliable("[?10x]", text), false);
  assert.equal(excerptIsReliable("+ [?10", text), false, "touches an uncertain reading");
  assert.equal(excerptIsReliable("x] + 25", text), false);
  assert.equal(excerptIsReliable("x = 8", "x = [illisible]"), false, "not in the text at all");
  assert.equal(excerptIsReliable("", text), false);
});

test("a transcription equal to the correction on a question without full marks is suspicious", () => {
  assert.equal(transcriptionLooksCorrected(response(questions[0].id, { responseText: "x²+10x+25", awardedPoints: "0" }), questions[0]), true);
  assert.equal(transcriptionLooksCorrected(response(questions[0].id, { responseText: "x²+10x+25", awardedPoints: "2" }), questions[0]), false);
  assert.equal(transcriptionLooksCorrected(response(questions[0].id, { responseText: "x²+10x+25", awardedPoints: "" }), questions[0]), false);
  assert.equal(transcriptionLooksCorrected(response(questions[0].id, { responseText: "x² + 25", awardedPoints: "0" }), questions[0]), false);
});

test("nothing uncertain is imported without the teacher", () => {
  const ids = new Set([STUDENT]);
  assert.equal(scanCopyIssue(copy(), ids, questions, [{ page: 1, orientation: 0, quality: "bonne", issues: [] }]), null);
  const partial = copy({ responses: [response(questions[0].id, { legibility: "partielle", responseText: "x² + [illisible]" }), copy().responses[1]] });
  assert.match(scanCopyIssue(partial, ids, questions)!, /illisibles ou incertains/);
  const illegible = copy({ responses: [response(questions[0].id, { legibility: "illisible", responseText: "[illisible]" }), copy().responses[1]] });
  assert.match(scanCopyIssue(illegible, ids, questions)!, /illisibles ou incertains/);
  const cut = copy({ responses: [copy().responses[0], response(questions[1].id, { legibility: "absente", responseText: "" })] });
  assert.match(scanCopyIssue(cut, ids, questions)!, /n’apparaît pas sur l’image/);
  const corrected = copy({ responses: [response(questions[0].id, { responseText: "x² + 10x + 25", awardedPoints: "0" }), copy().responses[1]] });
  assert.match(scanCopyIssue(corrected, ids, questions)!, /identique au corrigé/);
  for (const page of [
    { page: 1, orientation: 0, quality: "degradee", issues: [] },
    { page: 1, orientation: 0, quality: "bonne", issues: ["floue"] },
    { page: 1, orientation: 90, quality: "bonne", issues: ["coupee"] },
  ] as const)
    assert.match(scanCopyIssue(copy(), ids, questions, [{ ...page, issues: [...page.issues] }])!, /Qualité de l’image/);
  // A page of another copy does not block this one.
  assert.equal(scanCopyIssue(copy(), ids, questions, [{ page: 2, orientation: 0, quality: "inutilisable", issues: ["floue"] }]), null);
});
