import { requireStudent } from "@/lib/auth/server";
import { loadStudentAssessments } from "@/lib/student-data";
import { studentAssistantConfigured } from "@/lib/student-assistant/model";
import { StudentAssistant } from "@/components/student/student-assistant";

// One model call per question, bounded at 45 s (lib/student-assistant/model.ts).
export const maxDuration = 60;

function shortDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" }).format(new Date(value + "T12:00:00"));
}

export default async function StudentAssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ evaluation?: string }>;
}) {
  await requireStudent();
  const assessments = await loadStudentAssessments();
  const { evaluation } = await searchParams;
  // Preselect only one of the student's own assessments.
  const initialAssessmentId = assessments.some((assessment) => assessment.id === evaluation) ? evaluation! : "";

  return (
    <div className="space-y-7">
      <header className="rounded-2xl border border-border bg-white p-6 shadow-sm sm:p-7">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">
          Aide pédagogique
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Assistant FOCUS</h1>
        <p className="mt-3 max-w-3xl text-ink-soft">
          Pour comprendre une notion, une erreur ou t’entraîner. L’assistant
          utilise uniquement tes propres résultats, tes réponses enregistrées,
          les commentaires de tes professeurs et le programme officiel. Il ne
          peut ni noter, ni modifier une note, une correction ou une
          compétence : seuls tes professeurs décident.
        </p>
      </header>
      <StudentAssistant
        initialAssessmentId={initialAssessmentId}
        configured={studentAssistantConfigured()}
        assessments={assessments.map((assessment) => ({
          id: assessment.id,
          label: `${assessment.title} · ${assessment.subject} · ${shortDate(assessment.date)}`,
        }))}
      />
    </div>
  );
}
