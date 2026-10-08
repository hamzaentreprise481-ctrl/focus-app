import "server-only";

import type { AiCurriculumNode } from "@/lib/curriculum/graph";
import { engineSigningKey } from "@/lib/pedagogy/engine-signature";
import {
  ModelCallError,
  openAiBaseUrl,
  pedagogicalReasoningEffort,
  requestPedagogicalAnalysisWithUsage,
} from "@/lib/pedagogy/openai-client";

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
  /**
   * Everything here is covered by the evidence version the database checks
   * when it records the analysis (focus_private.evidence_version).
   */
  assessment: {
    id: string;
    contextText: string | null;
    instructionsText: string | null;
  };
  questions: AnalyzeQuestionInput[];
  curriculum: AiCurriculumNode[];
}

export function pedagogicalAiModel() {
  return process.env.FOCUS_AI_MODEL || "gpt-5.6-terra";
}

/** The model key and the signing key that lets the database accept its output. */
export function pedagogicalAiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY) && engineSigningKey() !== null;
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
      `${openAiBaseUrl()}/models/${encodeURIComponent(model)}`,
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

export async function analyzePedagogicalEvidence(input: PedagogicalAiInput) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new ModelCallError("OPENAI_API_KEY_MISSING", 0);

  const model = pedagogicalAiModel();
  const result = await requestPedagogicalAnalysisWithUsage(input, { apiKey, model, reasoningEffort: pedagogicalReasoningEffort() });
  return { model, ...result };
}
