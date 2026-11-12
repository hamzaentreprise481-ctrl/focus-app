import "server-only";

import { cache } from "react";
import { createAuthClient, requireStudent } from "@/lib/auth/server";

type DbError = { message?: string } | null;

function ensureOk(error: DbError, label: string) {
  if (error) throw new Error("Impossible de charger " + label + ".");
}

function numberOrNull(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export type StudentIdentity = {
  id: string;
  email: string | null;
  name: string;
  schoolName: string;
  className: string;
  classLevel: string | null;
  classIds: string[];
};

export type StudentAssessmentStatus = "graded" | "pending" | "absent";

export type StudentAssessment = {
  id: string;
  title: string;
  date: string;
  subject: string;
  score: number | null;
  status: StudentAssessmentStatus;
  teacherComment: string | null;
  important: boolean;
  resultId: string | null;
  updatedAt: string | null;
};

export type MasteryLevel =
  | "mastered"
  | "developing"
  | "fragile"
  | "not_mastered";

export type StudentCompetencyProgress = {
  competencyId: string;
  name: string;
  subject: string;
  level: MasteryLevel;
  assessmentTitle: string;
  assessmentDate: string;
};

export type StudentAssessmentDetail = StudentAssessment & {
  /** Levels the teacher entered for this assessment (explicit, never inferred). */
  competencies: Array<{ name: string; level: MasteryLevel }>;
  /** Only answers the teacher entered or confirmed (see pendingReadings). */
  responses: Array<{
    id: string;
    responseText: string;
    awardedPoints: number | null;
    teacherAnnotation: string | null;
  }>;
  /** Automatic readings of a scanned copy the teacher has not checked yet. */
  pendingReadings: number;
};

export const loadStudentIdentity = cache(async (): Promise<StudentIdentity> => {
  const student = await requireStudent();
  const supabase = await createAuthClient();
  if (!supabase) throw new Error("Supabase n’est pas configuré.");

  const [profileResponse, membershipResponse, enrollmentResponse] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("first_name,last_name")
        .eq("id", student.id)
        .maybeSingle(),
      supabase
        .from("school_memberships")
        .select("school_id")
        .eq("user_id", student.id)
        .eq("role", "student")
        .eq("status", "active")
        .limit(1)
        .maybeSingle(),
      supabase
        .from("student_enrollments")
        .select("class_id,school_id,created_at")
        .eq("student_id", student.id)
        .order("created_at", { ascending: false }),
    ]);

  ensureOk(profileResponse.error, "votre profil");
  ensureOk(membershipResponse.error, "votre établissement");
  ensureOk(enrollmentResponse.error, "votre classe");

  const profile = profileResponse.data as {
    first_name: string | null;
    last_name: string | null;
  } | null;
  const membership = membershipResponse.data as { school_id: string } | null;
  const enrollments = (enrollmentResponse.data ?? []) as Array<{
    class_id: string;
    school_id: string;
  }>;

  const classIds = [...new Set(enrollments.map((row) => row.class_id))];

  let schoolName = "Établissement";
  if (membership?.school_id) {
    const schoolResponse = await supabase
      .from("schools")
      .select("name")
      .eq("id", membership.school_id)
      .maybeSingle();
    ensureOk(schoolResponse.error, "votre établissement");
    const school = schoolResponse.data as { name: string } | null;
    if (school?.name?.trim()) schoolName = school.name.trim();
  }

  let className = "Classe non affectée";
  let classLevel: string | null = null;
  if (classIds.length) {
    const classResponse = await supabase
      .from("classes")
      .select("id,name,level")
      .in("id", classIds);
    ensureOk(classResponse.error, "votre classe");
    const classes = (classResponse.data ?? []) as Array<{
      id: string;
      name: string;
      level: string | null;
    }>;
    if (classes.length) {
      className = classes.map((row) => row.name).join(" · ");
      classLevel = classes.find((row) => row.level?.trim())?.level ?? null;
    }
  }

  const profileName = [profile?.first_name, profile?.last_name]
    .filter((value): value is string => !!value?.trim())
    .map((value) => value.trim())
    .join(" ");
  const fallbackName = student.email?.split("@")[0]?.trim() || "Élève";

  return {
    id: student.id,
    email: student.email ?? null,
    name: profileName || fallbackName,
    schoolName,
    className,
    classLevel,
    classIds,
  };
});

