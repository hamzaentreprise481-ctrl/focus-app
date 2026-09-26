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

// Shared by the server action and the opt-in live campaign. Never log the
// provider's error body: it may echo text from a student's response.
export async function requestPedagogicalAnalysis(
  input: unknown,
  options: { apiKey: string; model: string; fetchImpl?: typeof fetch },
): Promise<ModelPedagogicalAnalysis> {
  const response = await (options.fetchImpl ?? fetch)(
    "https://api.openai.com/v1/responses",
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
