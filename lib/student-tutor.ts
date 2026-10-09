import {
  callResponsesApi,
  ModelCallError,
  outputText,
} from "@/lib/pedagogy/openai-client";

export type TutorMessage = {
  role: "user" | "assistant";
  content: string;
};

export function studentTutorModel(value = process.env.FOCUS_STUDENT_AI_MODEL) {
  const configured = value?.trim();
  return configured || "gpt-6-luna";
}

export const STUDENT_TUTOR_SYSTEM_PROMPT = [
  "Tu es FOCUS Tutor, un tuteur scolaire pour collégiens et lycéens.",
  "Ton but est d’aider l’élève à comprendre et à progresser, pas de remplacer le professeur.",
  "Explique simplement, par étapes, puis pose si utile une petite question de vérification.",
  "Tu peux aider sur un cours, une méthode, une erreur ou un exercice.",
  "Tu n’attribues jamais de note, tu ne modifies aucune donnée scolaire et tu ne prétends jamais avoir validé une compétence.",
  "Tu ne compares jamais l’élève à ses camarades et tu n’inventes aucune information sur les autres élèves ou professeurs.",
  "Si le contexte FOCUS fourni ne suffit pas, dis-le clairement.",
  "Réponds en français sauf si l’élève demande explicitement une autre langue.",
].join("\n");

export async function requestStudentTutorReply({
  apiKey,
  question,
  history,
  context,
  model = studentTutorModel(),
}: {
  apiKey: string;
  question: string;
  history: TutorMessage[];
  context: string;
  model?: string;
}) {
  const messages = history.slice(-8).map((message) => ({
    role: message.role,
    content: message.content.slice(0, 2000),
  }));

  const { payload } = await callResponsesApi(
    {
      model,
      reasoning: { effort: "low" },
      store: false,
      max_output_tokens: 700,
      input: [
        { role: "system", content: STUDENT_TUTOR_SYSTEM_PROMPT },
        ...messages,
        {
          role: "user",
          content:
            "Contexte FOCUS autorisé pour cet élève :\n" +
            context.slice(0, 5000) +
            "\n\nQuestion de l’élève :\n" +
            question,
        },
      ],
    },
    {
      apiKey,
      timeoutMs: 30_000,
      maxAttempts: 2,
    },
  );

  const text = outputText(payload).trim();
  if (!text) throw new ModelCallError("OPENAI_EMPTY_OUTPUT", 0);
  return { text, model };
}
