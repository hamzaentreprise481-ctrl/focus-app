export const SCAN_BUCKET = "focus-scan-imports";
export const MAX_SCAN_BYTES = 50 * 1024 * 1024;

export type ScanQuestion = {
  id: string;
  position: number;
  prompt: string;
  maxPoints: number | null;
};

export type ScanRosterStudent = { id: string; name: string };

export type ScanResponseCandidate = {
  questionId: string;
  responseText: string;
  awardedPoints: string;
  teacherAnnotation: string;
};

export type ScanCopyCandidate = {
  studentId: string | null;
  studentNameRead: string;
  identificationConfidence: number;
  groupingConfidence: number;
  transcriptionConfidence: number;
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
};

export type ScanReviewCopy = ScanCopyCandidate & {
  autoImportReason: string;
};

const CONFIDENCE = {
  identification: 0.96,
  grouping: 0.96,
  transcription: 0.88,
  score: 0.95,
};

export function scanCopyIssue(
  copy: ScanCopyCandidate,
  rosterIds: Set<string>,
  questions: ScanQuestion[],
): string | null {
  if (!copy.studentId || !rosterIds.has(copy.studentId))
    return "Élève non identifié avec certitude.";
  if (copy.identificationConfidence < CONFIDENCE.identification)
    return "Nom de l’élève à confirmer.";
  if (copy.groupingConfidence < CONFIDENCE.grouping)
    return "Séparation des pages à confirmer.";
  if (copy.transcriptionConfidence < CONFIDENCE.transcription)
    return "Écriture manuscrite à vérifier.";
  if (
    copy.score !== null &&
    (copy.score < 0 ||
      copy.score > 20 ||
      copy.scoreConfidence < CONFIDENCE.score)
  )
    return "Note à confirmer.";
  if (copy.warnings.length) return copy.warnings[0];

  const validQuestions = new Map(
    questions.map((question) => [question.id, question]),
  );
  const seen = new Set<string>();
  for (const response of copy.responses) {
    const question = validQuestions.get(response.questionId);
    if (!question || seen.has(response.questionId))
      return "Correspondance des questions à confirmer.";
    seen.add(response.questionId);
    const raw = response.awardedPoints.trim().replace(",", ".");
    if (raw) {
      const points = Number(raw);
      if (
        !Number.isFinite(points) ||
        points < 0 ||
        (question.maxPoints !== null && points > question.maxPoints)
      )
        return "Points attribués à confirmer.";
    }
  }
  return null;
}

export function normalizedResponses(
  copy: ScanCopyCandidate,
  questions: ScanQuestion[],
): ScanResponseCandidate[] {
  const byQuestion = new Map(
    copy.responses.map((response) => [response.questionId, response]),
  );
  return questions.map((question) => {
    const response = byQuestion.get(question.id);
    return {
      questionId: question.id,
      responseText: (response?.responseText ?? "").trim(),
      awardedPoints: (response?.awardedPoints ?? "").trim().replace(",", "."),
      teacherAnnotation: (response?.teacherAnnotation ?? "").trim(),
    };
  });
}
