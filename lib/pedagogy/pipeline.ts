// Pure step of the pedagogical analysis pipeline, shared by the server action
// and the end-to-end tests: validated model errors + longitudinal history →
// the exact payload persisted by public.focus_persist_pedagogical_analysis.

import {
  confidenceForEvidence,
  type ValidatedErrorCandidate,
} from "@/lib/pedagogy/analysis";
import type { PedagogicalConfidence } from "@/lib/pedagogy/types";

export interface PriorErrorObservation {
  nodeId: string;
  assessmentId: string;
  verifiedByTeacher: boolean;
}

export interface PersistedErrorPayload {
  questionId: string;
  responseId: string;
  nodeId: string;
  errorType: ValidatedErrorCandidate["errorType"];
  evidenceExcerpt: string;
  explanation: string;
  confidence: PedagogicalConfidence;
}

export interface PersistedRecommendationPayload {
  nodeId: string;
  difficulty: string;
  evidence: Array<{ questionId: string; excerpt: string }>;
  confidence: PedagogicalConfidence;
  explanation: string;
  recommendedAction: string;
}

export function buildAnalysisPersistence(params: {
  validated: ValidatedErrorCandidate[];
  responseIdByQuestion: Map<string, string>;
  priorErrors: PriorErrorObservation[];
}): {
  errors: PersistedErrorPayload[];
  recommendations: PersistedRecommendationPayload[];
  confidenceByNode: Map<string, PedagogicalConfidence>;
} {
  const { validated, responseIdByQuestion, priorErrors } = params;
  const nodeIds = [...new Set(validated.map((error) => error.nodeId))];

  const occurrencesByNode = new Map<string, number>();
  for (const error of validated)
    occurrencesByNode.set(error.nodeId, (occurrencesByNode.get(error.nodeId) ?? 0) + 1);

  const confidenceByNode = new Map<string, PedagogicalConfidence>();
  for (const nodeId of nodeIds) {
    const priors = priorErrors.filter((row) => row.nodeId === nodeId);
    confidenceByNode.set(
      nodeId,
      confidenceForEvidence({
        currentOccurrences: occurrencesByNode.get(nodeId) ?? 0,
        priorAssessmentCount: new Set(priors.map((row) => row.assessmentId)).size,
        teacherVerifiedBefore: priors.some((row) => row.verifiedByTeacher),
      }),
    );
  }

  const errors = validated.map((error) => {
    const responseId = responseIdByQuestion.get(error.questionId);
    if (!responseId) throw new Error("Validated error has no persisted student response.");
    return {
      questionId: error.questionId,
      responseId,
      nodeId: error.nodeId,
      errorType: error.errorType,
      evidenceExcerpt: error.evidenceExcerpt,
      explanation: error.explanation,
      confidence: confidenceByNode.get(error.nodeId) ?? "limitee",
    };
  });

  const grouped = new Map<string, ValidatedErrorCandidate[]>();
  for (const error of validated) {
    const list = grouped.get(error.nodeId) ?? [];
    list.push(error);
    grouped.set(error.nodeId, list);
  }
  const recommendations = [...grouped.entries()].map(([nodeId, nodeErrors]) => ({
    nodeId,
    difficulty: nodeErrors[0].difficulty,
    evidence: nodeErrors.map((error) => ({
      questionId: error.questionId,
      excerpt: error.evidenceExcerpt,
    })),
    confidence: confidenceByNode.get(nodeId) ?? "limitee",
    explanation: nodeErrors[0].explanation,
    recommendedAction: nodeErrors[0].recommendedAction,
  }));

  return { errors, recommendations, confidenceByNode };
}
