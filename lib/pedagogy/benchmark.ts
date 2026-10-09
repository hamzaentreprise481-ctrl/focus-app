// Scoring of the pedagogical analysis against a fixed set of synthetic
// copies. Pure: the runner gives it the raw model output and the result of
// the production validators; nothing here relaxes a validator.

import type { RejectedCandidate, ValidatedModelAnalysis } from "@/lib/pedagogy/analysis";
import type { ModelAnalysisStatus } from "@/lib/pedagogy/types";

export type BenchmarkCategory =
  | "correct"
  | "obvious_error"
  | "subtle_calculation"
  | "reasoning"
  | "prerequisite"
  | "incomplete_or_ambiguous"
  | "full_marks_unusual_wording"
  | "matches_correction"
  | "assessed_notions_restriction"
  | "multiple_errors"
  | "repeated_error"
  | "prompt_injection"
  | "only_insufficient"
  | "safest_no_error"
  | "close_notion"
  | "catalogue_mismatch";

export interface BenchmarkQuestion {
  key: string;
  prompt: string;
  correction: string;
  rubric?: string;
  maxPoints: number | null;
  response: string;
  awardedPoints: number | null;
  annotation?: string;
  assessedNotions: string[];
}

export interface ExpectedError {
  question: string;
  /** Acceptable notion codes; the first is the most precise. */
  notions: string[];
  errorTypes: string[];
  /** Literal part of the answer that shows the error (reference output). */
  excerpt: string;
  /** Expected catalogue code; null = none fits; undefined = not scored. */
  catalogue?: string | null;
}

export interface BenchmarkCase {
  id: string;
  category: BenchmarkCategory;
  label: string;
  title: string;
  context?: string;
  questions: BenchmarkQuestion[];
  expected: { status: ModelAnalysisStatus; errors: ExpectedError[] };
}

export interface CaseRun {
  caseId: string;
  category: BenchmarkCategory;
  modelCalled: boolean;
  /** Raw model output, before any FOCUS check (null when not called or failed). */
  raw: unknown;
  validated: ValidatedModelAnalysis;
  latencyMs: number | null;
  totalTokens: number | null;
  failure: string | null;
}

export interface CaseScore {
  caseId: string;
  category: BenchmarkCategory;
  expectedStatus: ModelAnalysisStatus;
  actualStatus: ModelAnalysisStatus;
  statusCorrect: boolean;
  expectedErrors: number;
  reportedErrors: number;
  matchedErrors: number;
  questionMatches: number;
  notionMatches: number;
  errorTypeMatches: number;
  falsePositives: number;
  rawCandidates: number;
  rawLiteralValid: number;
  rawWithCatalogue: number;
  rawCatalogueValid: number;
  catalogueScored: number;
  catalogueCorrect: number;
  rejected: RejectedCandidate[];
  latencyMs: number | null;
  totalTokens: number | null;
  failure: string | null;
}

const ratio = (numerator: number, denominator: number) => (denominator ? Math.round((numerator / denominator) * 1000) / 1000 : null);

function rawErrors(raw: unknown): Array<Record<string, unknown>> {
  const errors = (raw as { errors?: unknown } | null)?.errors;
  return Array.isArray(errors) ? errors.filter((item): item is Record<string, unknown> => !!item && typeof item === "object") : [];
}

export function scoreCase(testCase: BenchmarkCase, run: CaseRun, questionIds: Map<string, string>): CaseScore {
  const reported = run.validated.errors;
  const used = new Set<number>();
  let matched = 0;
  let questionMatches = 0;
  let notionMatches = 0;
  let errorTypeMatches = 0;
  let catalogueScored = 0;
  let catalogueCorrect = 0;
  for (const expected of testCase.expected.errors) {
    const questionId = questionIds.get(expected.question);
    const onQuestion = reported.map((error, index) => ({ error, index })).filter(({ error, index }) => error.questionId === questionId && !used.has(index));
    if (!onQuestion.length) continue;
    questionMatches++;
    const withNotion = onQuestion.find(({ error }) => expected.notions.includes(error.nodeCode));
    if (!withNotion) continue;
    used.add(withNotion.index);
    matched++;
    notionMatches++;
    if (expected.errorTypes.includes(withNotion.error.errorType)) errorTypeMatches++;
    if (expected.catalogue !== undefined) {
      catalogueScored++;
      if ((withNotion.error.catalogueErrorCode || null) === expected.catalogue) catalogueCorrect++;
    }
  }
  const raws = rawErrors(run.raw);
  const literalRejections = run.validated.rejected.filter((item) => item.reason === "excerpt_not_in_answer" || item.reason === "excerpt_too_short").length;
  const withCatalogue = raws.filter((item) => typeof item.catalogueErrorCode === "string" && item.catalogueErrorCode.trim());
  const keptCatalogue = reported.filter((error) => error.catalogueErrorCode).length;
  return {
    caseId: testCase.id,
    category: testCase.category,
    expectedStatus: testCase.expected.status,
    actualStatus: run.validated.status,
    statusCorrect: run.validated.status === testCase.expected.status,
    expectedErrors: testCase.expected.errors.length,
    reportedErrors: reported.length,
    matchedErrors: matched,
    questionMatches,
    notionMatches,
    errorTypeMatches,
    falsePositives: reported.length - used.size,
    rawCandidates: raws.length,
    rawLiteralValid: Math.max(0, raws.length - literalRejections),
    rawWithCatalogue: withCatalogue.length,
    rawCatalogueValid: Math.min(keptCatalogue, withCatalogue.length),
    catalogueScored,
    catalogueCorrect,
    rejected: run.validated.rejected,
    latencyMs: run.latencyMs,
    totalTokens: run.totalTokens,
    failure: run.failure,
  };
}

