// The benchmark itself is tested offline: the cases are well-formed against
// the real curriculum, an ideal model scores 100 % through the production
// validators, and adversarial model outputs are refused by those same
// validators. No model is called here.

import { before, test } from "node:test";
import assert from "node:assert/strict";
import { aggregate, scoreCase, type BenchmarkCase, type BenchmarkCategory } from "../lib/pedagogy/benchmark";
import { PEDAGOGY_BENCHMARK } from "./fixtures/pedagogy-benchmark";
import { benchmarkUuid, loadProductionCurriculum, questionIdsOf, referenceOutput, runCase, type BenchmarkContext } from "./helpers/benchmark-runner";

let context: BenchmarkContext;
before(async () => {
  context = await loadProductionCurriculum();
});

const REQUIRED: BenchmarkCategory[] = [
  "correct",
  "obvious_error",
  "subtle_calculation",
  "reasoning",
  "prerequisite",
  "incomplete_or_ambiguous",
  "full_marks_unusual_wording",
  "matches_correction",
  "assessed_notions_restriction",
  "multiple_errors",
  "repeated_error",
  "prompt_injection",
  "only_insufficient",
  "safest_no_error",
  "close_notion",
  "catalogue_mismatch",
];

test("the case set is large, covers every category and is consistent with the real curriculum", () => {
  assert.ok(PEDAGOGY_BENCHMARK.length >= 40, `${PEDAGOGY_BENCHMARK.length} cases`);
  assert.equal(new Set(PEDAGOGY_BENCHMARK.map((item) => item.id)).size, PEDAGOGY_BENCHMARK.length);
  for (const category of REQUIRED) assert.ok(PEDAGOGY_BENCHMARK.some((item) => item.category === category), category);
  for (const item of PEDAGOGY_BENCHMARK) {
    const keys = new Set(item.questions.map((question) => question.key));
    assert.equal(keys.size, item.questions.length, item.id);
    for (const question of item.questions)
      for (const code of question.assessedNotions) assert.ok(context.graph.mappableNotionIdsByCode.has(code), `${item.id}: ${code}`);
    assert.equal(item.expected.errors.length > 0, item.expected.status === "errors_found", item.id);
    for (const error of item.expected.errors) {
      const question = item.questions.find((candidate) => candidate.key === error.question);
      assert.ok(question, `${item.id}: ${error.question}`);
      assert.ok(question.response.includes(error.excerpt), `${item.id}: excerpt not literal`);
      for (const code of error.notions) {
        assert.ok(context.graph.mappableNotionIdsByCode.has(code), `${item.id}: ${code} not a class notion`);
        assert.ok(context.relatedCodes(question.assessedNotions).has(code), `${item.id}: ${code} unrelated to ${question.assessedNotions}`);
      }
      if (error.catalogue) assert.ok(context.catalogueCodes.get(error.notions[0])?.has(error.catalogue), `${item.id}: ${error.catalogue}`);
    }
  }
});

async function score(cases: BenchmarkCase[], output: (item: BenchmarkCase) => unknown) {
  const scores = [];
  for (const item of cases) {
    const run = await runCase(item, context, async () => ({ raw: output(item), latencyMs: 1, totalTokens: 1 }));
    scores.push(scoreCase(item, run, questionIdsOf(item)));
  }
  return scores;
}

test("an ideal model scores 100 % through the production validators", async () => {
  const scores = await score(PEDAGOGY_BENCHMARK, referenceOutput);
  const wrong = scores.filter((item) => !item.statusCorrect || item.matchedErrors !== item.expectedErrors || item.falsePositives);
  assert.deepEqual(
    wrong.map((item) => ({ id: item.caseId, expected: item.expectedStatus, actual: item.actualStatus, rejected: item.rejected })),
    [],
  );
  const metrics = aggregate(scores);
  assert.equal(metrics.statusAccuracy, 1);
  assert.equal(metrics.falsePositiveCaseRate, 0);
  assert.equal(metrics.falseNegativeCaseRate, 0);
  assert.equal(metrics.notionAccuracy, 1);
  assert.equal(metrics.errorTypeAccuracy, 1);
  assert.equal(metrics.literalEvidenceValidity, 1);
  assert.equal(metrics.catalogueMatchAccuracy, 1);
  assert.equal(metrics.insufficientEvidenceRecall, 1);
});

