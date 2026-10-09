import type {
  ModelAnalysisStatus,
  ModelErrorCandidate,
  PedagogicalConfidence,
  QuestionOutcome,
  ResponseLegibility,
} from "@/lib/pedagogy/types";
import { excerptIsReliable } from "@/lib/scan-import-core";

export interface QuestionEvidenceForValidation {
  assessmentId: string;
  questionId: string;
  responseText: string;
  correctionText?: string;
  maxPoints?: number | null;
  awardedPoints?: number | null;
  /** Notion codes the teacher tagged as assessed by this question. */
  assessedCodes?: string[];
  /** How reliably the stored answer was read (scans); null/undefined for a typed answer. */
  legibility?: ResponseLegibility | null;
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
  | "duplicate"
  | "uncertain_transcription"
  | "illegible_answer"
  | "contradicts_outcome";

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
  /\b(ne (ma[iî]trise|sait|comprend)\s+(?:[a-zà-ÿ’']+\s+){0,2}?(pas|rien|aucun\w*)|nul(le)? en|incapable|toujours|jamais|syst[ée]matiquement|aucune (notion|connaissance|compr[ée]hension|base)|lacunes? (graves?|profondes?|importantes?|majeures?)|tr[èe]s (grande|grosse)s? difficult[ée]s?|niveau tr[èe]s faible)\b/i;
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
    // Never a finding on what the reader could not decipher: an answer read
    // as illegible, or an excerpt that only exists inside/through an
    // [illisible] or uncertain [?…] passage of the transcription.
    if (question.legibility === "illisible") {
      reject("illegible_answer");
      continue;
    }
    if (!excerptIsReliable(evidenceExcerpt, question.responseText)) {
      reject("uncertain_transcription");
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


export interface ValidatedQuestionOutcome {
  questionId: string;
  outcome: QuestionOutcome;
  /** Literal excerpt of the answer, read with certainty, or "". */
  excerpt: string;
  note: string;
}

export interface ValidatedModelAnalysis {
  status: ModelAnalysisStatus;
  insufficientReason: string;
  errors: ValidatedErrorCandidate[];
  /** Candidates the FOCUS checks refused, for the audit trail. */
  rejected: RejectedCandidate[];
  /** Exactly one per question, in the questions' order. */
  questionOutcomes: ValidatedQuestionOutcome[];
}

const OUTCOMES = new Set<QuestionOutcome>(["error", "no_error_observed", "incomplete", "no_answer", "illegible", "insufficient_evidence"]);

/**
 * What the evidence alone decides, whatever the model says: nothing written,
 * a zone missing from the image, or an answer read as illegible.
 */
function evidenceOutcome(question: QuestionEvidenceForValidation): ValidatedQuestionOutcome | null {
  const base = { questionId: question.questionId, excerpt: "" };
  if (question.legibility === "absente")
    return { ...base, outcome: "insufficient_evidence", note: "La zone de cette question n’apparaît pas sur l’image transmise." };
  if (question.legibility === "illisible")
    return { ...base, outcome: "illegible", note: "Passage manuscrit insuffisamment lisible pour conclure." };
  if (!question.responseText.trim()) return { ...base, outcome: "no_answer", note: "Aucune réponse écrite." };
  return null;
}

/**
 * When the evidence alone decides every question (nothing written, illegible
 * or absent from the image), no model is called: these are the outcomes.
 */
export function evidenceOnlyOutcomes(questions: QuestionEvidenceForValidation[]): ValidatedQuestionOutcome[] | null {
  const decided = questions.map(evidenceOutcome);
  return decided.every((item) => item !== null) ? (decided as ValidatedQuestionOutcome[]) : null;
}

function cleanNote(value: unknown) {
  const note = clean(value, 300);
  return OVERSTATED.test(note) || NON_PEDAGOGICAL.test(note) ? "" : note;
}

const OUTCOME_SUMMARY: Partial<Record<QuestionOutcome, string>> = {
  incomplete: "réponse incomplète",
  no_answer: "sans réponse",
  illegible: "passage illisible",
  insufficient_evidence: "preuves insuffisantes",
};

export function validateModelAnalysis(
  raw: unknown,
  questions: QuestionEvidenceForValidation[],
  nodesByCode: Map<string, string>,
  options: ValidationOptions = {},
): ValidatedModelAnalysis {
  const labelOf = new Map(questions.map((question, index) => [question.questionId, `Q${index + 1}`]));
  const fallbackOutcomes = (note: string) =>
    questions.map((question) => evidenceOutcome(question) ?? { questionId: question.questionId, outcome: "insufficient_evidence" as const, excerpt: "", note });
  const insufficient = (insufficientReason: string, rejected: RejectedCandidate[] = [], questionOutcomes = fallbackOutcomes(insufficientReason)) => ({
    status: "insufficient_evidence" as const,
    insufficientReason,
    errors: [],
    rejected,
    questionOutcomes,
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
  // The reason is model text shown to the teacher: same wording rules as a
  // finding (an answer may try to make the model judge the student here).
  const rawReason = clean(value.insufficientReason, 500);
  const reason = OVERSTATED.test(rawReason) || NON_PEDAGOGICAL.test(rawReason) ? "" : rawReason;
  const reviewed = reviewModelErrors(raw, questions, nodesByCode, options);
  const rejected = [...reviewed.rejected];

  // A "no error" verdict that still lists errors contradicts itself: neither
  // a clean bill nor a diagnosis can be drawn from it.
  if (status === "no_error_observed" && (value.errors as unknown[]).length)
    return insufficient("La sortie du moteur est incohérente (aucune erreur annoncée, mais des erreurs listées).", rejected);

  // The model's outcome per question (one per known question, first wins).
  const modelOutcomes = new Map<string, { outcome: QuestionOutcome; excerpt: string; note: string }>();
  if (Array.isArray(value.questionOutcomes))
    for (const item of value.questionOutcomes as unknown[]) {
      if (!item || typeof item !== "object") continue;
      const entry = item as Record<string, unknown>;
      const questionId = clean(entry.questionId, 80);
      const outcome = clean(entry.outcome, 40) as QuestionOutcome;
      if (!labelOf.has(questionId) || !OUTCOMES.has(outcome) || modelOutcomes.has(questionId)) continue;
      modelOutcomes.set(questionId, {
        outcome,
        excerpt: typeof entry.observedExcerpt === "string" ? entry.observedExcerpt.slice(0, 300) : "",
        note: cleanNote(entry.note),
      });
    }
  const legacy = !Array.isArray(value.questionOutcomes);

  let errors = reviewed.validated;
  if (status === "insufficient_evidence") {
    // The model declared it could not conclude: no finding is kept.
    for (const error of errors) rejected.push({ questionId: error.questionId, nodeCode: error.nodeCode, reason: "contradicts_outcome" });
    errors = [];
  }

  const questionOutcomes: ValidatedQuestionOutcome[] = questions.map((question) => {
    const decided = evidenceOutcome(question);
    const questionErrors = errors.filter((error) => error.questionId === question.questionId);
    if (decided) {
      for (const error of questionErrors) rejected.push({ questionId: error.questionId, nodeCode: error.nodeCode, reason: "contradicts_outcome" });
      errors = errors.filter((error) => error.questionId !== question.questionId);
      return decided;
    }
    const model = modelOutcomes.get(question.questionId);
    const excerpt =
      model?.excerpt && meaningfulExcerpt(model.excerpt, question.responseText) && excerptIsReliable(model.excerpt, question.responseText)
        ? model.excerpt
        : "";
    if (questionErrors.length) {
      // A finding needs the model's own outcome for the question to agree:
      // "no error", "no answer" or "illegible" next to an error is a contradiction.
      if (!legacy && model && ["no_error_observed", "no_answer", "illegible"].includes(model.outcome)) {
        for (const error of questionErrors) rejected.push({ questionId: error.questionId, nodeCode: error.nodeCode, reason: "contradicts_outcome" });
        errors = errors.filter((error) => error.questionId !== question.questionId);
        return {
          questionId: question.questionId,
          outcome: model.outcome === "illegible" ? "illegible" : "insufficient_evidence",
          excerpt: "",
          note: "Sortie du moteur contradictoire pour cette question : aucune conclusion retenue.",
        };
      }
      return { questionId: question.questionId, outcome: "error", excerpt: questionErrors[0].evidenceExcerpt, note: model?.note ?? "" };
    }
    if (legacy)
      return status === "no_error_observed"
        ? { questionId: question.questionId, outcome: "no_error_observed", excerpt: "", note: "" }
        : { questionId: question.questionId, outcome: "insufficient_evidence", excerpt: "", note: "" };
    if (!model)
      return { questionId: question.questionId, outcome: "insufficient_evidence", excerpt: "", note: "Le moteur n’a pas statué sur cette question." };
    if (model.outcome === "error")
      return {
        questionId: question.questionId,
        outcome: "insufficient_evidence",
        excerpt: "",
        note: "Une erreur a été proposée mais sa preuve n’a pas passé les contrôles FOCUS.",
      };
    // An outcome that needs a text it does not have stays insufficient.
    if (model.outcome === "no_answer")
      return { questionId: question.questionId, outcome: "insufficient_evidence", excerpt, note: "Une réponse est écrite alors que le moteur n’en a pas vu." };
    return { questionId: question.questionId, outcome: model.outcome, excerpt, note: model.note };
  });

  if (errors.length) return { status: "errors_found", insufficientReason: "", errors, rejected, questionOutcomes };
  // No error: a clean bill only if every written answer was read and judged
  // without error; unanswered questions are reported, they do not block it.
  const blocking = questionOutcomes.filter((item) => item.outcome !== "no_error_observed" && item.outcome !== "no_answer");
  if (!blocking.length && status !== "insufficient_evidence" && questionOutcomes.some((item) => item.outcome === "no_error_observed"))
    return { status: "no_error_observed", insufficientReason: "", errors: [], rejected, questionOutcomes };
  const summary = blocking
    .map((item) => `${labelOf.get(item.questionId)} : ${OUTCOME_SUMMARY[item.outcome] ?? "à confirmer"}`)
    .join(" ; ");
  const reasonText =
    status === "errors_found"
      ? `Le moteur a signalé une erreur, mais aucune preuve vérifiable n’a passé les contrôles FOCUS.${summary ? ` (${summary}).` : ""}`
      : status === "insufficient_evidence"
        ? reason || "Les éléments fournis ne permettent pas d’établir une erreur précise."
        : summary
          ? `Aucune erreur démontrée — ${summary}.`
          : "Les éléments fournis ne permettent pas d’établir une erreur précise.";
  return insufficient(reasonText, rejected, questionOutcomes);
}
