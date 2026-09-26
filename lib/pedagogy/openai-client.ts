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

// Shared by the server action and the opt-in live campaign. Never log the
// provider's error body: it may echo text from a student's response.
export async function requestPedagogicalAnalysis(
  input: unknown,
  options: { apiKey: string; model: string; fetchImpl?: typeof fetch; baseUrl?: string },
): Promise<ModelPedagogicalAnalysis> {
  const response = await (options.fetchImpl ?? fetch)(
    `${options.baseUrl ?? openAiBaseUrl()}/responses`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: options.model,
        reasoning: { effort: "low" },
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
      }),
    },
  );
  if (!response.ok) throw new Error(`OPENAI_REQUEST_FAILED:${response.status}`);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("OPENAI_INVALID_OUTPUT");
  }
  const text = outputText(payload);
  if (!text) throw new Error("OPENAI_EMPTY_OUTPUT");
  try {
    return JSON.parse(text) as ModelPedagogicalAnalysis;
  } catch {
    throw new Error("OPENAI_INVALID_OUTPUT");
  }
}
