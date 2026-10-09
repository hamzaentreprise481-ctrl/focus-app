// One outcome per question, decided by FOCUS's checks rather than taken from
// the model: what the evidence alone decides (nothing written, illegible,
// absent from the image) overrides the model; a finding needs a reliable
// excerpt and an agreeing outcome; an "error" without a surviving proof is
// never shown as one; the copy-level status is derived from the outcomes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { evidenceOnlyOutcomes, validateModelAnalysis, type QuestionEvidenceForValidation } from "../lib/pedagogy/analysis";

const A = "assessment-1";
const nodes = new Map([
  ["MATH.ALG.IDENTITES", "node-identites"],
  ["MATH.NUM.FRACTIONS.OPERATIONS", "node-fractions"],
  ["MATH.ALG.EQUATION_PREMIER_DEGRE", "node-equation"],
]);

function q(id: string, responseText: string, patch: Partial<QuestionEvidenceForValidation> = {}): QuestionEvidenceForValidation {
  return { assessmentId: A, questionId: id, responseText, maxPoints: 2, awardedPoints: 0, ...patch };
}

const error = (questionId: string, evidenceExcerpt: string, nodeCode = "MATH.ALG.IDENTITES") => ({
  assessmentId: A,
  questionId,
  nodeCode,
  errorType: "concept",
  difficulty: "Développer le carré d’une somme",
  evidenceExcerpt,
  explanation: "Le double produit est absent.",
  recommendedAction: "Faire calculer (a+b)(a+b) terme à terme.",
  catalogueErrorCode: "",
});

const outcome = (questionId: string, value: string, observedExcerpt = "", note = "") => ({ questionId, outcome: value, observedExcerpt, note });

test("a clearly read error on one question, other outcomes kept question by question", () => {
  const questions = [q("q1", "B = x² + 25"), q("q2", "4x = 20"), q("q3", ""), q("q4", "x = 5", { awardedPoints: 2 })];
  const result = validateModelAnalysis(
    {
      status: "errors_found",
      insufficientReason: "",
      errors: [error("q1", "x² + 25")],
      questionOutcomes: [
        outcome("q1", "error", "x² + 25"),
        outcome("q2", "incomplete", "4x = 20", "Le calcul s’arrête avant la valeur de x."),
        outcome("q3", "no_answer"),
        outcome("q4", "no_error_observed"),
      ],
    },
    questions,
    nodes,
  );
  assert.equal(result.status, "errors_found");
  assert.equal(result.errors.length, 1);
  assert.deepEqual(
    result.questionOutcomes.map((item) => [item.questionId, item.outcome, item.excerpt]),
    [
      ["q1", "error", "x² + 25"],
      ["q2", "incomplete", "4x = 20"],
      ["q3", "no_answer", ""],
      ["q4", "no_error_observed", ""],
    ],
  );
});

test("an illegible answer is never diagnosed, whatever the model says (even with 0 points)", () => {
  const questions = [
    q("q1", "[illisible]", { legibility: "illisible" }),
    q("q2", "B = x² + [illisible] + 25", { legibility: "partielle" }),
    q("q3", "x = 5"),
  ];
  const result = validateModelAnalysis(
    {
      status: "errors_found",
      insufficientReason: "",
      // The model "guesses" what was under the blot, and quotes the marker.
      errors: [error("q1", "[illisible]"), error("q2", "x² + [illisible]")],
      questionOutcomes: [outcome("q1", "error"), outcome("q2", "error"), outcome("q3", "no_error_observed")],
    },
    questions,
    nodes,
  );
  assert.equal(result.errors.length, 0);
  assert.equal(result.status, "insufficient_evidence");
  assert.deepEqual(
    result.rejected.map((item) => item.reason).sort(),
    ["illegible_answer", "uncertain_transcription"],
  );
  assert.equal(result.questionOutcomes[0].outcome, "illegible");
  assert.match(result.questionOutcomes[0].note, /insuffisamment lisible/);
  assert.equal(result.questionOutcomes[1].outcome, "insufficient_evidence");
  assert.match(result.questionOutcomes[1].note, /n’a pas passé les contrôles/);
  assert.equal(result.questionOutcomes[2].outcome, "no_error_observed");
  assert.match(result.insufficientReason, /Q1 : passage illisible/);
});

