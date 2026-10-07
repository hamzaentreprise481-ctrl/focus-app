import type { ModelPedagogicalAnalysis } from "./types";
import { PEDAGOGICAL_OUTPUT_SCHEMA, PEDAGOGICAL_SYSTEM_PROMPT } from "./prompt";

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

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

/** Model calls a teacher may trigger per hour (cost guard). */
export function pedagogicalAiHourlyLimit(value = process.env.FOCUS_AI_HOURLY_LIMIT) {
  const limit = Number(value);
  return Number.isInteger(limit) && limit > 0 ? limit : 150;
}

/**
 * Server-only API base. HTTPS is required; a loopback HTTP address is accepted
 * outside Vercel so that local end-to-end tests can use a scripted stand-in.
 * Anything else falls back to the provider's public API.
 */
export function openAiBaseUrl(value = process.env.OPENAI_BASE_URL) {
  if (!value) return DEFAULT_BASE_URL;
  try {
    const url = new URL(value);
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    if (url.protocol === "https:" || (url.protocol === "http:" && loopback && !process.env.VERCEL))
      return url.toString().replace(/\/+$/, "");
  } catch {
    /* invalid value: use the default */
  }
  return DEFAULT_BASE_URL;
}

export type ReasoningEffort = "low" | "medium" | "high";

/** FOCUS_AI_REASONING_EFFORT, when valid; "low" otherwise. */
export function pedagogicalReasoningEffort(value = process.env.FOCUS_AI_REASONING_EFFORT): ReasoningEffort {
  return value === "medium" || value === "high" ? value : "low";
}

/** Token counts reported by the provider (absent fields stay null). */
export interface ModelUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
}

/** A failed model call keeps its latency; the message is a FOCUS code only. */
export class ModelCallError extends Error {
  constructor(
    public readonly code: string,
    public readonly latencyMs: number,
  ) {
    super(code);
  }
}

const count = (value: unknown) => (Number.isInteger(value) && (value as number) >= 0 ? (value as number) : null);

export function usageFrom(payload: unknown): ModelUsage {
  const usage = (payload as { usage?: Record<string, unknown> } | null)?.usage;
  const details = usage?.output_tokens_details as Record<string, unknown> | undefined;
  return {
    inputTokens: count(usage?.input_tokens),
    outputTokens: count(usage?.output_tokens),
    reasoningTokens: count(details?.reasoning_tokens),
    totalTokens: count(usage?.total_tokens),
  };
}

/**
 * The model gets at most this long per copy. The pages whose Server Actions
 * call it allow 120 s (maxDuration), which leaves room for the database work
 * around the call (tests/function-duration.test.ts).
 */
export const MODEL_TIMEOUT_MS = 90_000;

// Shared by the server action and the opt-in live campaign. Never log the
// provider's error body: it may echo text from a student's response.
export async function requestPedagogicalAnalysisWithUsage(
  input: unknown,
  options: {
    apiKey: string;
    model: string;
    fetchImpl?: typeof fetch;
    baseUrl?: string;
    timeoutMs?: number;
    reasoningEffort?: ReasoningEffort;
    /** Internal/test override. Production uses three attempts within one 90 s budget. */
    maxAttempts?: number;
  },
): Promise<{ analysis: ModelPedagogicalAnalysis; usage: ModelUsage; latencyMs: number }> {
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? MODEL_TIMEOUT_MS;
  const deadline = started + timeoutMs;
  const maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? 3, 3));
  const fail = (code: string): never => {
    throw new ModelCallError(code, Date.now() - started);
  };
  const retryableStatus = (status: number) => status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
  const retryDelayMs = (response: Response, attempt: number) => {
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.round(seconds * 1000), 15_000);
      const date = Date.parse(retryAfter);
      if (Number.isFinite(date)) return Math.min(Math.max(0, date - Date.now()), 15_000);
    }
    return Math.min(2_000 * attempt, 6_000);
  };

  const body = JSON.stringify({
    model: options.model,
    reasoning: { effort: options.reasoningEffort ?? "low" },
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: PEDAGOGICAL_SYSTEM_PROMPT }],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: JSON.stringify(input) }],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "focus_pedagogical_analysis",
        strict: true,
        schema: PEDAGOGICAL_OUTPUT_SCHEMA,
      },
    },
  });

  let response: Response | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) fail("OPENAI_TIMEOUT");
    try {
      response = await (options.fetchImpl ?? fetch)(`${options.baseUrl ?? openAiBaseUrl()}/responses`, {
        method: "POST",
        // All attempts share one deadline; retries can never extend the teacher request indefinitely.
        signal: AbortSignal.timeout(remainingMs),
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body,
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      fail(name === "TimeoutError" || name === "AbortError" ? "OPENAI_TIMEOUT" : "OPENAI_NETWORK_ERROR");
    }

    if (response.ok) break;
    if (!retryableStatus(response.status) || attempt === maxAttempts) fail(`OPENAI_REQUEST_FAILED:${response.status}`);

    const delayMs = Math.min(retryDelayMs(response, attempt), Math.max(0, deadline - Date.now() - 1));
    if (delayMs <= 0) fail("OPENAI_TIMEOUT");
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  if (!response?.ok) fail(`OPENAI_REQUEST_FAILED:${response?.status ?? 0}`);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    fail("OPENAI_INVALID_OUTPUT");
  }
  const text = outputText(payload);
  if (!text) fail("OPENAI_EMPTY_OUTPUT");
  let analysis: ModelPedagogicalAnalysis;
  try {
    analysis = JSON.parse(text) as ModelPedagogicalAnalysis;
  } catch {
    return fail("OPENAI_INVALID_OUTPUT");
  }
  return { analysis, usage: usageFrom(payload), latencyMs: Date.now() - started };
}

export async function requestPedagogicalAnalysis(
  input: unknown,
  options: Parameters<typeof requestPedagogicalAnalysisWithUsage>[1],
): Promise<ModelPedagogicalAnalysis> {
  return (await requestPedagogicalAnalysisWithUsage(input, options)).analysis;
}
