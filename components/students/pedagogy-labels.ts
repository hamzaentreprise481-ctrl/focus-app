import type { ModelAnalysisStatus, PedagogicalConfidence, RecommendationStatus } from "@/lib/pedagogy/types";

export const ANALYSIS_STATUS_LABEL: Record<ModelAnalysisStatus, string> = {
  errors_found: "erreur(s) observée(s)",
  no_error_observed: "aucune erreur observée",
  insufficient_evidence: "preuves insuffisantes",
};

/** Confidence depends on the evidence history, never on the model alone. */
export const CONFIDENCE_LABEL: Record<PedagogicalConfidence, string> = {
  limitee: "Confiance limitée · une seule observation",
  moderee: "Confiance modérée · observation répétée",
  forte: "Confiance forte · répétée et déjà confirmée par vous",
};

export const RECOMMENDATION_STATUS_LABEL: Record<RecommendationStatus, string> = {
  pending: "Hypothèse IA à examiner",
  validated: "Observation confirmée par vous",
  dismissed: "Écartée par vous",
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
