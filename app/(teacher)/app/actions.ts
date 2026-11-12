"use server";

import { revalidatePath } from "next/cache";
import { createAuthClient, requireTeacher } from "@/lib/auth/server";
import type { Evaluation, RawGrade, SkillLevel } from "@/lib/types";
import type { SaveResult } from "@/lib/school-data-context";
import { isSchemaOutdated, SCHEMA_OUTDATED_MESSAGE } from "@/lib/supabase-errors";

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

  // A subject chosen explicitly (the class has several of the teacher's
  // subjects, or the assessment already has one); otherwise the only one, or
  // the competencies' subject. The database still checks the competencies.
  const requested = typeof evaluation.subjectId === "string" && evaluation.subjectId ? evaluation.subjectId : null;
  if (requested && !subjectIds.includes(requested))
    return { ok: false, error: "Cette matière ne vous est pas affectée dans cette classe." };
  let subjectId = requested ?? subjectIds[0];
  if (!requested && subjectIds.length > 1) {
    if (!evaluation.skillIds.length)
      return {
        ok: false,
        error:
          "Plusieurs matières vous sont affectées dans cette classe : choisissez la matière de l’évaluation.",
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
      error: isSchemaOutdated(error)
        ? SCHEMA_OUTDATED_MESSAGE
        : error.code === "42501"
          ? "Vous n’avez pas les droits nécessaires pour enregistrer cette évaluation."
          : "Enregistrement Supabase impossible. Votre saisie est conservée.",
    };
  }

  revalidatePath("/app", "layout");
  return { ok: true };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Deletes an evaluation created by mistake, with its results. Refused once
 * copies have been analysed: the analyses and the teacher's decisions are
 * part of the students' follow-up history and are never erased this way.
 * RLS still decides (only the evaluation's own teacher may delete it); the
 * checks here give a clear answer and confirm the row is really gone.
 */
export async function deleteEvaluationAction(evaluationId: string): Promise<SaveResult> {
  const teacher = await requireTeacher();
  const supabase = await createAuthClient();
  if (!supabase) return { ok: false, error: "Supabase n’est pas configuré." };
  if (typeof evaluationId !== "string" || !UUID.test(evaluationId))
    return { ok: false, error: "Évaluation invalide." };

  const found = await supabase
    .from("assessments")
    .select("id,teacher_id")
    .eq("id", evaluationId)
    .maybeSingle();
  if (found.error) return { ok: false, error: "Impossible de vérifier cette évaluation." };
  if (!found.data) return { ok: false, error: "Évaluation introuvable ou inaccessible." };
  if (found.data.teacher_id !== teacher.id)
    return { ok: false, error: "Seul le professeur qui a créé cette évaluation peut la supprimer." };

  const runs = await supabase
    .from("ai_analysis_runs")
    .select("id", { count: "exact", head: true })
    .eq("assessment_id", evaluationId);
  if (runs.error)
    return {
      ok: false,
      error: isSchemaOutdated(runs.error) ? SCHEMA_OUTDATED_MESSAGE : "Impossible de vérifier l’historique de cette évaluation.",
    };
  const analysed =
    "Des copies de cette évaluation ont déjà été analysées : elle fait partie de l’historique du suivi des élèves et ne peut pas être supprimée. Vous pouvez corriger son titre, sa date et ses résultats.";
  if ((runs.count ?? 0) > 0) return { ok: false, error: analysed };

  const removed = await supabase.from("assessments").delete().eq("id", evaluationId);
  if (removed.error) {
    console.error("FOCUS assessment delete failed", { code: removed.error.code, message: removed.error.message });
    return {
      ok: false,
      error:
        removed.error.code === "42501"
          ? "Vous n’avez pas les droits nécessaires pour supprimer cette évaluation."
          : // The database keeps analysed assessments (an analysis may have been recorded meanwhile).
            removed.error.code === "55000"
            ? analysed
            : "Suppression impossible. L’évaluation est conservée.",
    };
  }
  // Row-level security turns a refused delete into "0 rows": check.
  const still = await supabase.from("assessments").select("id").eq("id", evaluationId).maybeSingle();
  if (still.error || still.data)
    return { ok: false, error: "La suppression n’a pas été acceptée. L’évaluation est conservée." };

  revalidatePath("/app", "layout");
  return { ok: true };
}
