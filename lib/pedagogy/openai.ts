import "server-only";

import type {
  CurriculumNodeSummary,
  ModelPedagogicalAnalysis,
} from "@/lib/pedagogy/types";
import {
  PEDAGOGICAL_OUTPUT_SCHEMA,
  PEDAGOGICAL_SYSTEM_PROMPT,
} from "@/lib/pedagogy/prompt";

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
  const system = PEDAGOGICAL_SYSTEM_PROMPT;
  const schema = PEDAGOGICAL_OUTPUT_SCHEMA;

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
