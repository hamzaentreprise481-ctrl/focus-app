import type {
  ModelAnalysisStatus,
  ModelErrorCandidate,
  PedagogicalConfidence,
} from "@/lib/pedagogy/types";

export interface QuestionEvidenceForValidation {
  assessmentId: string;
  questionId: string;
  responseText: string;
  correctionText?: string;
  maxPoints?: number | null;
  awardedPoints?: number | null;
  /** Notion codes the teacher tagged as assessed by this question. */
  assessedCodes?: string[];
}

export interface ValidatedErrorCandidate extends ModelErrorCandidate {
  nodeId: string;
}

export type RejectionReason =
  | "malformed"
  | "unknown_question"
  | "not_a_class_notion"
  | "excerpt_not_in_answer"
  | "excerpt_too_short"
  | "unrelated_notion"
  | "teacher_full_marks"
  | "answer_matches_correction"
  | "overstated_or_non_pedagogical"
  | "duplicate";

export interface RejectedCandidate {
  questionId: string;
  nodeCode: string;
  reason: RejectionReason;
}

export interface ValidationOptions {
  /** Catalogue typical-error codes per notion code; unknown codes are dropped. */
  catalogueCodes?: Map<string, Set<string>>;
  /**
   * Notion codes compatible with a question's assessed notions (the notions
   * themselves, notions above/below them and their prerequisites). Only
   * consulted when the question has assessed notions.
   */
  relatedCodes?: (assessedCodes: string[]) => Set<string>;
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

// One answer never supports a claim about the student in general, and FOCUS
// never produces medical, psychological, behavioural or effort judgements.
const OVERSTATED =
  /\b(ne ma[iî]trise (pas|rien|aucun)|ne sait (pas|rien)|ne comprend (pas|rien)|incapable|toujours|jamais|syst[ée]matiquement|aucune (notion|connaissance|compr[ée]hension|base)|lacunes? (graves?|profondes?|importantes?|majeures?)|tr[èe]s (grande|grosse)s? difficult[ée]s?|niveau tr[èe]s faible)\b/i;
const NON_PEDAGOGICAL =
  /\b(dys(lexi|calculi|praxi|orthographi)\w*|tdah|hyperactiv\w*|trouble\w*|handicap\w*|paresse\w*|paresseu\w*|fain[ée]ant\w*|manque (de travail|d.effort|de s[ée]rieux)|d[ée]motiv\w*|comportement\w*|d[ée]crocheu\w*)\b/i;

function clean(value: unknown, max: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

/** Whitespace-, case- and spacing-insensitive form used to compare answers. */
export function normalizeMathText(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[×·]/g, "*")
    .replace(/[−–]/g, "-")
    .replace(/\s+/g, "")
    .replace(/[.;]+$/, "");
}

/** The excerpt says something: three characters or more, or the whole answer. */
export function meaningfulExcerpt(excerpt: string, responseText: string) {
  const trimmed = excerpt.trim();
  return trimmed.length >= 3 || (trimmed.length > 0 && trimmed === responseText.trim());
}

/**
 * Notions compatible with a question's assessed notions, walking at most
 * three steps through part_of (both directions) and prerequisite_of (towards
 * the prerequisites). Mirrors public.focus_notion_related_to_question.
 */
export function relatedNotionCodes(
  summaries: Array<{ code: string; parents: string[]; prerequisites: string[] }>,
  assessedCodes: string[],
) {
  const byCode = new Map(summaries.map((summary) => [summary.code, summary]));
  const children = new Map<string, string[]>();
  for (const summary of summaries)
    for (const parent of summary.parents)
      children.set(parent, [...(children.get(parent) ?? []), summary.code]);
  const related = new Set(assessedCodes);
  let frontier = [...assessedCodes];
  for (let depth = 0; depth < 3 && frontier.length; depth++) {
    const next: string[] = [];
    for (const code of frontier) {
      const summary = byCode.get(code);
      for (const neighbour of [
        ...(summary?.parents ?? []),
        ...(children.get(code) ?? []),
        ...(summary?.prerequisites ?? []),
      ])
        if (!related.has(neighbour)) {
          related.add(neighbour);
          next.push(neighbour);
        }
    }
    frontier = next;
  }
  return related;
}

export function reviewModelErrors(
  raw: unknown,
  questions: QuestionEvidenceForValidation[],
  nodesByCode: Map<string, string>,
  options: ValidationOptions = {},
): { validated: ValidatedErrorCandidate[]; rejected: RejectedCandidate[] } {
  const rejected: RejectedCandidate[] = [];
  if (!raw || typeof raw !== "object") return { validated: [], rejected };
  const errors = (raw as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return { validated: [], rejected };

  const questionsById = new Map(questions.map((q) => [q.questionId, q]));
  const seen = new Set<string>();
  const validated: ValidatedErrorCandidate[] = [];

  for (const item of errors) {
    if (!item || typeof item !== "object") {
      rejected.push({ questionId: "", nodeCode: "", reason: "malformed" });
      continue;
    }
    const value = item as Record<string, unknown>;
    const assessmentId = clean(value.assessmentId, 80);
    const questionId = clean(value.questionId, 80);
    const nodeCode = clean(value.nodeCode, 120);
    const errorType = clean(value.errorType, 40);
    const difficulty = clean(value.difficulty, 220);
    // The excerpt is compared as given (not trimmed): it must be literal.
    const evidenceExcerpt = typeof value.evidenceExcerpt === "string" ? value.evidenceExcerpt.slice(0, 500) : "";
    const explanation = clean(value.explanation, 900);
    const recommendedAction = clean(value.recommendedAction, 700);
    const catalogueCode = clean(value.catalogueErrorCode, 160);
    const question = questionsById.get(questionId);
    const nodeId = nodesByCode.get(nodeCode);
    const reject = (reason: RejectionReason) => rejected.push({ questionId, nodeCode, reason });

    if (
      !assessmentId ||
      !ERROR_TYPES.has(errorType) ||
      !difficulty ||
      !evidenceExcerpt.trim() ||
      !explanation ||
      !recommendedAction
    ) {
      reject("malformed");
      continue;
    }
    if (!question || question.assessmentId !== assessmentId) {
      reject("unknown_question");
      continue;
    }
    if (!nodeId) {
      reject("not_a_class_notion");
      continue;
    }
    // The model must quote evidence that is literally present in the student's
    // answer. This prevents invented "proofs" from becoming recommendations.
    if (!question.responseText.includes(evidenceExcerpt)) {
      reject("excerpt_not_in_answer");
      continue;
    }
    if (!meaningfulExcerpt(evidenceExcerpt, question.responseText)) {
      reject("excerpt_too_short");
      continue;
    }
    // The teacher's judgement is final: full marks, or an answer identical to
    // the correction, cannot carry an error.
    if (
      question.maxPoints !== undefined &&
      question.maxPoints !== null &&
      question.awardedPoints !== undefined &&
      question.awardedPoints !== null &&
      question.awardedPoints >= question.maxPoints
    ) {
      reject("teacher_full_marks");
      continue;
    }
    if (
      question.correctionText &&
      normalizeMathText(question.responseText) === normalizeMathText(question.correctionText)
    ) {
      reject("answer_matches_correction");
      continue;
    }
    if (
      question.assessedCodes?.length &&
      options.relatedCodes &&
      !options.relatedCodes(question.assessedCodes).has(nodeCode)
    ) {
      reject("unrelated_notion");
      continue;
    }
    // Claims about the student (difficulty, explanation) stay local to this
    // answer; no text may carry a non-pedagogical judgement.
    if (
      [difficulty, explanation].some((text) => OVERSTATED.test(text)) ||
      [difficulty, explanation, recommendedAction].some((text) => NON_PEDAGOGICAL.test(text))
    ) {
      reject("overstated_or_non_pedagogical");
      continue;
    }

    const key = `${questionId}:${nodeCode}:${evidenceExcerpt}`;
    if (seen.has(key)) {
      reject("duplicate");
      continue;
    }
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
      // A catalogue reference is kept only if it belongs to the diagnosed
      // notion; a wrong one is dropped, never forced onto another notion.
      catalogueErrorCode: catalogueCode && options.catalogueCodes?.get(nodeCode)?.has(catalogueCode) ? catalogueCode : "",
    });
  }

