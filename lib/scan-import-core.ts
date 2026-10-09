export const SCAN_BUCKET = "focus-scan-imports";
export const MAX_SCAN_BYTES = 50_000_000;
/** Photos of copies (one file per page); PDF stacks keep their own limit. */
export const MAX_SCAN_IMAGES = 12;
export const MAX_SCAN_IMAGE_BYTES = 15_000_000;
export const SCAN_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type ScanQuestion = {
  id: string;
  position: number;
  prompt: string;
  maxPoints: number | null;
  /** The teacher's correction: never sent to the transcription model, only
   * used to detect a transcription that "corrected" the student. */
  correctionText?: string;
};

export type ScanRosterStudent = { id: string; name: string };

/** What the transcription model says it saw for one question. */
export type TranscriptionStatus = "ecrite" | "partielle" | "illisible" | "vide" | "absente";

/**
 * Legibility of a stored answer, computed by FOCUS from the model's status
 * AND the markers in the text (never from a confidence number):
 * - lisible: everything written was read;
 * - partielle: contains [illisible] or an uncertain reading [?…];
 * - illisible: nothing reliable could be read;
 * - vide: nothing written for this question;
 * - absente: the question's area is not on the image (cut or missing page).
 */
export type ResponseLegibility = "lisible" | "partielle" | "illisible" | "vide" | "absente";

export const LEGIBILITY_LABEL: Record<ResponseLegibility, string> = {
  lisible: "Lisible",
  partielle: "Partiellement lisible",
  illisible: "Illisible",
  vide: "Pas de réponse",
  absente: "Absente de l’image",
};

export type ScanResponseCandidate = {
  questionId: string;
  responseText: string;
  awardedPoints: string;
  teacherAnnotation: string;
  /** Legibility computed by FOCUS (see ResponseLegibility). */
  legibility: ResponseLegibility;
  /** Struck-through text the model could read: shown to the teacher, never analysed. */
  crossedOut: string;
};

export type PageQuality = "bonne" | "degradee" | "inutilisable";
export type PageIssue = "floue" | "sombre" | "faible_contraste" | "coupee" | "reflet" | "pas_une_copie";

export type ScanPageReport = {
  page: number;
  /** Clockwise rotation, in degrees, needed to read the page upright. */
  orientation: 0 | 90 | 180 | 270;
  quality: PageQuality;
  issues: PageIssue[];
};

export type ScanCopyCandidate = {
  studentId: string | null;
  studentNameRead: string;
  identificationConfidence: number;
  groupingConfidence: number;
  startPage: number;
  endPage: number;
  score: number | null;
  scoreConfidence: number;
  responses: ScanResponseCandidate[];
  warnings: string[];
};

export type ScanExtraction = {
  pageCount: number;
  copies: ScanCopyCandidate[];
  unassignedPages: number[];
  warnings: string[];
  pages: ScanPageReport[];
  model: string;
  attempts: number;
};

export type ScanReviewCopy = ScanCopyCandidate & {
  autoImportReason: string;
};

const CONFIDENCE = {
  identification: 0.96,
  grouping: 0.96,
  score: 0.95,
};

// ---------------------------------------------------------------------------
// Transcription markers
// ---------------------------------------------------------------------------

/** The only marker FOCUS accepts for an unreadable passage. */
export const ILLEGIBLE_MARKER = "[illisible]";
const ILLEGIBLE_RE = /\[\s*illisible\s*\]/gi;
/** An uncertain reading: the model's best guess, e.g. [?7] or [?x²]. */
const UNCERTAIN_RE = /\[\?[^[\]]{0,40}\]/g;

/** Character ranges [start, end) of every marker in a transcription. */
export function markerRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const re of [ILLEGIBLE_RE, UNCERTAIN_RE]) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges.sort((a, b) => a[0] - b[0]);
}

/** Normalises the illegible marker's spelling so that every check sees one form. */
export function normalizeMarkers(text: string) {
  return text.replace(ILLEGIBLE_RE, ILLEGIBLE_MARKER);
}

/** Text that remains once every marker and separator is removed. */
function readableContent(text: string) {
  return text.replace(ILLEGIBLE_RE, "").replace(UNCERTAIN_RE, "").replace(/[\s;:.,=…-]/g, "");
}

export function legibilityOf(status: TranscriptionStatus | string, text: string): ResponseLegibility {
  const trimmed = text.trim();
  if (status === "absente" && !trimmed) return "absente";
  if (!trimmed) return status === "illisible" ? "illisible" : "vide";
  if (status === "illisible" || readableContent(trimmed).length === 0) return "illisible";
  if (status === "partielle" || status === "absente" || markerRanges(trimmed).length) return "partielle";
  return "lisible";
}

/**
 * Legibility once the TEACHER has checked a transcription (scan review or
 * evidence editor): the text they confirm is authoritative, so only the
 * markers they left in it count.
 */
export function teacherCheckedLegibility(previous: ResponseLegibility, text: string): ResponseLegibility {
  if (!text.trim()) return previous === "absente" || previous === "illisible" ? previous : "vide";
  return legibilityOf("ecrite", text);
}

