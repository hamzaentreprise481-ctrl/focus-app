import "server-only";

import { createAuthClient } from "@/lib/auth/server";
import type {
  ClassInfo,
  Evaluation,
  EvaluationDataset,
  RawGrade,
  SkillLevel,
  Student,
  Skill,
} from "@/lib/types";

type TeacherAssignmentRow = {
  school_id: string;
  class_id: string;
  subject_id: string;
  teacher_id: string;
};
type ClassRow = { id: string; name: string; level: string };
type SubjectRow = { id: string; name: string };
type EnrollmentRow = { student_id: string; class_id: string };
type ProfileRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
};
type CompetencyRow = { id: string; subject_id: string; name: string };
type AssessmentRow = {
  id: string;
  class_id: string;
  subject_id: string;
  teacher_id: string;
  title: string;
  date: string;
  important: boolean | null;
};
type AssessmentCompetencyRow = {
  assessment_id: string;
  competency_id: string;
};
type AssessmentResultRow = {
  id: string;
  assessment_id: string;
  student_id: string;
  score: number | string | null;
  absent: boolean;
};
type CompetencyResultRow = {
  assessment_result_id: string;
  competency_id: string;
  mastery_level: "mastered" | "developing" | "fragile" | "not_mastered";
};

export interface SupabaseSchoolData {
  dataset: EvaluationDataset;
  editableEvaluationIds: string[];
  /** From the teacher's own profile row; null when it has no name. */
  teacherName: string | null;
}

/** Display-only name from Auth metadata, used when the profile has none. */
export function teacherDisplayName(teacher: {
  user_metadata?: Record<string, unknown>;
}) {
  const value = teacher.user_metadata?.display_name;
  return typeof value === "string" && value.trim() ? value.trim() : "Professeur";
}

export const EMPTY_SUPABASE_SCHOOL_DATA: SupabaseSchoolData = {
  dataset: {
    classes: [],
    students: [],
    skills: [],
    evaluations: [],
    rawGrades: [],
  },
  editableEvaluationIds: [],
  teacherName: null,
};

const LEVEL_FROM_DB: Record<CompetencyResultRow["mastery_level"], SkillLevel> = {
  mastered: "maitrise",
  developing: "en_cours",
  fragile: "fragile",
  not_mastered: "non_maitrise",
};

function ensureOk(error: { message: string } | null, label: string) {
  if (error) throw new Error(`${label}: ${error.message}`);
}

