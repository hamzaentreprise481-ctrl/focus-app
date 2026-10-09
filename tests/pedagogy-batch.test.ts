import test from "node:test";
import assert from "node:assert/strict";
import { batchStopReason, batchSummaryText, copiesToAnalyse, summarizeBatch, type BatchItem } from "../lib/pedagogy/batch";
import type { ResponseOverviewRow } from "../lib/pedagogy/types";

const row = (studentId: string, patch: Partial<ResponseOverviewRow> = {}): ResponseOverviewRow => ({
  studentId,
  answeredCount: 1,
  analysisStatus: null,
  needsAnalysis: true,
  pendingRecommendations: 0,
  ...patch,
});

test("only saved copies without a current analysis are queued, in roster order", () => {
  const students = [
    { id: "a", name: "Adam" },
    { id: "b", name: "Bea" },
    { id: "c", name: "Chloé" },
    { id: "d", name: "Dina" },
  ];
  const overview = new Map([
    ["d", row("d")],
    ["b", row("b", { needsAnalysis: false, analysisStatus: "errors_found" })],
    ["a", row("a")],
    // No row for c: nothing saved, nothing to analyse.
  ]);
  assert.deepEqual(copiesToAnalyse(students, overview).map((student) => student.id), ["a", "d"]);
});

const ok = (status: "errors_found" | "no_error_observed" | "insufficient_evidence", recommendationCount = 0): BatchItem => ({
  studentId: status,
  name: status,
  status,
  recommendationCount,
  reused: false,
});
const failed: BatchItem = { studentId: "x", name: "X", status: "failed", error: "Le service d’analyse n’a pas répondu à temps." };

test("the loop stops on a missing key, the hourly limit or three failures in a row", () => {
  assert.match(batchStopReason([failed], "ai_not_configured") ?? "", /pas configurée/);
  assert.match(batchStopReason([failed], "rate_limited") ?? "", /limite horaire/);
  // Credit and configuration stop at the first copy: every other copy would fail the same way.
  assert.match(batchStopReason([failed], "quota_exhausted") ?? "", /crédit .* épuisé/);
  assert.match(batchStopReason([failed], "ai_misconfigured") ?? "", /refuse la configuration/);
  assert.match(batchStopReason([failed], "provider_busy") ?? "", /saturé/);
  // Not a mathematics assessment, or not this teacher's student: the action's own reason.
  const refused: BatchItem = { studentId: "y", name: "Y", status: "failed", error: "La V1 de l’IA pédagogique est limitée aux mathématiques." };
  assert.equal(batchStopReason([refused], "not_available"), "La V1 de l’IA pédagogique est limitée aux mathématiques.");
  assert.equal(batchStopReason([failed, failed]), null);
  assert.equal(batchStopReason([failed, failed, ok("errors_found", 1), failed]), null);
  assert.match(batchStopReason([ok("no_error_observed"), failed, failed, failed]) ?? "", /3 échecs consécutifs/);
});

test("the summary counts each outcome and never calls 'no error' mastery", () => {
  const items = [ok("errors_found", 2), ok("errors_found", 1), ok("no_error_observed"), ok("insufficient_evidence"), failed];
  const summary = summarizeBatch(items);
  assert.deepEqual(summary, { analysed: 4, errorsFound: 2, noErrorObserved: 1, insufficientEvidence: 1, failed: 1, hypotheses: 3 });
  assert.equal(
    batchSummaryText(summary),
    "4 copies analysées : 2 copies avec erreur(s) observée(s) (3 hypothèses à examiner) ; 1 copie sans erreur observée — ce n’est pas une preuve de maîtrise ; 1 copie : preuves insuffisantes ; 1 échec, à relancer.",
  );
  assert.equal(batchSummaryText(summarizeBatch([])), "Aucune copie n’attendait d’analyse.");
});
