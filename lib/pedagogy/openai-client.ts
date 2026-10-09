import type { ModelPedagogicalAnalysis } from "./types";
import { PEDAGOGICAL_OUTPUT_SCHEMA, PEDAGOGICAL_SYSTEM_PROMPT } from "./prompt";

/** The concatenated output_text parts of a Responses API payload. */
export function outputText(payload: unknown): string {
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

/**
 * A failed model call keeps its latency; the message is a FOCUS code only.
 * providerCode is the provider's machine error code (e.g. "insufficient_quota",
 * "rate_limit_exceeded") when it sent one — never its message, which may echo
 * student text.
 */
export class ModelCallError extends Error {
  constructor(
    public readonly code: string,
    public readonly latencyMs: number,
    public readonly providerCode: string | null = null,
    public readonly attempts = 1,
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

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

async function providerErrorCode(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: { code?: unknown; type?: unknown } };
    // An exhausted credit comes as type "insufficient_quota" (code
    // "insufficient_quota" or "credit_balance_exhausted"): one FOCUS code.
    if (body?.error?.type === "insufficient_quota" || body?.error?.code === "credit_balance_exhausted") return "insufficient_quota";
    const code = body?.error?.code ?? body?.error?.type;
    return typeof code === "string" && /^[a-z0-9_.-]{1,64}$/i.test(code) ? code : null;
  } catch {
    return null;
  }
}

/**
 * One POST to the Responses API with bounded retries: 429 and 5xx are retried
 * (Retry-After honoured, at most 15 s per wait) while the shared deadline
 * allows; an exhausted quota is never retried. Every attempt shares one
 * deadline, so retries never extend the teacher's request. Used by the
 * pedagogical analysis and by the scan transcription.
 */
export async function callResponsesApi(
  body: Record<string, unknown>,
  options: { apiKey: string; fetchImpl?: typeof fetch; baseUrl?: string; timeoutMs: number; maxAttempts?: number },
): Promise<{ payload: unknown; latencyMs: number; attempts: number }> {
  const started = Date.now();
  const deadline = started + options.timeoutMs;
  const maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? 3, 4));
  const serialized = JSON.stringify(body);
  let attempt = 0;
  const fail = (code: string, providerCode: string | null = null): never => {
    throw new ModelCallError(code, Date.now() - started, providerCode, attempt);
  };
  const retryDelayMs = (response: Response) => {
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.round(seconds * 1000), 15_000);
      const date = Date.parse(retryAfter);
      if (Number.isFinite(date)) return Math.min(Math.max(0, date - Date.now()), 15_000);
    }
    return Math.min(2_000 * attempt, 6_000);
  };

  let response: Response | undefined;
  while (attempt < maxAttempts) {
    attempt++;
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) fail("OPENAI_TIMEOUT");
    try {
      response = await (options.fetchImpl ?? fetch)(`${options.baseUrl ?? openAiBaseUrl()}/responses`, {
        method: "POST",
        signal: AbortSignal.timeout(remainingMs),
        headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
        body: serialized,
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      fail(name === "TimeoutError" || name === "AbortError" ? "OPENAI_TIMEOUT" : "OPENAI_NETWORK_ERROR");
    }
    if (response!.ok) break;
    const status = response!.status;
    const retryable = RETRYABLE_STATUS.has(status);
    const code = retryable || status >= 400 ? await providerErrorCode(response!.clone()) : null;
    // An exhausted quota is not temporary: retrying only delays the answer.
    if (!retryable || code === "insufficient_quota" || attempt >= maxAttempts)
      fail(`OPENAI_REQUEST_FAILED:${status}`, code);
    const delayMs = Math.min(retryDelayMs(response!), Math.max(0, deadline - Date.now() - 1));
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  let payload: unknown;
  try {
    payload = await response!.json();
  } catch {
    fail("OPENAI_INVALID_OUTPUT");
  }
  return { payload, latencyMs: Date.now() - started, attempts: attempt };
}

/**
 * The evidence as two JSON parts: first what is the SAME for every copy of a
 * class (its programme and catalogue, ~13 000 tokens), then the copy
 * (assessment, questions, answers). Identical leading tokens let the provider
 * reuse its prompt cache from one copy to the next (cached input is billed
 * about ten times less); the model reads the same two objects either way.
 */
export function analysisContentParts(input: unknown) {
  if (input && typeof input === "object" && "curriculum" in input) {
    const { curriculum, ...copy } = input as { curriculum: unknown } & Record<string, unknown>;
    return [
      { type: "input_text", text: JSON.stringify({ curriculum }) },
      { type: "input_text", text: JSON.stringify(copy) },
    ];
  }
  return [{ type: "input_text", text: JSON.stringify(input) }];
}

/** The analysis input a request carries, whatever its parts (tests and stand-ins). */
export function analysisInputFromRequest(body: { input: Array<{ content: Array<{ text?: string }> }> }) {
  return Object.assign({}, ...body.input[1].content.map((part) => JSON.parse(part.text ?? "{}")));
}

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
  const { payload } = await callResponsesApi(
    {
      model: options.model,
      reasoning: { effort: options.reasoningEffort ?? "low" },
      input: [
        { role: "system", content: [{ type: "input_text", text: PEDAGOGICAL_SYSTEM_PROMPT }] },
        { role: "user", content: analysisContentParts(input) },
      ],
      text: {
        format: { type: "json_schema", name: "focus_pedagogical_analysis", strict: true, schema: PEDAGOGICAL_OUTPUT_SCHEMA },
      },
    },
    {
      apiKey: options.apiKey,
      fetchImpl: options.fetchImpl,
      baseUrl: options.baseUrl,
      timeoutMs: options.timeoutMs ?? MODEL_TIMEOUT_MS,
      maxAttempts: options.maxAttempts ?? 3,
    },
  );
  const fail = (code: string): never => {
    throw new ModelCallError(code, Date.now() - started);
  };
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