export const loadStudentAssessments = cache(
  async (): Promise<StudentAssessment[]> => {
    const student = await requireStudent();
    const identity = await loadStudentIdentity();
    if (!identity.classIds.length) return [];

    const supabase = await createAuthClient();
    if (!supabase) throw new Error("Supabase n’est pas configuré.");

    const today = new Date().toISOString().slice(0, 10);
    const [assessmentResponse, resultResponse] = await Promise.all([
      supabase
        .from("assessments")
        .select("id,subject_id,title,date,important")
        .in("class_id", identity.classIds)
        .lte("date", today)
        .order("date", { ascending: false })
        .limit(100),
      supabase
        .from("assessment_results")
        .select(
          "id,assessment_id,score,absent,teacher_comment,updated_at",
        )
        .eq("student_id", student.id),
    ]);

    ensureOk(assessmentResponse.error, "vos évaluations");
    ensureOk(resultResponse.error, "vos résultats");

    const assessments = (assessmentResponse.data ?? []) as Array<{
      id: string;
      subject_id: string;
      title: string;
      date: string;
      important: boolean | null;
    }>;
    const results = (resultResponse.data ?? []) as Array<{
      id: string;
      assessment_id: string;
      score: number | string | null;
      absent: boolean;
      teacher_comment: string | null;
      updated_at: string | null;
    }>;

    const subjectIds = [...new Set(assessments.map((row) => row.subject_id))];
    let subjectById = new Map<string, string>();
    if (subjectIds.length) {
      const subjectResponse = await supabase
        .from("subjects")
        .select("id,name")
        .in("id", subjectIds);
      ensureOk(subjectResponse.error, "les matières");
      const subjects = (subjectResponse.data ?? []) as Array<{
        id: string;
        name: string;
      }>;
      subjectById = new Map(subjects.map((row) => [row.id, row.name]));
    }

    const resultByAssessment = new Map(
      results.map((row) => [row.assessment_id, row]),
    );

    return assessments.map((assessment) => {
      const result = resultByAssessment.get(assessment.id);
      const score = numberOrNull(result?.score);
      const status: StudentAssessmentStatus = result?.absent
        ? "absent"
        : score !== null
          ? "graded"
          : "pending";
      return {
        id: assessment.id,
        title: assessment.title,
        date: assessment.date,
        subject: subjectById.get(assessment.subject_id) ?? "Matière",
        score,
        status,
        teacherComment: result?.teacher_comment ?? null,
        important: assessment.important === true,
        resultId: result?.id ?? null,
        updatedAt: result?.updated_at ?? null,
      };
    });
  },
);

export const loadStudentProgress = cache(
  async (): Promise<StudentCompetencyProgress[]> => {
    const assessments = await loadStudentAssessments();
    const resultIds = assessments
      .map((assessment) => assessment.resultId)
      .filter((value): value is string => !!value);
    if (!resultIds.length) return [];

    const supabase = await createAuthClient();
    if (!supabase) throw new Error("Supabase n’est pas configuré.");

    const competencyResultResponse = await supabase
      .from("competency_results")
      .select("assessment_result_id,competency_id,mastery_level")
      .in("assessment_result_id", resultIds);
    ensureOk(competencyResultResponse.error, "votre progression");

    const competencyResults = (competencyResultResponse.data ?? []) as Array<{
      assessment_result_id: string;
      competency_id: string;
      mastery_level: MasteryLevel;
    }>;
    if (!competencyResults.length) return [];

    const competencyIds = [
      ...new Set(competencyResults.map((row) => row.competency_id)),
    ];
    const competencyResponse = await supabase
      .from("competencies")
      .select("id,subject_id,name")
      .in("id", competencyIds);
    ensureOk(competencyResponse.error, "les compétences");

    const competencies = (competencyResponse.data ?? []) as Array<{
      id: string;
      subject_id: string;
      name: string;
    }>;
    const subjectIds = [...new Set(competencies.map((row) => row.subject_id))];

    let subjectById = new Map<string, string>();
    if (subjectIds.length) {
      const subjectResponse = await supabase
        .from("subjects")
        .select("id,name")
        .in("id", subjectIds);
      ensureOk(subjectResponse.error, "les matières");
      const subjects = (subjectResponse.data ?? []) as Array<{
        id: string;
        name: string;
      }>;
      subjectById = new Map(subjects.map((row) => [row.id, row.name]));
    }

    const assessmentByResult = new Map(
      assessments
        .filter((assessment) => assessment.resultId)
        .map((assessment) => [assessment.resultId as string, assessment]),
    );
    const competencyById = new Map(
      competencies.map((row) => [row.id, row]),
    );

    const latest = new Map<string, StudentCompetencyProgress>();
    for (const row of competencyResults) {
      const competency = competencyById.get(row.competency_id);
      const assessment = assessmentByResult.get(row.assessment_result_id);
      if (!competency || !assessment) continue;
      const item: StudentCompetencyProgress = {
        competencyId: competency.id,
        name: competency.name,
        subject:
          subjectById.get(competency.subject_id) ?? assessment.subject,
        level: row.mastery_level,
        assessmentTitle: assessment.title,
        assessmentDate: assessment.date,
      };
      const previous = latest.get(item.competencyId);
      if (!previous || item.assessmentDate > previous.assessmentDate)
        latest.set(item.competencyId, item);
    }

    return [...latest.values()].sort(
      (a, b) =>
        b.assessmentDate.localeCompare(a.assessmentDate) ||
        a.name.localeCompare(b.name, "fr"),
    );
  },
);

