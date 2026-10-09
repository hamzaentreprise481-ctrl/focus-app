import type { ModelAnalysisStatus, PedagogicalConfidence, QuestionOutcome, RecommendationStatus } from "@/lib/pedagogy/types";

export const ANALYSIS_STATUS_LABEL: Record<ModelAnalysisStatus, string> = {
  errors_found: "erreur(s) observée(s)",
  no_error_observed: "aucune erreur observée",
  insufficient_evidence: "preuves insuffisantes",
};

/**
 * Confidence depends on the evidence history and on how reliably the copy
 * was read, never on the model alone.
 */
export const CONFIDENCE_LABEL: Record<PedagogicalConfidence, string> = {
  limitee: "Confiance limitée · une seule observation, ou copie lue partiellement",
  moderee: "Confiance modérée · observation répétée, ou copie lue automatiquement et non vérifiée",
  forte: "Confiance forte · répétée et déjà confirmée par un professeur",
};

/** What FOCUS concluded about one question: an observation, never a judgement of the student. */
export const QUESTION_OUTCOME_LABEL: Record<QuestionOutcome, string> = {
  error: "Erreur observée (hypothèse à examiner)",
  no_error_observed: "Aucune erreur observée",
  incomplete: "Réponse incomplète",
  no_answer: "Pas de réponse",
  illegible: "Passage manuscrit insuffisamment lisible pour conclure",
  insufficient_evidence: "Preuves insuffisantes",
};

export const RECOMMENDATION_STATUS_LABEL: Record<RecommendationStatus, string> = {
  pending: "Hypothèse IA à examiner",
  validated: "Observation confirmée par le professeur",
  dismissed: "Écartée par le professeur",
  superseded: "Remplacée (les preuves ont changé)",
};

export function analysisOutcomeMessage(result: {
  assessmentTitle: string;
  analysisStatus: ModelAnalysisStatus;
  insufficientReason: string;
  recommendationCount: number;
  reused: boolean;
  rejectedCandidates: number;
}) {
  const where = `« ${result.assessmentTitle} »`;
  if (result.reused)
    return `${where} : ces preuves ont déjà été analysées ; le résultat actuel et vos décisions sont conservés.`;
  const rejected = result.rejectedCandidates
    ? ` ${result.rejectedCandidates} proposition(s) du moteur ont été refusées par les contrôles FOCUS (preuve non littérale, notion hors sujet ou affirmation non fondée).`
    : "";
  if (result.analysisStatus === "insufficient_evidence")
    return `${where} : preuves insuffisantes. ${result.insufficientReason}${rejected}`;
  if (result.analysisStatus === "no_error_observed")
    return `${where} : aucune erreur observée dans les réponses fournies. Ce n’est pas une preuve de maîtrise.${rejected}`;
  return `${where} : ${result.recommendationCount} hypothèse(s) fondée(s) sur des extraits de la copie, à examiner.${rejected}`;
}