test("what the evidence alone decides overrides the model; absent zones are never 'no answer'", () => {
  const questions = [q("q1", ""), q("q2", "", { legibility: "absente" }), q("q3", "x = 5")];
  const result = validateModelAnalysis(
    {
      status: "no_error_observed",
      insufficientReason: "",
      errors: [],
      questionOutcomes: [outcome("q1", "no_error_observed"), outcome("q2", "no_answer"), outcome("q3", "no_error_observed")],
    },
    questions,
    nodes,
  );
  assert.deepEqual(result.questionOutcomes.map((item) => item.outcome), ["no_answer", "insufficient_evidence", "no_error_observed"]);
  assert.match(result.questionOutcomes[1].note, /n’apparaît pas sur l’image/);
  // A question absent from the image blocks a clean bill for the copy.
  assert.equal(result.status, "insufficient_evidence");
});

test("contradictions are never resolved in favour of a diagnosis", () => {
  const questions = [q("q1", "B = x² + 25"), q("q2", "2/3 + 1/4 = 3/7")];
  const result = validateModelAnalysis(
    {
      status: "errors_found",
      insufficientReason: "",
      errors: [error("q1", "x² + 25"), error("q2", "3/7", "MATH.NUM.FRACTIONS.OPERATIONS")],
      // The model lists an error on q1 but also says q1 has none.
      questionOutcomes: [outcome("q1", "no_error_observed"), outcome("q2", "error")],
    },
    questions,
    nodes,
  );
  assert.deepEqual(result.errors.map((item) => item.questionId), ["q2"]);
  assert.equal(result.rejected.find((item) => item.questionId === "q1")?.reason, "contradicts_outcome");
  assert.equal(result.questionOutcomes[0].outcome, "insufficient_evidence");
  assert.equal(result.status, "errors_found");
});

test("an error without a surviving proof is shown as insufficient evidence, not as an error", () => {
  const questions = [q("q1", "B = x² + 25")];
  const result = validateModelAnalysis(
    {
      status: "errors_found",
      insufficientReason: "",
      errors: [error("q1", "x² + 5²")], // not in the answer
      questionOutcomes: [outcome("q1", "error", "x² + 5²")],
    },
    questions,
    nodes,
  );
  assert.equal(result.status, "insufficient_evidence");
  assert.equal(result.questionOutcomes[0].outcome, "insufficient_evidence");
  assert.equal(result.questionOutcomes[0].excerpt, "", "an excerpt that is not in the answer is never kept");
});

test("a model that declares insufficient evidence keeps no finding", () => {
  const result = validateModelAnalysis(
    { status: "insufficient_evidence", insufficientReason: "Réponse ambiguë.", errors: [error("q1", "x² + 25")], questionOutcomes: [outcome("q1", "insufficient_evidence")] },
    [q("q1", "B = x² + 25")],
    nodes,
  );
  assert.equal(result.errors.length, 0);
  assert.equal(result.insufficientReason, "Réponse ambiguë.");
});

test("notes about a question follow the same wording rules as findings", () => {
  const result = validateModelAnalysis(
    {
      status: "insufficient_evidence",
      insufficientReason: "",
      errors: [],
      questionOutcomes: [outcome("q1", "incomplete", "4x = 20", "L’élève ne maîtrise absolument rien, sans doute dyslexique.")],
    },
    [q("q1", "4x = 20")],
    nodes,
  );
  assert.equal(result.questionOutcomes[0].outcome, "incomplete");
  assert.equal(result.questionOutcomes[0].note, "");
});

test("unanswered questions do not block 'no error observed' for what was written", () => {
  const result = validateModelAnalysis(
    { status: "no_error_observed", insufficientReason: "", errors: [], questionOutcomes: [outcome("q1", "no_error_observed"), outcome("q2", "no_answer")] },
    [q("q1", "x = 5", { awardedPoints: 2 }), q("q2", "")],
    nodes,
  );
  assert.equal(result.status, "no_error_observed");
});

test("missing or unknown outcomes are never invented as findings or as mastery", () => {
  const result = validateModelAnalysis(
    { status: "no_error_observed", insufficientReason: "", errors: [], questionOutcomes: [outcome("q-unknown", "no_error_observed"), outcome("q1", "bravo")] },
    [q("q1", "x = 5")],
    nodes,
  );
  assert.equal(result.questionOutcomes[0].outcome, "insufficient_evidence");
  assert.equal(result.status, "insufficient_evidence");
});

test("when every question is decided by the evidence, no model is needed", () => {
  assert.deepEqual(
    evidenceOnlyOutcomes([q("q1", ""), q("q2", "[illisible]", { legibility: "illisible" }), q("q3", "", { legibility: "absente" })])?.map((item) => item.outcome),
    ["no_answer", "illegible", "insufficient_evidence"],
  );
  assert.equal(evidenceOnlyOutcomes([q("q1", ""), q("q2", "x = 5")]), null);
});
