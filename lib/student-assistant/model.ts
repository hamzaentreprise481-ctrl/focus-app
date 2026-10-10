import "server-only";

import { pedagogicalAiModel } from "@/lib/pedagogy/openai";
import { callResponsesApi, ModelCallError, outputText } from "@/lib/pedagogy/openai-client";
import { ASSISTANT_INSTRUCTIONS } from "@/lib/student-assistant/prompt";
import type { AssistantMessage } from "@/lib/student-assistant/policy";

/** Same release model as the teacher analysis unless overridden for Student. */
export function studentAssistantModel(value = process.env.FOCUS_STUDENT_AI_MODEL) {
  return value?.trim() || pedagogicalAiModel();
}

export function studentAssistantConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

/**
 * One Responses API call. The rules are the instructions; the context block
 * and the question are the last user turn. Nothing is stored by the provider
 * (store: false) and nothing is written by FOCUS.
 */
export async function requestAssistantReply({
  question,
  history,
  context,
}: {
  question: string;
  history: AssistantMessage[];
  context: string;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new ModelCallError("OPENAI_API_KEY_MISSING", 0);
  const model = studentAssistantModel();
  const { payload } = await callResponsesApi(
    {
      model,
      instructions: ASSISTANT_INSTRUCTIONS,
      reasoning: { effort: "low" },
      max_output_tokens: 1200,
      store: false,
      input: [
        ...history.map((message) => ({ role: message.role, content: message.content })),
        { role: "user", content: `${context}\n\nQuestion de l’élève :\n${question}` },
      ],
    },
    { apiKey, timeoutMs: 45_000, maxAttempts: 2 },
  );
  const text = outputText(payload).trim();
  if (!text) throw new ModelCallError("OPENAI_EMPTY_OUTPUT", 0);
  return { text, model };
}