function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

export function aggregate(scores: CaseScore[]) {
  const sum = (pick: (score: CaseScore) => number) => scores.reduce((total, score) => total + pick(score), 0);
  const noErrorCases = scores.filter((score) => score.expectedStatus !== "errors_found");
  const errorCases = scores.filter((score) => score.expectedStatus === "errors_found");
  const insufficientExpected = scores.filter((score) => score.expectedStatus === "insufficient_evidence");
  const insufficientPredicted = scores.filter((score) => score.actualStatus === "insufficient_evidence");
  const latencies = scores.map((score) => score.latencyMs).filter((value): value is number => value !== null);
  const tokens = scores.map((score) => score.totalTokens).filter((value): value is number => value !== null);
  const byCategory: Record<string, { cases: number; statusCorrect: number }> = {};
  for (const score of scores) {
    const entry = (byCategory[score.category] ??= { cases: 0, statusCorrect: 0 });
    entry.cases++;
    if (score.statusCorrect) entry.statusCorrect++;
  }
  const rejectionReasons: Record<string, number> = {};
  for (const score of scores) for (const item of score.rejected) rejectionReasons[item.reason] = (rejectionReasons[item.reason] ?? 0) + 1;
  return {
    cases: scores.length,
    failures: scores.filter((score) => score.failure).length,
    statusAccuracy: ratio(sum((score) => (score.statusCorrect ? 1 : 0)), scores.length),
    /** Cases with no expected error in which at least one error was reported. */
    falsePositiveCaseRate: ratio(noErrorCases.filter((score) => score.reportedErrors > 0).length, noErrorCases.length),
    /** Cases with expected errors in which no expected error was found. */
    falseNegativeCaseRate: ratio(errorCases.filter((score) => score.matchedErrors === 0).length, errorCases.length),
    findingPrecision: ratio(sum((score) => score.matchedErrors), sum((score) => score.reportedErrors)),
    findingRecall: ratio(sum((score) => score.matchedErrors), sum((score) => score.expectedErrors)),
    exactQuestionAccuracy: ratio(sum((score) => score.questionMatches), sum((score) => score.expectedErrors)),
    notionAccuracy: ratio(sum((score) => score.notionMatches), sum((score) => score.questionMatches)),
    errorTypeAccuracy: ratio(sum((score) => score.errorTypeMatches), sum((score) => score.notionMatches)),
    /** Raw model candidates whose excerpt is literally in the answer. */
    literalEvidenceValidity: ratio(sum((score) => score.rawLiteralValid), sum((score) => score.rawCandidates)),
    /** Raw candidates' catalogue codes that belong to their notion. */
    catalogueCodeValidity: ratio(sum((score) => score.rawCatalogueValid), sum((score) => score.rawWithCatalogue)),
    catalogueMatchAccuracy: ratio(sum((score) => score.catalogueCorrect), sum((score) => score.catalogueScored)),
    insufficientEvidenceRecall: ratio(insufficientExpected.filter((score) => score.actualStatus === "insufficient_evidence").length, insufficientExpected.length),
    insufficientEvidencePrecision: ratio(insufficientPredicted.filter((score) => score.expectedStatus === "insufficient_evidence").length, insufficientPredicted.length),
    latencyMs: { median: percentile(latencies, 50), p90: percentile(latencies, 90), max: latencies.length ? Math.max(...latencies) : null },
    totalTokens: { sum: tokens.length ? tokens.reduce((a, b) => a + b, 0) : null, median: percentile(tokens, 50) },
    byCategory,
    rejectionReasons,
  };
}


export type BenchmarkMetrics = ReturnType<typeof aggregate>;

/**
 * Release criteria for the fixed 47-case pedagogical benchmark.
 * These are intentionally safety-oriented: a release must not trade missing
 * real errors for a superficially clean output.
 */
export function releaseGateFailures(metrics: BenchmarkMetrics): string[] {
  const failures: string[] = [];
  const atLeast = (name: string, value: number | null, minimum: number) => {
    if (value === null || value < minimum) failures.push(`${name}=${value ?? "null"} < ${minimum}`);
  };
  const atMost = (name: string, value: number | null, maximum: number) => {
    if (value === null || value > maximum) failures.push(`${name}=${value ?? "null"} > ${maximum}`);
  };

  if (metrics.cases < 47) failures.push(`cases=${metrics.cases} < 47`);
  if (metrics.failures !== 0) failures.push(`failures=${metrics.failures} != 0`);
  atLeast("statusAccuracy", metrics.statusAccuracy, 0.95);
  atMost("falsePositiveCaseRate", metrics.falsePositiveCaseRate, 0.08);
  atMost("falseNegativeCaseRate", metrics.falseNegativeCaseRate, 0.05);
  atLeast("findingPrecision", metrics.findingPrecision, 0.95);
  atLeast("findingRecall", metrics.findingRecall, 0.95);
  atLeast("exactQuestionAccuracy", metrics.exactQuestionAccuracy, 0.95);
  atLeast("notionAccuracy", metrics.notionAccuracy, 0.98);
  atLeast("literalEvidenceValidity", metrics.literalEvidenceValidity, 1);
  atLeast("catalogueCodeValidity", metrics.catalogueCodeValidity, 1);
  atLeast("insufficientEvidenceRecall", metrics.insufficientEvidenceRecall, 0.8);
  atLeast("insufficientEvidencePrecision", metrics.insufficientEvidencePrecision, 0.8);
  return failures;
}
