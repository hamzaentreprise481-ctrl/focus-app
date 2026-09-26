import "server-only";

import type { AiCurriculumNode } from "@/lib/curriculum/graph";
import type { ModelPedagogicalAnalysis } from "@/lib/pedagogy/types";
import { requestPedagogicalAnalysis } from "@/lib/pedagogy/openai-client";

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
  curriculum: AiCurriculumNode[];
}

export function pedagogicalAiModel() {
  return process.env.FOCUS_AI_MODEL || "gpt-5.6-terra";
}

export function pedagogicalAiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function probePedagogicalAiConnection(): Promise<{
  configured: boolean;
  ok: boolean;
  model: string;
  apiStatus: number | null;
  error: string | null;
}> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = pedagogicalAiModel();
  if (!apiKey)
    return {
      configured: false,
      ok: false,
      model,
      apiStatus: null,
      error: "OPENAI_API_KEY_MISSING",
    };

  try {
    const response = await fetch(
      `https://api.openai.com/v1/models/${encodeURIComponent(model)}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: "no-store",
      },
    );
    if (!response.ok)
      return {
        configured: true,
        ok: false,
        model,
        apiStatus: response.status,
        error:
          response.status === 401
            ? "OPENAI_API_KEY_INVALID"
            : response.status === 404
              ? "OPENAI_MODEL_UNAVAILABLE"
              : "OPENAI_API_UNAVAILABLE",
      };
    return {
      configured: true,
      ok: true,
      model,
      apiStatus: response.status,
      error: null,
    };
  } catch {
    return {
      configured: true,
      ok: false,
      model,
      apiStatus: null,
      error: "OPENAI_NETWORK_ERROR",
    };
  }
}

export async function analyzePedagogicalEvidence(
  input: PedagogicalAiInput,
): Promise<{ model: string; analysis: ModelPedagogicalAnalysis }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY_MISSING");

  const model = pedagogicalAiModel();
  const analysis = await requestPedagogicalAnalysis(input, { apiKey, model });
  return { model, analysis };
}