  return { validated: validated.slice(0, 12), rejected };
}

export function validateModelErrors(
  raw: unknown,
  questions: QuestionEvidenceForValidation[],
  nodesByCode: Map<string, string>,
  options: ValidationOptions = {},
): ValidatedErrorCandidate[] {
  return reviewModelErrors(raw, questions, nodesByCode, options).validated;
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


export interface ValidatedModelAnalysis {
  status: ModelAnalysisStatus;
  insufficientReason: string;
  errors: ValidatedErrorCandidate[];
  /** Candidates the FOCUS checks refused, for the audit trail. */
  rejected: RejectedCandidate[];
}

export function validateModelAnalysis(
  raw: unknown,
  questions: QuestionEvidenceForValidation[],
  nodesByCode: Map<string, string>,
  options: ValidationOptions = {},
): ValidatedModelAnalysis {
  const insufficient = (insufficientReason: string, rejected: RejectedCandidate[] = []) => ({
    status: "insufficient_evidence" as const,
    insufficientReason,
    errors: [],
    rejected,
  });
  if (!questions.some((question) => question.responseText.trim()))
    return insufficient("Aucune réponse exploitable n’est fournie.");

  if (!raw || typeof raw !== "object")
    return insufficient("Sortie d’analyse absente ou invalide.");

  const value = raw as Record<string, unknown>;
  const rawStatus = typeof value.status === "string" ? value.status : "";
  const validStatus =
    rawStatus === "errors_found" ||
    rawStatus === "no_error_observed" ||
    rawStatus === "insufficient_evidence";
  if (!validStatus || !Array.isArray(value.errors))
    return insufficient("Le moteur n’a pas fourni une sortie d’analyse valide.");

  const status = rawStatus as ModelAnalysisStatus;
  const reason = clean(value.insufficientReason, 500);
  const { validated, rejected } = reviewModelErrors(raw, questions, nodesByCode, options);

  if (status === "insufficient_evidence")
    return insufficient(
      reason || "Les éléments fournis ne permettent pas d’établir une erreur précise.",
      rejected,
    );

  // A "no error" verdict that still lists errors contradicts itself: neither
  // a clean bill nor a diagnosis can be drawn from it.
  if (status === "no_error_observed")
    return (value.errors as unknown[]).length
      ? insufficient("La sortie du moteur est incohérente (aucune erreur annoncée, mais des erreurs listées).", rejected)
      : { status, insufficientReason: "", errors: [], rejected };

  if (!validated.length)
    return insufficient(
      "Le moteur a signalé une erreur, mais aucune preuve vérifiable n’a passé les contrôles FOCUS.",
      rejected,
    );

  return { status, insufficientReason: "", errors: validated, rejected };
}
