import "server-only";

import { openAiBaseUrl } from "@/lib/pedagogy/openai-client";
import { pedagogicalAiModel } from "@/lib/pedagogy/openai";

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

function outputText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const output = (payload as { output?: unknown[] }).output;
  if (!Array.isArray(output)) return "";
  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown[] }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (
        part &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "output_text" &&
        typeof (part as { text?: unknown }).text === "string"
      )
        chunks.push((part as { text: string }).text);
    }
  }
  return chunks.join("\n");
}

const confidenceSchema = { type: "number", minimum: 0, maximum: 1 } as const;

function extractionSchema(roster: ScanRosterStudent[], questions: ScanQuestion[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["pageCount", "copies", "unassignedPages", "warnings"],
    properties: {
      pageCount: { type: "integer", minimum: 1 },
      copies: {
        type: "array",
        maxItems: Math.max(roster.length + 5, 10),
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "studentId",
            "studentNameRead",
            "identificationConfidence",
            "groupingConfidence",
            "transcriptionConfidence",
            "startPage",
            "endPage",
            "score",
            "scoreConfidence",
            "responses",
            "warnings",
          ],
          properties: {
            studentId: { enum: [null, ...roster.map((student) => student.id)] },
            studentNameRead: { type: "string", maxLength: 200 },
            identificationConfidence: confidenceSchema,
            groupingConfidence: confidenceSchema,
            transcriptionConfidence: confidenceSchema,
            startPage: { type: "integer", minimum: 1 },
            endPage: { type: "integer", minimum: 1 },
            score: { type: ["number", "null"], minimum: 0, maximum: 20 },
            scoreConfidence: confidenceSchema,
            responses: {
              type: "array",
              maxItems: Math.max(questions.length, 1),
              items: {
                type: "object",
                additionalProperties: false,
                required: [
                  "questionId",
                  "responseText",
                  "awardedPoints",
                  "teacherAnnotation",
                ],
                properties: {
                  questionId: { enum: questions.map((question) => question.id) },
                  responseText: { type: "string", maxLength: 12000 },
                  awardedPoints: { type: "string", maxLength: 20 },
                  teacherAnnotation: { type: "string", maxLength: 3000 },
                },
              },
            },
            warnings: {
              type: "array",
              maxItems: 12,
              items: { type: "string", maxLength: 300 },
            },
          },
        },
      },
      unassignedPages: {
        type: "array",
        items: { type: "integer", minimum: 1 },
      },
      warnings: {
        type: "array",
        maxItems: 20,
        items: { type: "string", maxLength: 300 },
      },
    },
  };
}

export function scanImportModel() {
  return process.env.FOCUS_SCAN_MODEL || pedagogicalAiModel();
}

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

  const validQuestions = new Map(questions.map((question) => [question.id, question]));
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
  const byQuestion = new Map(copy.responses.map((response) => [response.questionId, response]));
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

export async function extractScanStack(
  bytes: Uint8Array,
  roster: ScanRosterStudent[],
  questions: ScanQuestion[],
): Promise<ScanExtraction> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY_MISSING");
  if (!roster.length) throw new Error("EMPTY_ROSTER");
  if (!questions.length) throw new Error("NO_ASSESSMENT_QUESTIONS");
  if (!bytes.length || bytes.length > MAX_SCAN_BYTES) throw new Error("SCAN_FILE_SIZE");

  const rosterText = roster
    .map((student) => `${student.id} | ${student.name}`)
    .join("\n");
  const questionText = questions
    .map(
      (question) =>
        `${question.position}. ${question.id} | ${question.prompt} | max=${question.maxPoints ?? "inconnu"}`,
    )
    .join("\n");

  const instructions = [
    "Tu es le moteur de numérisation de FOCUS. Tu extrais des faits visibles, tu ne fais aucune analyse pédagogique.",
    "Le PDF contient une pile de copies déjà corrigées par le professeur. Les copies peuvent être sur feuilles simples ou doubles, recto-verso, et avoir des longueurs différentes.",
    "Travail demandé : 1) détecter où commence et finit chaque copie, 2) associer chaque copie à UN élève de la liste fournie quand le nom/prénom manuscrit le permet, 3) lire la note finale sur 20 si elle est visible, 4) transcrire les réponses manuscrites par question, les points attribués et les annotations du professeur.",
    "Ne devine jamais. En cas de doute : baisse la confiance, ajoute un warning, laisse studentId ou score à null si nécessaire.",
    "studentId doit être null ou exactement un identifiant de la liste. Les numéros de page sont 1-indexés. Ne mélange jamais deux élèves.",
    "Pour responseText, conserve au maximum la formulation de l’élève, y compris les calculs utiles. Pour teacherAnnotation, ne mets que ce que le professeur a écrit/corrigé, pas ton interprétation.",
    "Une réponse absente reste une chaîne vide. N’invente pas de réponse pour remplir une question.",
    "",
    "ÉLÈVES AUTORISÉS:",
    rosterText,
    "",
    "QUESTIONS AUTORISÉES:",
    questionText,
  ].join("\n");

  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(`${openAiBaseUrl()}/responses`, {
      method: "POST",
      signal: AbortSignal.timeout(180_000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: scanImportModel(),
        reasoning: { effort: "low" },
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_file",
                filename: "copies.pdf",
                file_data: `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}`,
                detail: "high",
              },
              { type: "input_text", text: instructions },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "focus_scan_stack",
            strict: true,
            schema: extractionSchema(roster, questions),
          },
        },
      }),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    throw new Error(name === "TimeoutError" || name === "AbortError" ? "SCAN_MODEL_TIMEOUT" : "SCAN_MODEL_NETWORK");
  }
  if (!response.ok) throw new Error(`SCAN_MODEL_HTTP_${response.status}`);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("SCAN_MODEL_INVALID_JSON");
  }
  const text = outputText(payload);
  if (!text) throw new Error("SCAN_MODEL_EMPTY");
  let parsed: ScanExtraction;
  try {
    parsed = JSON.parse(text) as ScanExtraction;
  } catch {
    throw new Error("SCAN_MODEL_INVALID_OUTPUT");
  }

  console.info(
    JSON.stringify({
      event: "focus.scan_import",
      model: scanImportModel(),
      latencyMs: Date.now() - started,
      pages: parsed.pageCount,
      copies: parsed.copies.length,
      unassignedPages: parsed.unassignedPages.length,
    }),
  );
  return parsed;
}
