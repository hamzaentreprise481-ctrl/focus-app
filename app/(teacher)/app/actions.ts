"use server";

import { revalidatePath } from "next/cache";
import { createAuthClient, requireTeacher } from "@/lib/auth/server";
import type { Evaluation, RawGrade, SkillLevel } from "@/lib/types";
import type { SaveResult } from "@/lib/school-data-context";

const LEVEL_TO_DB: Record<
  SkillLevel,
  "mastered" | "developing" | "fragile" | "not_mastered"
> = {
  maitrise: "mastered",
  en_cours: "developing",
  fragile: "fragile",
  non_maitrise: "not_mastered",
};

function validCalendarDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export async function saveEvaluationAction(
  evaluation: Evaluation,
  grades: RawGrade[],
): Promise<SaveResult> {
  const teacher = await requireTeacher();
  const supabase = await createAuthClient();
  if (!supabase)
    return { ok: false, error: "Supabase n’est pas configuré." };

  if (
    !evaluation ||
    typeof evaluation.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      evaluation.id,
    ) ||
    typeof evaluation.classId !== "string" ||
    !evaluation.classId ||
    typeof evaluation.name !== "string" ||
    !evaluation.name.trim() ||
    evaluation.name.trim().length > 200 ||
    !validCalendarDate(evaluation.date) ||
    !Array.isArray(evaluation.skillIds) ||
    !Array.isArray(grades)
  ) {
    return { ok: false, error: "Les données de l’évaluation sont invalides." };
  }

  const assignmentResponse = await supabase
    .from("teacher_assignments")
    .select("subject_id")
    .eq("teacher_id", teacher.id)
    .eq("class_id", evaluation.classId);
  if (assignmentResponse.error)
    return {
      ok: false,
      error: "Impossible de vérifier votre affectation à cette classe.",
    };

  const subjectIds = [
    ...new Set(
      (assignmentResponse.data ?? []).map(
        (row: { subject_id: string }) => row.subject_id,
      ),
    ),
  ];
  if (!subjectIds.length)
    return {
      ok: false,
      error: "Cette classe n’est pas affectée à votre compte professeur.",
    };

  let subjectId = subjectIds[0];
  if (subjectIds.length > 1) {
    if (!evaluation.skillIds.length)
      return {
        ok: false,
        error:
          "Plusieurs matières sont affectées à cette classe. Ajoutez au moins une compétence pour identifier la matière.",
      };
    const competencyResponse = await supabase
      .from("competencies")
      .select("subject_id")
      .in("id", evaluation.skillIds);
    if (competencyResponse.error)
      return {
        ok: false,
        error: "Impossible de vérifier les compétences sélectionnées.",
      };
    const competencySubjects = [
      ...new Set(
        (competencyResponse.data ?? []).map(
          (row: { subject_id: string }) => row.subject_id,
        ),
      ),
    ];
    if (
      competencySubjects.length !== 1 ||
      !subjectIds.includes(competencySubjects[0])
    )
      return {
        ok: false,
        error: "Les compétences ne correspondent pas à une matière affectée.",
      };
    subjectId = competencySubjects[0];
  }

  const results = grades.map((grade) => ({
    studentId: grade.studentId,
    score: grade.score,
    absent: grade.absent,
    skillLevels: Object.fromEntries(
      Object.entries(grade.skillLevels ?? {})
        .filter(
          ([skillId, level]) =>
            evaluation.skillIds.includes(skillId) && !!level,
        )
        .map(([skillId, level]) => [
          skillId,
          LEVEL_TO_DB[level as SkillLevel],
        ]),
    ),
  }));

  const { error } = await supabase.rpc("focus_save_assessment", {
    p_assessment_id: evaluation.id,
    p_title: evaluation.name.trim(),
    p_date: evaluation.date,
    p_class_id: evaluation.classId,
    p_subject_id: subjectId,
    p_competency_ids: evaluation.skillIds,
    p_results: results,
    p_important: evaluation.important === true,
  });

  if (error) {
    console.error("FOCUS assessment save failed", {
      code: error.code,
      message: error.message,
    });
    return {
      ok: false,
      error:
        error.code === "42501"
          ? "Vous n’avez pas les droits nécessaires pour enregistrer cette évaluation."
          : "Enregistrement Supabase impossible. Votre saisie est conservée.",
    };
  }

  revalidatePath("/app", "layout");
  return { ok: true };
}
