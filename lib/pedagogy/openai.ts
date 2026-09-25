import "server-only";

import type {
  CurriculumNodeSummary,
  ModelPedagogicalAnalysis,
} from "@/lib/pedagogy/types";

interface AnalyzeQuestionInput {
  assessmentId: string;
  questionId: string;
  prompt: string;
  correctionText: string;
  rubricText: string;
  maxPoints: number | null;
  responseText: string;
  awardedPoints: number | null;
  teacherAnnotation: string | null;
}

export interface PedagogicalAiInput {
  assessment: {
    id: string;
    title: string;
    contextText: string | null;
    instructionsText: string | null;
  };
  questions: AnalyzeQuestionInput[];
  curriculum: CurriculumNodeSummary[];
}

function outputText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const response = payload as { output?: unknown[] };
  if (!Array.isArray(response.output)) return "";
  const chunks: string[] = [];
  for (const item of response.output) {
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

export function pedagogicalAiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function analyzePedagogicalEvidence(
  input: PedagogicalAiInput,
): Promise<{ model: string; analysis: ModelPedagogicalAnalysis }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY_MISSING");

  const model = process.env.FOCUS_AI_MODEL || "gpt-5.6-terra";
  const system = [
    "Tu es le moteur d'analyse pédagogique de FOCUS pour un professeur de mathématiques en lycée français.",
    "Tu analyses uniquement les preuves fournies : sujet, question, corrigé/barème, réponse exacte de l'élève, annotation éventuelle et graphe officiel fourni.",
    "Interdiction absolue de déduire une difficulté à partir d'une moyenne générale, d'une note globale ou d'un profil supposé de l'élève.",
    "Chaque erreur retournée doit citer mot pour mot un court extrait réellement présent dans responseText.",
    "Chaque nodeCode doit appartenir exactement à la liste curriculum fournie. N'invente jamais un point du programme.",
    "Tu dois distinguer explicitement trois issues : errors_found, no_error_observed, insufficient_evidence.",
    "Utilise insufficient_evidence si la réponse est vide, trop partielle, ambiguë ou si le corrigé/barème ne permet pas d'établir une erreur précise. Dans ce cas, errors doit être vide et insufficientReason doit expliquer brièvement ce qui manque.",
    "Utilise no_error_observed uniquement quand les preuves permettent de considérer la réponse comme correcte ou sans erreur pédagogique identifiable. Dans ce cas, errors doit être vide.",
    "Utilise errors_found uniquement si au moins une erreur précise est démontrée par la réponse de l'élève.",
    "Une action pédagogique doit cibler l'erreur observée et rester proportionnée à la preuve.",
    "Ne produis aucun diagnostic psychologique, médical, comportemental ou social.",
  ].join("\n");

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      status: {
        type: "string",
        enum: ["errors_found", "no_error_observed", "insufficient_evidence"],
      },
      insufficientReason: { type: "string" },
      errors: {
        type: "array",
        maxItems: 12,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            assessmentId: { type: "string" },
            questionId: { type: "string" },
            nodeCode: { type: "string" },
            errorType: {
              type: "string",
              enum: [
                "concept",
                "calcul",
                "raisonnement",
                "representation",
                "communication",
                "methode",
                "prerequis",
              ],
            },
            difficulty: { type: "string" },
            evidenceExcerpt: { type: "string" },
            explanation: { type: "string" },
            recommendedAction: { type: "string" },
          },
          required: [
            "assessmentId",
            "questionId",
            "nodeCode",
            "errorType",
            "difficulty",
            "evidenceExcerpt",
            "explanation",
            "recommendedAction",
          ],
        },
      },
    },
    required: ["status", "insufficientReason", "errors"],
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      reasoning: { effort: "low" },
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: system }],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify(input),
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "focus_pedagogical_analysis",
          strict: true,
          schema,
        },
      },
    }),
  });

  if (!response.ok) {
    const body = (await response.text()).slice(0, 1000);
    throw new Error(`OPENAI_REQUEST_FAILED:${response.status}:${body}`);
  }

  const payload = (await response.json()) as unknown;
  const text = outputText(payload);
  if (!text) throw new Error("OPENAI_EMPTY_OUTPUT");

  const parsed = JSON.parse(text) as ModelPedagogicalAnalysis;
  return { model, analysis: parsed };
}
