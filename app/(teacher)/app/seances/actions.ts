"use server";

import { revalidatePath } from "next/cache";
import { createAuthClient, requireTeacher } from "@/lib/auth/server";

type State = { ok?: boolean; error?: string } | null;

export async function createLesson(
  _previous: State,
  form: FormData,
): Promise<State> {
  const teacher = await requireTeacher();
  const assignmentId = String(form.get("assignment_id") ?? "");
  const date = String(form.get("date") ?? "");
  const summary = String(form.get("summary") ?? "").trim();
  const competencyIds = form
    .getAll("competency_id")
    .map((value) => String(value))
    .filter((value) => /^[0-9a-f-]{36}$/i.test(value));

  if (!/^[0-9a-f-]{36}$/i.test(assignmentId))
    return { error: "Affectation invalide." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    return { error: "Date invalide." };
  if (!summary || summary.length > 2000)
    return { error: "Le résumé doit contenir entre 1 et 2 000 caractères." };

  const supabase = await createAuthClient();
  if (!supabase) return { error: "Supabase n’est pas configuré." };

  const assignmentResponse = await supabase
    .from("teacher_assignments")
    .select("id,school_id,class_id,subject_id")
    .eq("id", assignmentId)
    .eq("teacher_id", teacher.id)
    .maybeSingle();

  if (assignmentResponse.error || !assignmentResponse.data)
    return { error: "Cette affectation ne vous appartient pas." };

  const assignment = assignmentResponse.data as {
    id: string;
    school_id: string;
    class_id: string;
    subject_id: string;
  };

  let validCompetencies: string[] = [];
  if (competencyIds.length) {
    const competencyResponse = await supabase
      .from("competencies")
      .select("id")
      .eq("subject_id", assignment.subject_id)
      .in("id", [...new Set(competencyIds)]);
    if (competencyResponse.error)
      return { error: "Impossible de vérifier les compétences sélectionnées." };
    validCompetencies = (competencyResponse.data ?? []).map(
      (row: { id: string }) => row.id,
    );
    if (validCompetencies.length !== new Set(competencyIds).size)
      return { error: "Une compétence sélectionnée n’appartient pas à cette matière." };
  }

  const lessonResponse = await supabase
    .from("lessons")
    .insert({
      school_id: assignment.school_id,
      class_id: assignment.class_id,
      subject_id: assignment.subject_id,
      teacher_id: teacher.id,
      date,
      summary,
    })
    .select("id")
    .single();

  if (lessonResponse.error || !lessonResponse.data)
    return { error: "La séance n’a pas pu être enregistrée." };

  const lessonId = (lessonResponse.data as { id: string }).id;

  if (validCompetencies.length) {
    const linkResponse = await supabase.from("lesson_competencies").insert(
      validCompetencies.map((competencyId) => ({
        lesson_id: lessonId,
        competency_id: competencyId,
      })),
    );
    if (linkResponse.error) {
      await supabase.from("lessons").delete().eq("id", lessonId);
      return {
        error:
          "La séance n’a pas pu être reliée aux compétences. Aucun enregistrement n’a été conservé.",
      };
    }
  }

  revalidatePath("/app/seances");
  revalidatePath("/director");
  revalidatePath("/director/programme");
  return { ok: true };
}
