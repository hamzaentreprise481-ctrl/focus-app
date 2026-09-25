import type {
  ModelErrorCandidate,
  PedagogicalConfidence,
} from "@/lib/pedagogy/types";

export interface QuestionEvidenceForValidation {
  assessmentId: string;
  questionId: string;
  responseText: string;
}

export interface ValidatedErrorCandidate extends ModelErrorCandidate {
  nodeId: string;
}

const ERROR_TYPES = new Set([
  "concept",
  "calcul",
  "raisonnement",
  "representation",
  "communication",
  "methode",
  "prerequis",
]);

function clean(value: unknown, max: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

export function validateModelErrors(
  raw: unknown,
  questions: QuestionEvidenceForValidation[],
  nodesByCode: Map<string, string>,
): ValidatedErrorCandidate[] {
  if (!raw || typeof raw !== "object") return [];
  const errors = (raw as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return [];

  const questionsById = new Map(questions.map((q) => [q.questionId, q]));
  const seen = new Set<string>();
  const validated: ValidatedErrorCandidate[] = [];

  for (const item of errors) {
    if (!item || typeof item !== "object") continue;
    const value = item as Record<string, unknown>;
    const assessmentId = clean(value.assessmentId, 80);
    const questionId = clean(value.questionId, 80);
    const nodeCode = clean(value.nodeCode, 120);
    const errorType = clean(value.errorType, 40);
    const difficulty = clean(value.difficulty, 220);
    const evidenceExcerpt = clean(value.evidenceExcerpt, 500);
    const explanation = clean(value.explanation, 900);
    const recommendedAction = clean(value.recommendedAction, 700);
    const question = questionsById.get(questionId);
    const nodeId = nodesByCode.get(nodeCode);

    if (
      !assessmentId ||
      !question ||
      question.assessmentId !== assessmentId ||
      !nodeId ||
      !ERROR_TYPES.has(errorType) ||
      !difficulty ||
      !evidenceExcerpt ||
      !explanation ||
      !recommendedAction
    )
      continue;

    // The model must quote evidence that is literally present in the student's
    // answer. This prevents invented "proofs" from becoming recommendations.
    if (!question.responseText.includes(evidenceExcerpt)) continue;

    const key = `${questionId}:${nodeCode}:${evidenceExcerpt}`;
    if (seen.has(key)) continue;
    seen.add(key);

    validated.push({
      assessmentId,
      questionId,
      nodeCode,
      nodeId,
      errorType: errorType as ValidatedErrorCandidate["errorType"],
      difficulty,
      evidenceExcerpt,
      explanation,
      recommendedAction,
    });
  }

  return validated.slice(0, 12);
}

export function confidenceForEvidence(params: {
  currentOccurrences: number;
  priorAssessmentCount: number;
  teacherVerifiedBefore: boolean;
}): PedagogicalConfidence {
  if (params.teacherVerifiedBefore && params.priorAssessmentCount >= 1)
    return "forte";
  if (params.currentOccurrences >= 2 || params.priorAssessmentCount >= 1)
    return "moderee";
  return "limitee";
}