/**
 * True when the excerpt occurs in the answer at least once without touching
 * an [illisible] or uncertain [?…] passage: evidence must rest only on what
 * was read with certainty.
 */
export function excerptIsReliable(excerpt: string, text: string) {
  if (!excerpt || markerRanges(excerpt).length) return false;
  const ranges = markerRanges(text);
  for (let from = text.indexOf(excerpt); from >= 0; from = text.indexOf(excerpt, from + 1)) {
    const to = from + excerpt.length;
    if (!ranges.some(([start, end]) => start < to && end > from)) return true;
  }
  return false;
}

/** Same normalisation as lib/pedagogy/analysis.ts normalizeMathText. */
function comparable(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[×·]/g, "*")
    .replace(/[−–]/g, "-")
    .replace(/\s+/g, "")
    .replace(/[.;]+$/, "");
}

/**
 * A transcription equal to the correction on a question the teacher did not
 * give full marks to is suspicious: the reader may have "corrected" the
 * student. It is never auto-imported.
 */
export function transcriptionLooksCorrected(response: ScanResponseCandidate, question: ScanQuestion) {
  if (!question.correctionText || !response.responseText.trim()) return false;
  const points = Number(response.awardedPoints.trim().replace(",", "."));
  const graded = response.awardedPoints.trim() !== "" && Number.isFinite(points);
  if (!graded || question.maxPoints === null || points >= question.maxPoints) return false;
  return comparable(response.responseText) === comparable(question.correctionText);
}

// ---------------------------------------------------------------------------
// Auto-import gate
// ---------------------------------------------------------------------------

export function scanCopyIssue(
  copy: ScanCopyCandidate,
  rosterIds: Set<string>,
  questions: ScanQuestion[],
  pages: ScanPageReport[] = [],
): string | null {
  if (!Number.isInteger(copy.startPage) || !Number.isInteger(copy.endPage) || copy.startPage < 1 || copy.endPage < copy.startPage)
    return "Séparation des pages à confirmer.";
  if (!copy.studentId || !rosterIds.has(copy.studentId))
    return "Élève non identifié avec certitude.";
  if (copy.identificationConfidence < CONFIDENCE.identification)
    return "Nom de l’élève à confirmer.";
  if (copy.groupingConfidence < CONFIDENCE.grouping)
    return "Séparation des pages à confirmer.";
  const copyPages = pages.filter((page) => page.page >= copy.startPage && page.page <= copy.endPage);
  if (copyPages.some((page) => page.quality !== "bonne" || page.issues.length))
    return "Qualité de l’image insuffisante (photo floue, sombre, coupée ou avec reflet) : transcription à vérifier.";
  if (copy.score === null) return "Note non détectée : à confirmer.";
  if (copy.score < 0 || copy.score > 20 || copy.scoreConfidence < CONFIDENCE.score)
    return "Note à confirmer.";
  if (copy.warnings.length) return copy.warnings[0];

  const validQuestions = new Map(questions.map((question) => [question.id, question]));
  if (copy.responses.length !== questions.length)
    return "Toutes les questions n’ont pas été reconnues.";
  const seen = new Set<string>();
  for (const response of copy.responses) {
    const question = validQuestions.get(response.questionId);
    if (!question || seen.has(response.questionId))
      return "Correspondance des questions à confirmer.";
    seen.add(response.questionId);
    if (response.legibility === "partielle" || response.legibility === "illisible")
      return "Écriture manuscrite à vérifier : passages illisibles ou incertains.";
    if (response.legibility === "absente")
      return "Une partie de la copie n’apparaît pas sur l’image : à vérifier.";
    if (transcriptionLooksCorrected(response, question))
      return "Transcription identique au corrigé alors que la question n’a pas tous les points : à vérifier.";
    const raw = response.awardedPoints.trim().replace(",", ".");
    if (raw) {
      const points = Number(raw);
      if (!Number.isFinite(points) || points < 0 || (question.maxPoints !== null && points > question.maxPoints))
        return "Points attribués à confirmer.";
    }
  }
  if (seen.size !== questions.length)
    return "Toutes les questions n’ont pas été reconnues.";
  return null;
}

export function normalizedResponses(copy: ScanCopyCandidate, questions: ScanQuestion[]): ScanResponseCandidate[] {
  const byQuestion = new Map(copy.responses.map((response) => [response.questionId, response]));
  return questions.map((question) => {
    const response = byQuestion.get(question.id);
    const responseText = normalizeMarkers((response?.responseText ?? "").trim());
    return {
      questionId: question.id,
      responseText,
      awardedPoints: (response?.awardedPoints ?? "").trim().replace(",", "."),
      teacherAnnotation: (response?.teacherAnnotation ?? "").trim(),
      // A question the reader did not return at all was not seen on the image.
      legibility: response?.legibility ?? "absente",
      crossedOut: (response?.crossedOut ?? "").trim(),
    };
  });
}
