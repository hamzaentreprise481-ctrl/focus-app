export type PedagogicalConfidence = "limitee" | "moderee" | "forte";

export interface CurriculumNodeSummary {
  id: string;
  code: string;
  nodeType: "domain" | "notion" | "competency" | "prerequisite";
  title: string;
  description: string | null;
  sourceLocator: string;
  sourceUrl: string;
  prerequisites: string[];
  competencies: string[];
}

export interface PedagogicalRecommendationView {
  id: string;
  assessmentId: string;
  assessmentTitle: string;
  curriculumNodeCode: string;
  curriculumNodeTitle: string;
  difficulty: string;
  evidence: Array<{
    questionId: string;
    questionLabel: string;
    excerpt: string;
  }>;
  confidence: PedagogicalConfidence;
  explanation: string;
  recommendedAction: string;
  sourceLocator: string;
  sourceUrl: string;
  prerequisites: string[];
  competencies: string[];
  teacherValidated: boolean;
  createdAt: string;
}

export interface PedagogicalSnapshot {
  recommendations: PedagogicalRecommendationView[];
  documentedAssessmentCount: number;
  analyzableAssessmentCount: number;
  latestAnalyzableAssessmentTitle: string | null;
  latestAnalysisStatus: ModelAnalysisStatus | null;
  latestAnalysisReason: string | null;
  latestAnalysisAt: string | null;
  aiConfigured: boolean;
}

export interface EvidenceQuestionDraft {
  id: string;
  position: number;
  prompt: string;
  correctionText: string;
  rubricText: string;
  maxPoints: string;
  responseText: string;
  awardedPoints: string;
  teacherAnnotation: string;
}

export interface AssessmentEvidenceDraft {
  assessmentId: string;
  studentId: string;
  contextText: string;
  instructionsText: string;
  questions: EvidenceQuestionDraft[];
}

export interface ModelErrorCandidate {
  assessmentId: string;
  questionId: string;
  nodeCode: string;
  errorType:
    | "concept"
    | "calcul"
    | "raisonnement"
    | "representation"
    | "communication"
    | "methode"
    | "prerequis";
  difficulty: string;
  evidenceExcerpt: string;
  explanation: string;
  recommendedAction: string;
}

export type ModelAnalysisStatus =
  | "errors_found"
  | "no_error_observed"
  | "insufficient_evidence";

export interface ModelPedagogicalAnalysis {
  status: ModelAnalysisStatus;
  insufficientReason: string;
  errors: ModelErrorCandidate[];
}