test("a model that always says no error, or always accuses, is measured as such", async () => {
  const silent = aggregate(await score(PEDAGOGY_BENCHMARK, () => ({ status: "no_error_observed", insufficientReason: "", errors: [] })));
  assert.equal(silent.falseNegativeCaseRate, 1);
  assert.equal(silent.falsePositiveCaseRate, 0);
  assert.ok(silent.statusAccuracy! < 0.5);
  // Accuse every first question on its first assessed notion with its first word.
  const accusing = aggregate(
    await score(PEDAGOGY_BENCHMARK, (item) => {
      const ids = questionIdsOf(item);
      const question = item.questions.find((candidate) => candidate.response.trim()) ?? item.questions[0];
      return {
        status: "errors_found",
        insufficientReason: "",
        errors: [
          {
            assessmentId: benchmarkUuid(item.id),
            questionId: ids.get(question.key),
            nodeCode: question.assessedNotions[0],
            errorType: "calcul",
            difficulty: "Erreur",
            evidenceExcerpt: question.response.slice(0, 12),
            explanation: "Erreur de calcul.",
            recommendedAction: "Revoir.",
            catalogueErrorCode: "",
          },
        ],
      };
    }),
  );
  // The validators already refuse accusations on full marks or on an answer
  // equal to the correction; what remains is measured, not hidden.
  assert.ok(accusing.falsePositiveCaseRate! > 0 && accusing.falsePositiveCaseRate! < 1, `false positives ${accusing.falsePositiveCaseRate}`);
});

// Adversarial outputs: each must be refused by the validators, whatever the model says.
const withErrors = PEDAGOGY_BENCHMARK.filter((item) => item.expected.status === "errors_found");
type Mutation = [label: string, mutate: (error: Record<string, unknown>, item: BenchmarkCase) => void, reason: string | null];
const MUTATIONS: Mutation[] = [
  ["hallucinated excerpt", (error) => (error.evidenceExcerpt = "x = 42 (ce n’est pas dans la copie)"), "excerpt_not_in_answer"],
  ["wrong question id", (error) => (error.questionId = "00000000-0000-4000-8000-000000000000"), "unknown_question"],
  ["unrelated notion", (error) => (error.nodeCode = "MATH.PY.BOUCLES"), "unrelated_notion"],
  ["notion outside the programme", (error) => (error.nodeCode = "MATH.TERMINALE.LIMITES"), "not_a_class_notion"],
  ["overstated wording", (error) => (error.explanation = "L’élève ne comprend absolument rien aux mathématiques."), "overstated_or_non_pedagogical"],
  ["full marks given by the teacher", (_error, item) => item.questions.forEach((question) => (question.awardedPoints = question.maxPoints)), "teacher_full_marks"],
];

test("adversarial model outputs are refused on every case, and no finding survives", async () => {
  for (const [label, mutate, reason] of MUTATIONS) {
    for (const original of withErrors) {
      const item = structuredClone(original);
      const output = referenceOutput(item);
      for (const error of output.errors) mutate(error as Record<string, unknown>, item);
      if (label === "full marks given by the teacher" && item.questions.some((question) => question.maxPoints === null)) continue;
      const run = await runCase(item, context, async () => ({ raw: output, latencyMs: 1, totalTokens: 1 }));
      assert.equal(run.validated.errors.length, 0, `${label} on ${item.id}`);
      assert.equal(run.validated.status, "insufficient_evidence", `${label} on ${item.id}`);
      if (reason) assert.ok(run.validated.rejected.every((rejected) => rejected.reason === reason), `${label} on ${item.id}: ${JSON.stringify(run.validated.rejected)}`);
    }
  }
});

test("a catalogue code of another notion is dropped, the finding itself is kept", async () => {
  for (const original of withErrors) {
    const output = referenceOutput(original);
    for (const error of output.errors) error.catalogueErrorCode = "MATH.PY.BOUCLES.ERR.01";
    const run = await runCase(original, context, async () => ({ raw: output, latencyMs: 1, totalTokens: 1 }));
    assert.equal(run.validated.errors.length, original.expected.errors.length, original.id);
    assert.ok(run.validated.errors.every((error) => !error.catalogueErrorCode), original.id);
  }
});

test("errors listed under a no-error verdict never become findings", async () => {
  for (const original of withErrors) {
    const output = { ...referenceOutput(original), status: "no_error_observed" };
    const run = await runCase(original, context, async () => ({ raw: output, latencyMs: 1, totalTokens: 1 }));
    assert.equal(run.validated.status, "insufficient_evidence", original.id);
    assert.equal(run.validated.errors.length, 0);
  }
});
