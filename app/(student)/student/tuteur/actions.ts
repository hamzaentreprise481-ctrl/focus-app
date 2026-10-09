"use server";

import { requireStudent } from "@/lib/auth/server";
import {
  loadStudentAssessments,
  loadStudentIdentity,
  loadStudentProgress,
} from "@/lib/student-data";
import {
  requestStudentTutorReply,
  type TutorMessage,
} from "@/lib/student-tutor";
import { ModelCallError } from "@/lib/pedagogy/openai-client";

type Result =
  | { ok: true; reply: string; model: string }
  | { ok: false; error: string };

export async function askStudentTutor(input: {
  question: string;
  history?: TutorMessage[];
}): Promise<Result> {
  await requireStudent();

  const question = String(input?.question ?? "").trim();
  if (!question || question.length > 2000)
    return { ok: false, error: "La question doit contenir entre 1 et 2 000 caractères." };

  const history = Array.isArray(input.history)
    ? input.history
        .filter(
          (item): item is TutorMessage =>
            !!item &&
            (item.role === "user" || item.role === "assistant") &&
            typeof item.content === "string",
        )
        .slice(-8)
    : [];

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey)
    return {
      ok: false,
      error: "Le tuteur IA n’est pas configuré sur ce serveur.",
    };

  try {
    const [identity, assessments, progress] = await Promise.all([
      loadStudentIdentity(),
      loadStudentAssessments(),
      loadStudentProgress(),
    ]);

    const recent = assessments.slice(0, 5).map((item) => ({
      title: item.title,
      subject: item.subject,
      score: item.score,
      status: item.status,
    }));
    const skills = progress.slice(0, 12).map((item) => ({
      name: item.name,
      subject: item.subject,
      level: item.level,
    }));

    const context = JSON.stringify({
      className: identity.className,
      classLevel: identity.classLevel,
      recentAssessments: recent,
      competencySignals: skills,
    });

    const answer = await requestStudentTutorReply({
      apiKey,
      question,
      history,
      context,
    });
    return { ok: true, reply: answer.text, model: answer.model };
  } catch (error) {
    if (error instanceof ModelCallError) {
      if (error.providerCode === "insufficient_quota")
        return {
          ok: false,
          error: "Le tuteur IA est temporairement indisponible : crédit fournisseur épuisé.",
        };
      if (error.code.includes("429"))
        return {
          ok: false,
          error: "Le tuteur reçoit trop de demandes. Réessayez dans un instant.",
        };
    }
    return {
      ok: false,
      error: "Le tuteur IA n’a pas pu répondre pour le moment.",
    };
  }
}
