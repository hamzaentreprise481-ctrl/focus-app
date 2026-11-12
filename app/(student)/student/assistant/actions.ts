"use server";

import { requireStudent } from "@/lib/auth/server";
import { ModelCallError } from "@/lib/pedagogy/openai-client";
import { requestAssistantReply, studentAssistantConfigured } from "@/lib/student-assistant/model";
import {
  asksForFullAnswer,
  asksToChangeOfficialData,
  isUuid,
  OFFICIAL_CHANGE_REFUSAL,
  sanitizeHistory,
  validQuestion,
} from "@/lib/student-assistant/policy";
import { buildAssistantContext } from "@/lib/student-assistant/prompt";
import { takeAssistantSlot } from "@/lib/student-assistant/rate-limit";
import { loadAssistantContext } from "@/lib/student-assistant/server";

export type AssistantResult =
  | { ok: true; reply: string; refused: boolean }
  | { ok: false; error: string };

/**
 * The assistant answers; it never writes. This action reads the student's
 * own data under RLS, refuses requests to change official data before any
 * model call, and returns text — no table is inserted or updated here.
 */
export async function askStudentAssistant(input: {
  question: unknown;
  history?: unknown;
  assessmentId?: unknown;
  full?: unknown;
}): Promise<AssistantResult> {
  const student = await requireStudent();
  const question = validQuestion(input?.question);
  if (!question) return { ok: false, error: "Écris une question de 1 à 1 500 caractères." };

  if (asksToChangeOfficialData(question)) return { ok: true, reply: OFFICIAL_CHANGE_REFUSAL, refused: true };

  if (!studentAssistantConfigured())
    return { ok: false, error: "L’assistant n’est pas encore disponible sur ce serveur." };
  if (!takeAssistantSlot(student.id))
    return { ok: false, error: "Tu as posé beaucoup de questions en peu de temps. Réessaie dans quelques minutes." };

  const assessmentId = isUuid(input?.assessmentId) ? input.assessmentId : null;
  const mode = input?.full === true || asksForFullAnswer(question) ? "full" : "guided";
  try {
    const context = buildAssistantContext(await loadAssistantContext(assessmentId), mode);
    const answer = await requestAssistantReply({ question, history: sanitizeHistory(input?.history), context });
    return { ok: true, reply: answer.text, refused: false };
  } catch (error) {
    if (error instanceof ModelCallError) {
      if (error.providerCode === "insufficient_quota")
        return { ok: false, error: "L’assistant est temporairement indisponible. Réessaie plus tard." };
      if (error.code === "OPENAI_TIMEOUT")
        return { ok: false, error: "L’assistant a mis trop de temps à répondre. Réessaie." };
    }
    return { ok: false, error: "L’assistant n’a pas pu répondre pour le moment. Réessaie dans un instant." };
  }
}
