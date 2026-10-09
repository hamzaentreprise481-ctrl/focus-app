import "server-only";

import { cache } from "react";
import { createAuthClient, requireDirector } from "@/lib/auth/server";

type ProfileRow = { id: string; first_name: string | null; last_name: string | null };
type MembershipRow = { user_id: string; role: "admin" | "teacher" | "student" | "parent"; status: string };
type ClassRow = { id: string; name: string; level: string | null };
type SubjectRow = { id: string; name: string };
type AssignmentRow = { teacher_id: string; class_id: string; subject_id: string };
type EnrollmentRow = { student_id: string; class_id: string };
type AssessmentRow = { id: string; class_id: string; subject_id: string; teacher_id: string; title: string; date: string };
type ResultRow = { assessment_id: string; student_id: string; score: number | string | null; absent: boolean };
type LessonRow = { id: string; class_id: string; subject_id: string; teacher_id: string; date: string; summary: string };
type CompetencyRow = { id: string; subject_id: string; name: string };
type LinkRow = { lesson_id: string; competency_id: string };
type AssessmentCompetencyRow = { assessment_id: string; competency_id: string };

function ensure(error: { message?: string } | null, label: string) {
  if (error) throw new Error("Impossible de charger " + label + ".");
}

function n(value: number | string | null) {
  if (value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function average(values: Array<number | null>) {
  const usable = values.filter((value): value is number => value !== null);
  if (!usable.length) return null;
  return Math.round((usable.reduce((sum, value) => sum + value, 0) / usable.length) * 10) / 10;
}

function percent(part: number, total: number) {
  return total ? Math.round((part / total) * 100) : null;
}

export type DirectorStudentRow = {
  id: string;
  name: string;
  className: string;
  gradesCount: number;
  average: number | null;
  absences: number;
};

export type DirectorTeacherRow = {
  id: string;
  name: string;
  classes: string[];
  subjects: string[];
  assessments: number;
  lessons: number;
};

export type DirectorClassRow = {
  id: string;
  name: string;
  level: string | null;
  students: number;
  assessments: number;
  lessons: number;
  gradedResults: number;
  average: number | null;
};

export type DirectorProgrammeRow = {
  key: string;
  className: string;
  subject: string;
  teacherNames: string[];
  totalCompetencies: number;
  coveredCompetencies: number;
  assessedCompetencies: number;
  lessonCoveragePercent: number | null;
  assessmentCoveragePercent: number | null;
};

export type DirectorData = {
  directorName: string;
  schoolId: string;
  schoolName: string;
  totals: {
    students: number;
    teachers: number;
    classes: number;
    assessments: number;
    lessons: number;
  };
  students: DirectorStudentRow[];
  teachers: DirectorTeacherRow[];
  classes: DirectorClassRow[];
  programme: DirectorProgrammeRow[];
  classOptions: { id: string; name: string }[];
};

export const loadDirectorData = cache(async (): Promise<DirectorData> => {
  const director = await requireDirector();
  const supabase = await createAuthClient();
  if (!supabase) throw new Error("Supabase n’est pas configuré.");

  const membershipResponse = await supabase
    .from("school_memberships")
    .select("school_id")
    .eq("user_id", director.id)
    .eq("role", "admin")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  ensure(membershipResponse.error, "votre établissement");
  const membership = membershipResponse.data as { school_id: string } | null;
  if (!membership) throw new Error("Aucun établissement de direction actif.");

  const schoolId = membership.school_id;

  const [
    schoolResponse,
    membershipsResponse,
    classesResponse,
    subjectsResponse,
    assignmentsResponse,
    enrollmentsResponse,
    assessmentsResponse,
    lessonsResponse,
    competenciesResponse,
  ] = await Promise.all([
    supabase.from("schools").select("name").eq("id", schoolId).maybeSingle(),
    supabase
      .from("school_memberships")
      .select("user_id,role,status")
      .eq("school_id", schoolId)
      .eq("status", "active"),
    supabase.from("classes").select("id,name,level").eq("school_id", schoolId),
    supabase.from("subjects").select("id,name").eq("school_id", schoolId),
    supabase
      .from("teacher_assignments")
      .select("teacher_id,class_id,subject_id")
      .eq("school_id", schoolId),
    supabase
      .from("student_enrollments")
      .select("student_id,class_id")
      .eq("school_id", schoolId),
    supabase
      .from("assessments")
      .select("id,class_id,subject_id,teacher_id,title,date")
      .eq("school_id", schoolId),
    supabase
      .from("lessons")
      .select("id,class_id,subject_id,teacher_id,date,summary")
      .eq("school_id", schoolId),
    supabase
      .from("competencies")
      .select("id,subject_id,name")
      .eq("school_id", schoolId),
  ]);

  [
    schoolResponse,
    membershipsResponse,
    classesResponse,
    subjectsResponse,
    assignmentsResponse,
    enrollmentsResponse,
    assessmentsResponse,
    lessonsResponse,
    competenciesResponse,
  ].forEach((response) => ensure(response.error, "les données de direction"));

  const memberships = (membershipsResponse.data ?? []) as MembershipRow[];
  const classes = (classesResponse.data ?? []) as ClassRow[];
  const subjects = (subjectsResponse.data ?? []) as SubjectRow[];
  const assignments = (assignmentsResponse.data ?? []) as AssignmentRow[];
  const enrollments = (enrollmentsResponse.data ?? []) as EnrollmentRow[];
  const assessments = (assessmentsResponse.data ?? []) as AssessmentRow[];
  const lessons = (lessonsResponse.data ?? []) as LessonRow[];
  const competencies = (competenciesResponse.data ?? []) as CompetencyRow[];

  const userIds = [...new Set(memberships.map((row) => row.user_id))];
  const assessmentIds = assessments.map((row) => row.id);
  const lessonIds = lessons.map((row) => row.id);

  const [profilesResponse, resultsResponse, lessonLinksResponse, assessmentLinksResponse] =
    await Promise.all([
      userIds.length
        ? supabase.from("profiles").select("id,first_name,last_name").in("id", userIds)
        : Promise.resolve({ data: [], error: null }),
      assessmentIds.length
        ? supabase
            .from("assessment_results")
            .select("assessment_id,student_id,score,absent")
            .in("assessment_id", assessmentIds)
        : Promise.resolve({ data: [], error: null }),
      lessonIds.length
        ? supabase
            .from("lesson_competencies")
            .select("lesson_id,competency_id")
            .in("lesson_id", lessonIds)
        : Promise.resolve({ data: [], error: null }),
      assessmentIds.length
        ? supabase
            .from("assessment_competencies")
            .select("assessment_id,competency_id")
            .in("assessment_id", assessmentIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

  ensure(profilesResponse.error, "les profils");
  ensure(resultsResponse.error, "les résultats");
  ensure(lessonLinksResponse.error, "la couverture des séances");
  ensure(assessmentLinksResponse.error, "les compétences évaluées");

  const profiles = (profilesResponse.data ?? []) as ProfileRow[];
  const results = (resultsResponse.data ?? []) as ResultRow[];
  const lessonLinks = (lessonLinksResponse.data ?? []) as LinkRow[];
  const assessmentLinks = (assessmentLinksResponse.data ?? []) as AssessmentCompetencyRow[];

  const profileById = new Map(profiles.map((row) => [row.id, row]));
  const classById = new Map(classes.map((row) => [row.id, row]));
  const subjectById = new Map(subjects.map((row) => [row.id, row]));
  const assessmentById = new Map(assessments.map((row) => [row.id, row]));
  const lessonById = new Map(lessons.map((row) => [row.id, row]));
  const competencyById = new Map(competencies.map((row) => [row.id, row]));

  const displayName = (id: string, fallback: string) => {
    const profile = profileById.get(id);
    const value = [profile?.first_name, profile?.last_name]
      .filter((part): part is string => !!part?.trim())
      .map((part) => part.trim())
      .join(" ");
    return value || fallback;
  };

  const directorName = displayName(director.id, "Direction");
  const school = schoolResponse.data as { name: string } | null;

  const studentRows: DirectorStudentRow[] = enrollments.map((enrollment) => {
    const studentResults = results.filter((row) => row.student_id === enrollment.student_id);
    return {
      id: enrollment.student_id,
      name: displayName(enrollment.student_id, "Élève"),
      className: classById.get(enrollment.class_id)?.name ?? "Classe",
      gradesCount: studentResults.filter((row) => n(row.score) !== null).length,
      average: average(
        studentResults
          .filter((row) => !row.absent)
          .map((row) => n(row.score)),
      ),
      absences: studentResults.filter((row) => row.absent).length,
    };
  }).sort((a, b) => a.name.localeCompare(b.name, "fr"));

  const teacherMemberships = memberships.filter((row) => row.role === "teacher");
  const teacherRows: DirectorTeacherRow[] = teacherMemberships.map((membershipRow) => {
    const ownAssignments = assignments.filter((row) => row.teacher_id === membershipRow.user_id);
    return {
      id: membershipRow.user_id,
      name: displayName(membershipRow.user_id, "Professeur"),
      classes: [...new Set(ownAssignments.map((row) => classById.get(row.class_id)?.name).filter((v): v is string => !!v))],
      subjects: [...new Set(ownAssignments.map((row) => subjectById.get(row.subject_id)?.name).filter((v): v is string => !!v))],
      assessments: assessments.filter((row) => row.teacher_id === membershipRow.user_id).length,
      lessons: lessons.filter((row) => row.teacher_id === membershipRow.user_id).length,
    };
  }).sort((a, b) => a.name.localeCompare(b.name, "fr"));

  const classRows: DirectorClassRow[] = classes.map((classRow) => {
    const classAssessments = assessments.filter((row) => row.class_id === classRow.id);
    const ids = new Set(classAssessments.map((row) => row.id));
    const classResults = results.filter((row) => ids.has(row.assessment_id));
    return {
      id: classRow.id,
      name: classRow.name,
      level: classRow.level,
      students: enrollments.filter((row) => row.class_id === classRow.id).length,
      assessments: classAssessments.length,
      lessons: lessons.filter((row) => row.class_id === classRow.id).length,
      gradedResults: classResults.filter((row) => !row.absent && n(row.score) !== null).length,
      average: average(
        classResults
          .filter((row) => !row.absent)
          .map((row) => n(row.score)),
      ),
    };
  }).sort((a, b) => a.name.localeCompare(b.name, "fr"));

  const classSubjectKeys = new Set(
    assignments.map((row) => row.class_id + "::" + row.subject_id),
  );
  for (const assessment of assessments)
    classSubjectKeys.add(assessment.class_id + "::" + assessment.subject_id);
  for (const lesson of lessons)
    classSubjectKeys.add(lesson.class_id + "::" + lesson.subject_id);

  const programme: DirectorProgrammeRow[] = [...classSubjectKeys].map((key) => {
    const [classId, subjectId] = key.split("::");
    const subjectCompetencies = competencies.filter((row) => row.subject_id === subjectId);
    const subjectCompetencyIds = new Set(subjectCompetencies.map((row) => row.id));

    const relevantLessons = new Set(
      lessons
        .filter((row) => row.class_id === classId && row.subject_id === subjectId)
        .map((row) => row.id),
    );
    const covered = new Set(
      lessonLinks
        .filter(
          (row) =>
            relevantLessons.has(row.lesson_id) &&
            subjectCompetencyIds.has(row.competency_id),
        )
        .map((row) => row.competency_id),
    );

    const relevantAssessments = new Set(
      assessments
        .filter((row) => row.class_id === classId && row.subject_id === subjectId)
        .map((row) => row.id),
    );
    const assessed = new Set(
      assessmentLinks
        .filter(
          (row) =>
            relevantAssessments.has(row.assessment_id) &&
            subjectCompetencyIds.has(row.competency_id),
        )
        .map((row) => row.competency_id),
    );

    const teacherNames = assignments
      .filter((row) => row.class_id === classId && row.subject_id === subjectId)
      .map((row) => displayName(row.teacher_id, "Professeur"));

    return {
      key,
      className: classById.get(classId)?.name ?? "Classe",
      subject: subjectById.get(subjectId)?.name ?? "Matière",
      teacherNames: [...new Set(teacherNames)],
      totalCompetencies: subjectCompetencies.length,
      coveredCompetencies: covered.size,
      assessedCompetencies: assessed.size,
      lessonCoveragePercent: percent(covered.size, subjectCompetencies.length),
      assessmentCoveragePercent: percent(assessed.size, subjectCompetencies.length),
    };
  }).sort((a, b) => a.className.localeCompare(b.className, "fr") || a.subject.localeCompare(b.subject, "fr"));

  return {
    directorName,
    schoolId,
    schoolName: school?.name?.trim() || "Établissement",
    totals: {
      students: studentRows.length,
      teachers: teacherRows.length,
      classes: classRows.length,
      assessments: assessments.length,
      lessons: lessons.length,
    },
    students: studentRows,
    teachers: teacherRows,
    classes: classRows,
    programme,
    classOptions: classes.map((row) => ({ id: row.id, name: row.name })),
  };
});