export async function loadSupabaseSchoolData(options: {
  teacherId: string;
}): Promise<SupabaseSchoolData> {
  const supabase = await createAuthClient();
  if (!supabase) throw new Error("Supabase n’est pas configuré.");

  const profileResponse = await supabase
    .from("profiles")
    .select("first_name,last_name")
    .eq("id", options.teacherId)
    .maybeSingle();
  ensureOk(profileResponse.error, "Profil professeur");
  const profile = profileResponse.data as Omit<ProfileRow, "id"> | null;
  const teacherName =
    [profile?.first_name, profile?.last_name]
      .filter((value): value is string => !!value?.trim())
      .map((value) => value.trim())
      .join(" ") || null;

  const assignmentsResponse = await supabase
    .from("teacher_assignments")
    .select("school_id,class_id,subject_id,teacher_id")
    .eq("teacher_id", options.teacherId);
  ensureOk(assignmentsResponse.error, "Affectations professeur");
  const assignments =
    (assignmentsResponse.data ?? []) as TeacherAssignmentRow[];
  if (!assignments.length) return { ...EMPTY_SUPABASE_SCHOOL_DATA, teacherName };

  const classIds = [...new Set(assignments.map((row) => row.class_id))];
  const subjectIds = [...new Set(assignments.map((row) => row.subject_id))];

  const [
    classesResponse,
    subjectsResponse,
    enrollmentsResponse,
    competenciesResponse,
    assessmentsResponse,
  ] = await Promise.all([
    supabase.from("classes").select("id,name,level").in("id", classIds),
    supabase.from("subjects").select("id,name").in("id", subjectIds),
    supabase
      .from("student_enrollments")
      .select("student_id,class_id")
      .in("class_id", classIds),
    supabase
      .from("competencies")
      .select("id,subject_id,name")
      .in("subject_id", subjectIds),
    supabase
      .from("assessments")
      .select("id,class_id,subject_id,teacher_id,title,date,important")
      .in("class_id", classIds)
      .in("subject_id", subjectIds),
  ]);

  ensureOk(classesResponse.error, "Classes");
  ensureOk(subjectsResponse.error, "Matières");
  ensureOk(enrollmentsResponse.error, "Inscriptions élèves");
  ensureOk(competenciesResponse.error, "Compétences");
  ensureOk(assessmentsResponse.error, "Évaluations");

  const classRows = (classesResponse.data ?? []) as ClassRow[];
  const subjectRows = (subjectsResponse.data ?? []) as SubjectRow[];
  const enrollmentRows = (enrollmentsResponse.data ?? []) as EnrollmentRow[];
  const competencyRows = (competenciesResponse.data ?? []) as CompetencyRow[];
  const assessmentRows = (assessmentsResponse.data ?? []) as AssessmentRow[];

  const studentIds = [...new Set(enrollmentRows.map((row) => row.student_id))];
  const assessmentIds = assessmentRows.map((row) => row.id);

  const [profilesResponse, assessmentCompetenciesResponse, resultsResponse] =
    await Promise.all([
      studentIds.length
        ? supabase
            .from("profiles")
            .select("id,first_name,last_name")
            .in("id", studentIds)
        : Promise.resolve({ data: [], error: null }),
      assessmentIds.length
        ? supabase
            .from("assessment_competencies")
            .select("assessment_id,competency_id")
            .in("assessment_id", assessmentIds)
        : Promise.resolve({ data: [], error: null }),
      assessmentIds.length
        ? supabase
            .from("assessment_results")
            .select("id,assessment_id,student_id,score,absent")
            .in("assessment_id", assessmentIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

  ensureOk(profilesResponse.error, "Profils élèves");
  ensureOk(assessmentCompetenciesResponse.error, "Compétences des évaluations");
  ensureOk(resultsResponse.error, "Résultats");

  const profileRows = (profilesResponse.data ?? []) as ProfileRow[];
  const assessmentCompetencyRows =
    (assessmentCompetenciesResponse.data ?? []) as AssessmentCompetencyRow[];
  const resultRows = (resultsResponse.data ?? []) as AssessmentResultRow[];
  const resultIds = resultRows.map((row) => row.id);

  const competencyResultsResponse = resultIds.length
    ? await supabase
        .from("competency_results")
        .select("assessment_result_id,competency_id,mastery_level")
        .in("assessment_result_id", resultIds)
    : { data: [], error: null };
  ensureOk(competencyResultsResponse.error, "Résultats par compétence");
  const competencyResultRows =
    (competencyResultsResponse.data ?? []) as CompetencyResultRow[];

  const classById = new Map(classRows.map((row) => [row.id, row]));
  const subjectById = new Map(subjectRows.map((row) => [row.id, row]));
  const profileById = new Map(profileRows.map((row) => [row.id, row]));
  const enrollmentByClass = new Map<string, string[]>();
  for (const row of enrollmentRows) {
    const ids = enrollmentByClass.get(row.class_id) ?? [];
    ids.push(row.student_id);
    enrollmentByClass.set(row.class_id, ids);
  }

  const primaryAssignmentByClass = new Map<string, TeacherAssignmentRow>();
  for (const assignment of assignments) {
    if (!primaryAssignmentByClass.has(assignment.class_id))
      primaryAssignmentByClass.set(assignment.class_id, assignment);
  }

  const classes: ClassInfo[] = classIds.flatMap((classId) => {
    const row = classById.get(classId);
    const assignment = primaryAssignmentByClass.get(classId);
    if (!row || !assignment) return [];
    return [
      {
        id: row.id,
        name: row.name,
        level: row.level,
        subject: subjectById.get(assignment.subject_id)?.name ?? "Matière",
        subjectId: assignment.subject_id,
        schoolId: assignment.school_id,
        teacher: teacherName ?? "",
        studentIds: enrollmentByClass.get(row.id) ?? [],
      },
    ];
  });

  const students: Student[] = enrollmentRows.map((enrollment) => {
    const profile = profileById.get(enrollment.student_id);
    const name =
      [profile?.first_name, profile?.last_name]
        .filter((value): value is string => !!value?.trim())
        .join(" ") || "Élève";
    return {
      id: enrollment.student_id,
      name,
      classId: enrollment.class_id,
    };
  });

  const skills: Skill[] = competencyRows.map((row) => ({
    id: row.id,
    name: row.name,
  }));

  const skillIdsByAssessment = new Map<string, string[]>();
  for (const row of assessmentCompetencyRows) {
    const ids = skillIdsByAssessment.get(row.assessment_id) ?? [];
    ids.push(row.competency_id);
    skillIdsByAssessment.set(row.assessment_id, ids);
  }

  const evaluations: Evaluation[] = assessmentRows.map((row) => ({
    id: row.id,
    name: row.title,
    date: row.date,
    classId: row.class_id,
    skillIds: skillIdsByAssessment.get(row.id) ?? [],
    important: row.important === true,
  }));

  const levelsByResult = new Map<
    string,
    Partial<Record<string, SkillLevel>>
  >();
  for (const row of competencyResultRows) {
    const levels = levelsByResult.get(row.assessment_result_id) ?? {};
    levels[row.competency_id] = LEVEL_FROM_DB[row.mastery_level];
    levelsByResult.set(row.assessment_result_id, levels);
  }

  const rawGrades: RawGrade[] = resultRows.map((row) => ({
    studentId: row.student_id,
    evaluationId: row.assessment_id,
    score: row.score === null ? null : Number(row.score),
    absent: row.absent,
    skillLevels: levelsByResult.get(row.id),
  }));

  return {
    dataset: { classes, students, skills, evaluations, rawGrades },
    editableEvaluationIds: assessmentRows
      .filter((row) => row.teacher_id === options.teacherId)
      .map((row) => row.id),
    teacherName,
  };
}
