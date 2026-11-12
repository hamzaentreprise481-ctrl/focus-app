import "server-only";

import { createAuthClient, requireStudent } from "@/lib/auth/server";
import { resolveCurriculumScope } from "@/lib/curriculum/graph";
import {
  loadStudentAssessmentDetail,
  loadStudentAssessments,
  loadStudentIdentity,
  loadStudentProgress,
} from "@/lib/student-data";
import type { AssistantContextData } from "@/lib/student-assistant/prompt";

/**
 * Everything the assistant may know, read with the STUDENT's session: RLS
 * limits each query to the student's own results, answers and competency
 * levels, their class's assessments and the shared programme. No service
 * key, no teacher-only table (questions, corrections, AI hypotheses).
 */
export async function loadAssistantContext(assessmentId: string | null): Promise<AssistantContextData> {
  await requireStudent();
  const [identity, assessments, progress] = await Promise.all([
    loadStudentIdentity(),
    loadStudentAssessments(),
    loadStudentProgress(),
  ]);
  const selected = assessmentId ? await loadStudentAssessmentDetail(assessmentId) : null;

  return {
    className: identity.className,
    classLevel: identity.classLevel,
    assessments: assessments.map((assessment) => ({
      id: assessment.id,
      title: assessment.title,
      subject: assessment.subject,
      date: assessment.date,
      status: assessment.status,
      score: assessment.score,
      teacherComment: assessment.teacherComment,
    })),
    selected: selected
      ? {
          id: selected.id,
          title: selected.title,
          subject: selected.subject,
          date: selected.date,
          status: selected.status,
          score: selected.score,
          teacherComment: selected.teacherComment,
          responses: selected.responses.map((response) => ({
            responseText: response.responseText,
            awardedPoints: response.awardedPoints,
            teacherAnnotation: response.teacherAnnotation,
          })),
        }
      : null,
    competencies: progress.map((item) => ({ name: item.name, subject: item.subject, level: item.level })),
    programme: await loadProgrammeTitles(identity.classLevel),
  };
}

/** Titles of the official programme notions for the student's class level. */
async function loadProgrammeTitles(classLevel: string | null): Promise<string[]> {
  const supabase = await createAuthClient();
  if (!supabase) return [];
  // Subjects visible to the student (their school's and the shared ones).
  const subjects = await supabase.from("subjects").select("code");
  if (subjects.error) return [];
  const codes = [...new Set(((subjects.data ?? []) as Array<{ code: string | null }>).map((row) => row.code).filter((code): code is string => !!code))];
  if (!codes.length) return [];
  const sources = await supabase.from("curriculum_sources").select("id,subject_code,level_code").in("subject_code", codes);
  if (sources.error) return [];
  const rows = (sources.data ?? []) as Array<{ id: string; subject_code: string; level_code: string }>;
  const sourceIds: string[] = [];
  for (const code of codes) {
    const subjectSources = rows.filter((row) => row.subject_code === code);
    if (!subjectSources.length) continue;
    const scope = resolveCurriculumScope(classLevel, subjectSources.map((row) => row.level_code));
    if (scope.resolution === "subject_fallback") continue;
    for (const row of subjectSources)
      if (!scope.levelCodes || scope.levelCodes.includes(row.level_code)) sourceIds.push(row.id);
  }
  if (!sourceIds.length) return [];
  const notions = await supabase
    .from("curriculum_nodes")
    .select("title")
    .in("source_id", sourceIds)
    .eq("active", true)
    .eq("node_type", "notion")
    .order("code")
    .limit(120);
  if (notions.error) return [];
  return ((notions.data ?? []) as Array<{ title: string }>).map((row) => row.title);
}
