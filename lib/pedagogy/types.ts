export type PedagogicalConfidence = "limitee" | "moderee" | "forte";

export interface CurriculumNodeSummary {
  id: string;
  code: string;
  nodeType: "domain" | "notion" | "competency" | "prerequisite";
  title: string;
  description: string | null;
  sourceLocator: string;
  sourceUrl: string;
  /** false for prior-level prerequisites supplied only as context. */
  inScope: boolean;
  /** part_of targets (broader notions or domains). */
  parents: string[];
  /** Nodes that are prerequisite_of this node. */
  prerequisites: string[];
  /** Competency nodes this node supports. */
  competencies: string[];
  /** Notion nodes this node supports (weaker than a prerequisite). */
  supports: string[];
}

export type RecommendationStatus = "pending" | "validated" | "dismissed" | "superseded";

export interface PedagogicalRecommendationView {
  id: string;
  assessmentId: string;
  assessmentTitle: string;
  assessmentDate: string;
  curriculumNodeCode: string;
  curriculumNodeTitle: string;
  difficulty: string;
  evidence: Array<{
    questionId: string;
    questionLabel: string;
    excerpt: string;
  }>;
  /** Computed by the database from the evidence history. */
  confidence: PedagogicalConfidence;
  explanation: string;
  recommendedAction: string;
  sourceLocator: string;
  sourceUrl: string;
  prerequisites: string[];
  competencies: string[];
  status: RecommendationStatus;
  decidedAt: string | null;
  teacherNote: string | null;
  createdAt: string;
  /** Curated catalogue entries (typical error, remediation) for the notion. */
  catalogue: CatalogueSuggestion[];
}

export interface CatalogueSuggestion {
  kind: "typical_error" | "remediation";
  code: string;
  title: string;
  text: string;
  /** True when the analysis matched this typical error (or its remediation). */
  matched: boolean;
  /** Remediation check exercise, when the catalogue provides one. */
  check?: { prompt: string; expectedAnswer: string | null } | null;
}

/** One notion followed over time for one student. */
export interface NotionTimeline {
  code: string;
  title: string;
  observations: Array<{
    assessmentId: string;
    assessmentTitle: string;
    assessmentDate: string;
    /** error: an analysis kept an error on this notion; no_error: a question
     * assessing it was analysed without an observed error (not mastery). */
    kind: "error" | "no_error";
    teacherDecision: "validated" | "dismissed" | null;
  }>;
}

export interface AssessmentAnalysisState {
  assessmentId: string;
  title: string;
  date: string;
  questionCount: number;
  answeredCount: number;
  status: ModelAnalysisStatus | null;
  reason: string | null;
  analyzedAt: string | null;
  /** Evidence exists but no current analysis (never run, or superseded). */
  needsAnalysis: boolean;
}

export interface PedagogicalSnapshot {
  active: PedagogicalRecommendationView[];
  history: PedagogicalRecommendationView[];
  notions: NotionTimeline[];
  assessments: AssessmentAnalysisState[];
  aiConfigured: boolean;
}

export interface NotionOption {
  code: string;
  title: string;
  group: string;
}

export interface DefinitionQuestionDraft {
  id: string;
  prompt: string;
  correctionText: string;
  rubricText: string;
  maxPoints: string;
  nodeCodes: string[];
}

export interface AssessmentDefinitionDraft {
  assessmentId: string;
  contextText: string;
  instructionsText: string;
  questions: DefinitionQuestionDraft[];
}

export interface AssessmentDefinitionView extends AssessmentDefinitionDraft {
  editable: boolean;
  notions: NotionOption[];
  answersByQuestion: Record<string, number>;
}

export interface StudentResponseDraft {
  questionId: string;
  responseText: string;
  awardedPoints: string;
  teacherAnnotation: string;
}

export interface StudentEvidenceView {
  assessmentId: string;
  studentId: string;
  editable: boolean;
  questions: Array<{
    id: string;
    position: number;
    prompt: string;
    correctionText: string;
    maxPoints: number | null;
  }>;
  responses: StudentResponseDraft[];
  analysis: AssessmentAnalysisState | null;
}

export interface ResponseOverviewRow {
  studentId: string;
  answeredCount: number;
  analysisStatus: ModelAnalysisStatus | null;
  needsAnalysis: boolean;
  pendingRecommendations: number;
}

/** One mathematics assessment of the teacher, as the dashboard needs it. */
export interface WorkQueueAssessment {
  assessmentId: string;
  questionCount: number;
  /** Students with at least one non-empty answer. */
  answeredStudentIds: string[];
  /** Answered students without a current (non-superseded) analysis. */
  needsAnalysisStudentIds: string[];
  /** Current AI hypotheses the teacher has not decided on yet. */
  pendingReviews: Array<{ studentId: string; count: number }>;
}

export interface TeacherWorkQueue {
  assessments: WorkQueueAssessment[];
  aiConfigured: boolean;
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
  /** A typical error of the FOCUS catalogue for this notion, or "". */
  catalogueErrorCode?: string;
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
