import test from "node:test";
import assert from "node:assert/strict";
import { releaseGateFailures } from "../lib/pedagogy/benchmark";

const passing = {
  cases: 47,
  failures: 0,
  statusAccuracy: 0.98,
  falsePositiveCaseRate: 0.05,
  falseNegativeCaseRate: 0.03,
  findingPrecision: 0.97,
  findingRecall: 0.97,
  exactQuestionAccuracy: 0.97,
  notionAccuracy: 1,
  errorTypeAccuracy: 0.95,
  literalEvidenceValidity: 1,
  catalogueCodeValidity: 1,
  catalogueMatchAccuracy: 0.92,
  insufficientEvidenceRecall: 0.83,
  insufficientEvidencePrecision: 1,
  latencyMs: { median: 3000, p90: 5000, max: 7000 },
  totalTokens: { sum: 1, median: 1 },
  byCategory: {},
  rejectionReasons: {},
} as const;

test("V1 benchmark gate accepts a strong, safe result", () => {
  assert.deepEqual(releaseGateFailures(passing), []);
});

test("V1 benchmark gate rejects missing errors and model failures", () => {
  const failures = releaseGateFailures({
    ...passing,
    failures: 2,
    statusAccuracy: 0.87,
    falseNegativeCaseRate: 0.14,
    findingRecall: 0.88,
  });
  assert.ok(failures.some((item) => item.startsWith("failures=")));
  assert.ok(failures.some((item) => item.startsWith("statusAccuracy=")));
  assert.ok(failures.some((item) => item.startsWith("falseNegativeCaseRate=")));
  assert.ok(failures.some((item) => item.startsWith("findingRecall=")));
});