export async function loadStudentAssessmentDetail(
  assessmentId: string,
): Promise<StudentAssessmentDetail | null> {
  const student = await requireStudent();
  // A malformed id is never sent to the database: it simply does not exist.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assessmentId)) return null;
  const supabase = await createAuthClient();
  if (!supabase) throw new Error("Supabase n’est pas configuré.");

  const assessmentResponse = await supabase
    .from("assessments")
    .select("id,subject_id,title,date,important")
    .eq("id", assessmentId)
    .maybeSingle();
  ensureOk(assessmentResponse.error, "l’évaluation");

  const assessment = assessmentResponse.data as {
    id: string;
    subject_id: string;
    title: string;
    date: string;
    important: boolean | null;
  } | null;
  if (!assessment) return null;

  const today = new Date().toISOString().slice(0, 10);
  if (assessment.date > today) return null;

  const [resultResponse, responseResponse, subjectResponse] =
    await Promise.all([
      supabase
        .from("assessment_results")
        .select("id,score,absent,teacher_comment,updated_at")
        .eq("assessment_id", assessment.id)
        .eq("student_id", student.id)
        .maybeSingle(),
      // "*": the provenance columns (source, transcription_verified) exist
      // only from migration 20261009120000; naming them would fail before.
      supabase
        .from("student_responses")
        .select("*")
        .eq("assessment_id", assessment.id)
        .eq("student_id", student.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("subjects")
        .select("name")
        .eq("id", assessment.subject_id)
        .maybeSingle(),
    ]);

  ensureOk(resultResponse.error, "votre résultat");
  ensureOk(responseResponse.error, "vos réponses");
  ensureOk(subjectResponse.error, "la matière");

  const result = resultResponse.data as {
    id: string;
    score: number | string | null;
    absent: boolean;
    teacher_comment: string | null;
    updated_at: string | null;
  } | null;
  const allResponses = (responseResponse.data ?? []) as Array<{
    id: string;
    response_text: string;
    awarded_points: number | string | null;
    teacher_annotation: string | null;
    source?: string | null;
    transcription_verified?: boolean | null;
  }>;
  // An automatic reading of a scanned copy stays unvalidated until the
  // teacher confirms or corrects it: the student never sees it as their
  // answer, and the assistant never receives it.
  const unverified = (row: (typeof allResponses)[number]) =>
    row.source === "scan" && row.transcription_verified !== true;
  const responses = allResponses.filter((row) => !unverified(row));
  const subject = subjectResponse.data as { name: string } | null;

  const score = numberOrNull(result?.score);
  const status: StudentAssessmentStatus = result?.absent
    ? "absent"
    : score !== null
      ? "graded"
      : "pending";

  let competencies: StudentAssessmentDetail["competencies"] = [];
  if (result?.id) {
    const levelResponse = await supabase
      .from("competency_results")
      .select("competency_id,mastery_level")
      .eq("assessment_result_id", result.id);
    ensureOk(levelResponse.error, "vos compétences");
    const levels = (levelResponse.data ?? []) as Array<{ competency_id: string; mastery_level: MasteryLevel }>;
    if (levels.length) {
      const nameResponse = await supabase
        .from("competencies")
        .select("id,name")
        .in("id", [...new Set(levels.map((row) => row.competency_id))]);
      ensureOk(nameResponse.error, "les compétences");
      const names = new Map(((nameResponse.data ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]));
      competencies = levels
        .map((row) => ({ name: names.get(row.competency_id) ?? "Compétence", level: row.mastery_level }))
        .sort((a, b) => a.name.localeCompare(b.name, "fr"));
    }
  }

  return {
    id: assessment.id,
    title: assessment.title,
    date: assessment.date,
    subject: subject?.name ?? "Matière",
    score,
    status,
    teacherComment: result?.teacher_comment ?? null,
    important: assessment.important === true,
    resultId: result?.id ?? null,
    updatedAt: result?.updated_at ?? null,
    competencies,
    pendingReadings: allResponses.length - responses.length,
    responses: responses.map((row) => ({
      id: row.id,
      responseText: row.response_text,
      awardedPoints: numberOrNull(row.awarded_points),
      teacherAnnotation: row.teacher_annotation,
    })),
  };
}
