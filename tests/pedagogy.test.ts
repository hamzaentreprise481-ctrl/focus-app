import { test } from "node:test";
import assert from "node:assert/strict";
import {
  confidenceForEvidence,
  validateModelErrors,
} from "../lib/pedagogy/analysis";

const questions = [
  {
    assessmentId: "assessment-1",
    questionId: "question-1",
    responseText: "3(x+2)=3x+2 donc x=1",
  },
];

const nodes = new Map([
  ["MATH.ALG.EXPRESSIONS", "node-expressions"],
  ["MATH.ALG.EQUATIONS", "node-equations"],
]);

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    assessmentId: "assessment-1",
    questionId: "question-1",
    nodeCode: "MATH.ALG.EXPRESSIONS",
    errorType: "calcul",
    difficulty: "La distributivité est appliquée partiellement.",
    evidenceExcerpt: "3(x+2)=3x+2",
    explanation:
      "Le facteur 3 a été appliqué à x mais pas au terme constant.",
    recommendedAction:
      "Faire expliciter la distributivité sur deux exemples avant de reprendre l’équation.",
    ...overrides,
  };
}

test("accepts only an error grounded in a literal student response and known curriculum node", () => {
  const result = validateModelErrors(
    { errors: [candidate()] },
    questions,
    nodes,
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].nodeId, "node-expressions");
  assert.equal(result[0].evidenceExcerpt, "3(x+2)=3x+2");
});

test("rejects invented evidence even when the diagnosis sounds plausible", () => {
  const result = validateModelErrors(
    {
      errors: [
        candidate({
          evidenceExcerpt: "3(x+2)=3x+6",
          difficulty: "Erreur de distributivité",
        }),
      ],
    },
    questions,
    nodes,
  );
  assert.deepEqual(result, []);
});

test("rejects a curriculum node that is not in the official graph supplied by FOCUS", () => {
  const result = validateModelErrors(
    {
      errors: [
        candidate({
          nodeCode: "MATH.INVENTED.TOPIC",
        }),
      ],
    },
    questions,
    nodes,
  );
  assert.deepEqual(result, []);
});

test("rejects errors attached to another assessment or question", () => {
  assert.deepEqual(
    validateModelErrors(
      { errors: [candidate({ assessmentId: "assessment-2" })] },
      questions,
      nodes,
    ),
    [],
  );
  assert.deepEqual(
    validateModelErrors(
      { errors: [candidate({ questionId: "question-404" })] },
      questions,
      nodes,
    ),
    [],
  );
});

test("ignores unrelated score or average fields: evidence is the validation gate", () => {
  const result = validateModelErrors(
    {
      average: 4.2,
      globalScore: 3,
      errors: [
        candidate({
          evidenceExcerpt: "not in the response",
          average: 2,
          score: 0,
        }),
      ],
    },
    questions,
    nodes,
  );
  assert.deepEqual(result, []);
});

test("confidence grows only with repeated or teacher-verified evidence", () => {
  assert.equal(
    confidenceForEvidence({
      currentOccurrences: 1,
      priorAssessmentCount: 0,
      teacherVerifiedBefore: false,
    }),
    "limitee",
  );
  assert.equal(
    confidenceForEvidence({
      currentOccurrences: 2,
      priorAssessmentCount: 0,
      teacherVerifiedBefore: false,
    }),
    "moderee",
  );
  assert.equal(
    confidenceForEvidence({
      currentOccurrences: 1,
      priorAssessmentCount: 1,
      teacherVerifiedBefore: false,
    }),
    "moderee",
  );
  assert.equal(
    confidenceForEvidence({
      currentOccurrences: 1,
      priorAssessmentCount: 1,
      teacherVerifiedBefore: true,
    }),
    "forte",
  );
});
