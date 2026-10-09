import "server-only";

import { cache } from "react";
import { createAuthClient, requireDirector } from "@/lib/auth/server";
import { resolveCurriculumScope } from "@/lib/curriculum/graph";
import { ensureOk } from "@/lib/supabase-errors";
import { selectAll, selectAllIn } from "@/lib/supabase-pages";
import {
  daysBetween,
  percent,
  programmePace,
  type PaceResult,
} from "@/lib/director/metrics";

// FOCUS Direction reads its school with the director's own session: RLS
// (is_school_admin) is the boundary, and every query is also filtered by the
// school id so nothing of another school is even requested. Only aggregates
// leave this module — no student name, no individual grade, no ranking.

type Membership = { user_id: string; role: "admin" | "teacher" | "student" | "parent" };
type ClassRow = { id: string; name: string; level: string | null; academic_year_id: string };
type SubjectRow = { id: string; name: string; code: string | null };
type Assignment = { teacher_id: string; class_id: string; subject_id: string };
type Enrollment = { student_id: string; class_id: string };
type Assessment = { id: string; class_id: string; subject_id: string; teacher_id: string; title: string; date: string };
type Lesson = { id: string; class_id: string; subject_id: string; teacher_id: string; date: string };
type Competency = { id: string; subject_id: string; name: string };
type ResultRow = { id: string; assessment_id: string; score: number | string | null; absent: boolean };
type CompetencyResult = { assessment_result_id: string; competency_id: string; mastery_level: MasteryLevel };
type Source = { id: string; subject_code: string; level_code: string };
type NodeRow = { id: string; source_id: string };

export type MasteryLevel = "mastered" | "developing" | "fragile" | "not_mastered";

export interface ProgrammeRow {
  key: string;
  classId: string;
  className: string;
  classLevel: string | null;
  subjectId: string;
  subjectName: string;
  teacherNames: string[];
  /** The school's référentiel (competencies of the subject). */
  referential: { total: number; taught: number; evaluated: number };
  /** The official programme imported in FOCUS, when one matches. */
  official: { available: boolean; total: number; evaluated: number };
  /** Explicit competency levels entered against those expected. */
  documented: { expected: number; entered: number };
  lessons: number;
  assessments: number;
  pastAssessments: number;
  /** Pace of the DECLARED programme (référentiel units). */
  pace: PaceResult;
}

export interface AssessmentSummary {
  id: string;
  title: string;
  date: string;
  className: string;
  subjectName: string;
  classId: string;
  /** Students with a result entered, against the class's enrolment. */
  entered: number;
  enrolled: number;
  linkedToProgramme: boolean;
}

export interface ClassSummary {
  id: string;
  name: string;
  level: string | null;
  enrolled: number;
  teacherNames: string[];
  subjectNames: string[];
  rows: ProgrammeRow[];
  competenciesEvaluated: number;
  alerts: DirectorAlert[];
}

export interface CompetencyDistribution {
  competencyId: string;
  name: string;
  subjectName: string;
  counts: Record<MasteryLevel, number>;
}

export interface TeacherSummary {
  id: string;
  name: string;
  classNames: string[];
  subjectNames: string[];
  assessments: number;
  documentedAssessments: number;
  lessons: number;
  rows: ProgrammeRow[];
  missing: { assessmentsWithoutResults: number; assessmentsUnlinked: number; rowsWithoutLessons: number };
}

export type AlertKind =
  | "at_risk"
  | "watch"
  | "no_lessons"
  | "no_results"
  | "unlinked_assessment"
  | "no_teacher"
  | "no_assessment";

export interface DirectorAlert {
  kind: AlertKind;
  /** "risk" for programme pace, "data" for missing or incomplete data. */
  family: "risk" | "data";
  title: string;
  detail: string;
  classId: string | null;
  href: string;
}

export interface DirectorWorkspace {
  directorName: string;
  school: { id: string; name: string };
  /** Other schools where this account is also direction (not shown). */
  otherSchools: number;
  year: { name: string; startsAt: string; endsAt: string } | null;
  today: string;
  totals: { students: number; teachers: number; classes: number; assessments: number; lessons: number };
  rows: ProgrammeRow[];
  classes: ClassSummary[];
  teachers: TeacherSummary[];
  recentAssessments: AssessmentSummary[];
  /** Every assessment dated today or earlier, newest first. */
  pastAssessments: AssessmentSummary[];
  alerts: DirectorAlert[];
  /** School-wide sums over rows (each class × subject counts once). */
  overall: {
    referential: { total: number; taught: number; evaluated: number };
    official: { total: number; evaluated: number };
    documented: { expected: number; entered: number };
  };
}

/** Today's date in France (the school's calendar), as YYYY-MM-DD. */
export function todayInFrance(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(now);
}

function fullName(profile: { first_name: string | null; last_name: string | null } | undefined, fallback: string) {
  const value = [profile?.first_name, profile?.last_name]
    .filter((part): part is string => !!part?.trim())
    .map((part) => part.trim())
    .join(" ");
  return value || fallback;
}

const collator = new Intl.Collator("fr");

/** A result counts as entered when it holds a score, an absence or a level. */
function enteredResults(results: ResultRow[], withLevels: Set<string>) {
  return results.filter((row) => row.absent || (row.score !== null && row.score !== "") || withLevels.has(row.id));
}

export const loadDirectorWorkspace = cache(async (): Promise<DirectorWorkspace> => {
  const director = await requireDirector();
  const supabase = await createAuthClient();
  if (!supabase) throw new Error("Supabase n’est pas configuré.");

  const ownMemberships = await supabase
    .from("school_memberships")
    .select("school_id,created_at")
    .eq("user_id", director.id)
    .eq("role", "admin")
    .eq("status", "active")
    .order("created_at", { ascending: true });
  ensureOk(ownMemberships.error, "Votre établissement");
  const adminSchools = (ownMemberships.data ?? []) as Array<{ school_id: string }>;
  if (!adminSchools.length) throw new Error("Aucun établissement de direction actif.");
  const schoolId = adminSchools[0].school_id;
  const today = todayInFrance();

  const [school, years, memberships, classes, subjects, assignments, enrollments, assessments, lessons, competencies, sources, ownProfile] =
    await Promise.all([
      supabase.from("schools").select("id,name").eq("id", schoolId).maybeSingle(),
      supabase
        .from("academic_years")
        .select("name,starts_at,ends_at,active")
        .eq("school_id", schoolId)
        .order("starts_at", { ascending: false }),
      selectAll<Membership>("Les membres de l’établissement", (from, to) =>
        supabase.from("school_memberships").select("user_id,role", { count: "exact" })
          .eq("school_id", schoolId).eq("status", "active").order("id").range(from, to)),
      selectAll<ClassRow>("Les classes", (from, to) =>
        supabase.from("classes").select("id,name,level,academic_year_id", { count: "exact" })
          .eq("school_id", schoolId).order("id").range(from, to)),
      selectAll<SubjectRow>("Les matières", (from, to) =>
        supabase.from("subjects").select("id,name,code", { count: "exact" })
          .or(`school_id.eq.${schoolId},school_id.is.null`).order("id").range(from, to)),
      selectAll<Assignment>("Les affectations", (from, to) =>
        supabase.from("teacher_assignments").select("teacher_id,class_id,subject_id", { count: "exact" })
          .eq("school_id", schoolId).order("id").range(from, to)),
      selectAll<Enrollment>("Les inscriptions", (from, to) =>
        supabase.from("student_enrollments").select("student_id,class_id", { count: "exact" })
          .eq("school_id", schoolId).order("id").range(from, to)),
      selectAll<Assessment>("Les évaluations", (from, to) =>
        supabase.from("assessments").select("id,class_id,subject_id,teacher_id,title,date", { count: "exact" })
          .eq("school_id", schoolId).order("id").range(from, to)),
      selectAll<Lesson>("Les séances", (from, to) =>
        supabase.from("lessons").select("id,class_id,subject_id,teacher_id,date", { count: "exact" })
          .eq("school_id", schoolId).order("id").range(from, to)),
      selectAll<Competency>("Le référentiel de compétences", (from, to) =>
        supabase.from("competencies").select("id,subject_id,name", { count: "exact" })
          .or(`school_id.eq.${schoolId},school_id.is.null`).order("id").range(from, to)),
      selectAll<Source>("Les programmes officiels", (from, to) =>
        supabase.from("curriculum_sources").select("id,subject_code,level_code", { count: "exact" })
          .order("id").range(from, to)),
      supabase.from("profiles").select("first_name,last_name").eq("id", director.id).maybeSingle(),
    ]);
  ensureOk(school.error, "Votre établissement");
  ensureOk(years.error, "L’année scolaire");
  ensureOk(ownProfile.error, "Votre profil");
  if (!school.data) throw new Error("Établissement introuvable.");

  const assessmentIds = assessments.map((row) => row.id);
  const lessonIds = lessons.map((row) => row.id);
  const subjectCodes = new Set(subjects.map((row) => row.code).filter((code): code is string => !!code));
  const relevantSources = sources.filter((source) => subjectCodes.has(source.subject_code));
  const teacherIds = [...new Set(memberships.filter((row) => row.role === "teacher").map((row) => row.user_id))];

  const [results, assessmentLinks, lessonLinks, questions, notions, profiles] = await Promise.all([
    selectAllIn<ResultRow>("Les résultats", assessmentIds, (chunk, from, to) =>
      supabase.from("assessment_results").select("id,assessment_id,score,absent", { count: "exact" })
        .in("assessment_id", chunk).order("id").range(from, to)),
    selectAllIn<{ assessment_id: string; competency_id: string }>("Les compétences évaluées", assessmentIds, (chunk, from, to) =>
      supabase.from("assessment_competencies").select("assessment_id,competency_id", { count: "exact" })
        .in("assessment_id", chunk).order("assessment_id").order("competency_id").range(from, to)),
    selectAllIn<{ lesson_id: string; competency_id: string }>("Les séances déclarées", lessonIds, (chunk, from, to) =>
      supabase.from("lesson_competencies").select("lesson_id,competency_id", { count: "exact" })
        .in("lesson_id", chunk).order("lesson_id").order("competency_id").range(from, to)),
    selectAllIn<{ id: string; assessment_id: string }>("Les questions", assessmentIds, (chunk, from, to) =>
      supabase.from("assessment_questions").select("id,assessment_id", { count: "exact" })
        .in("assessment_id", chunk).order("id").range(from, to)),
    selectAllIn<NodeRow>("Les notions du programme", relevantSources.map((source) => source.id), (chunk, from, to) =>
      supabase.from("curriculum_nodes").select("id,source_id", { count: "exact" })
        .in("source_id", chunk).eq("active", true).eq("node_type", "notion").order("id").range(from, to)),
    selectAllIn<{ id: string; first_name: string | null; last_name: string | null }>("Les enseignants", teacherIds, (chunk, from, to) =>
      supabase.from("profiles").select("id,first_name,last_name", { count: "exact" })
        .in("id", chunk).order("id").range(from, to)),
  ]);

  const resultIds = results.map((row) => row.id);
  const questionIds = questions.map((row) => row.id);
  const [competencyResults, questionNotions] = await Promise.all([
    selectAllIn<CompetencyResult>("Les niveaux de compétence", resultIds, (chunk, from, to) =>
      supabase.from("competency_results").select("assessment_result_id,competency_id,mastery_level", { count: "exact" })
        .in("assessment_result_id", chunk).order("id").range(from, to)),
    selectAllIn<{ question_id: string; curriculum_node_id: string }>("Les notions évaluées", questionIds, (chunk, from, to) =>
      supabase.from("question_curriculum_nodes").select("question_id,curriculum_node_id", { count: "exact" })
        .in("question_id", chunk).order("question_id").order("curriculum_node_id").range(from, to)),
  ]);

  // --- Indexes -----------------------------------------------------------
  const yearRows = (years.data ?? []) as Array<{ name: string; starts_at: string; ends_at: string; active: boolean }>;
  const activeYear = yearRows.find((row) => row.active) ?? yearRows[0] ?? null;
  const year = activeYear ? { name: activeYear.name, startsAt: activeYear.starts_at, endsAt: activeYear.ends_at } : null;

  const classById = new Map(classes.map((row) => [row.id, row]));
  const subjectById = new Map(subjects.map((row) => [row.id, row]));
  const profileById = new Map(profiles.map((row) => [row.id, row]));
  const teacherName = (id: string) => fullName(profileById.get(id), "Enseignant");
  const enrolledByClass = new Map<string, number>();
  for (const row of enrollments) enrolledByClass.set(row.class_id, (enrolledByClass.get(row.class_id) ?? 0) + 1);

  const competenciesBySubject = new Map<string, Set<string>>();
  for (const row of competencies) {
    const set = competenciesBySubject.get(row.subject_id) ?? new Set<string>();
    set.add(row.id);
    competenciesBySubject.set(row.subject_id, set);
  }
  const linksByAssessment = new Map<string, Set<string>>();
  for (const row of assessmentLinks) {
    const set = linksByAssessment.get(row.assessment_id) ?? new Set<string>();
    set.add(row.competency_id);
    linksByAssessment.set(row.assessment_id, set);
  }
  const linksByLesson = new Map<string, Set<string>>();
  for (const row of lessonLinks) {
    const set = linksByLesson.get(row.lesson_id) ?? new Set<string>();
    set.add(row.competency_id);
    linksByLesson.set(row.lesson_id, set);
  }
  const resultsByAssessment = new Map<string, ResultRow[]>();
  for (const row of results) resultsByAssessment.set(row.assessment_id, [...(resultsByAssessment.get(row.assessment_id) ?? []), row]);
  const levelsByResult = new Map<string, CompetencyResult[]>();
  for (const row of competencyResults) levelsByResult.set(row.assessment_result_id, [...(levelsByResult.get(row.assessment_result_id) ?? []), row]);
  const resultsWithLevels = new Set(levelsByResult.keys());
  const assessmentByQuestion = new Map(questions.map((row) => [row.id, row.assessment_id]));
  const notionsByAssessment = new Map<string, Set<string>>();
  for (const row of questionNotions) {
    const assessmentId = assessmentByQuestion.get(row.question_id);
    if (!assessmentId) continue;
    const set = notionsByAssessment.get(assessmentId) ?? new Set<string>();
    set.add(row.curriculum_node_id);
    notionsByAssessment.set(assessmentId, set);
  }
  const notionsBySource = new Map<string, Set<string>>();
  for (const row of notions) {
    const set = notionsBySource.get(row.source_id) ?? new Set<string>();
    set.add(row.id);
    notionsBySource.set(row.source_id, set);
  }

  /** In-scope notions of the official programme for a class level and subject. */
  const officialScope = (classLevel: string | null, subject: SubjectRow | undefined) => {
    if (!subject?.code) return null;
    const subjectSources = relevantSources.filter((source) => source.subject_code === subject.code);
    if (!subjectSources.length) return null;
    const scope = resolveCurriculumScope(classLevel, subjectSources.map((source) => source.level_code));
    // A class whose level matches no imported programme gets no official
    // measure (rather than every level of the subject).
    if (scope.resolution === "subject_fallback") return null;
    const scoped = scope.levelCodes ? subjectSources.filter((source) => scope.levelCodes!.includes(source.level_code)) : subjectSources;
    const ids = new Set<string>();
    for (const source of scoped) for (const id of notionsBySource.get(source.id) ?? []) ids.add(id);
    return ids.size ? ids : null;
  };

  // --- Class × subject rows ------------------------------------------------
  const pairs = new Map<string, { classId: string; subjectId: string }>();
  const pairKey = (classId: string, subjectId: string) => `${classId}::${subjectId}`;
  for (const row of [...assignments, ...assessments, ...lessons])
    if (classById.has(row.class_id)) pairs.set(pairKey(row.class_id, row.subject_id), { classId: row.class_id, subjectId: row.subject_id });

  const rows: ProgrammeRow[] = [...pairs.entries()].map(([key, { classId, subjectId }]) => {
    const classRow = classById.get(classId)!;
    const subject = subjectById.get(subjectId);
    const referentialIds = competenciesBySubject.get(subjectId) ?? new Set<string>();
    const pairLessons = lessons.filter((row) => row.class_id === classId && row.subject_id === subjectId);
    const pairAssessments = assessments.filter((row) => row.class_id === classId && row.subject_id === subjectId);
    const past = pairAssessments.filter((row) => row.date <= today);

    const taught = new Set<string>();
    for (const lesson of pairLessons)
      for (const id of linksByLesson.get(lesson.id) ?? []) if (referentialIds.has(id)) taught.add(id);
    const evaluated = new Set<string>();
    for (const assessment of past)
      for (const id of linksByAssessment.get(assessment.id) ?? []) if (referentialIds.has(id)) evaluated.add(id);

    const scope = officialScope(classRow.level, subject);
    const officialEvaluated = new Set<string>();
    if (scope)
      for (const assessment of past)
        for (const id of notionsByAssessment.get(assessment.id) ?? []) if (scope.has(id)) officialEvaluated.add(id);

    let expected = 0;
    let entered = 0;
    for (const assessment of past) {
      const linked = linksByAssessment.get(assessment.id) ?? new Set<string>();
      for (const result of resultsByAssessment.get(assessment.id) ?? []) {
        if (result.absent) continue;
        expected += linked.size;
        entered += (levelsByResult.get(result.id) ?? []).filter((level) => linked.has(level.competency_id)).length;
      }
    }

    const teacherNames = [...new Set(assignments
      .filter((row) => row.class_id === classId && row.subject_id === subjectId)
      .map((row) => teacherName(row.teacher_id)))].sort(collator.compare);

    return {
      key,
      classId,
      className: classRow.name,
      classLevel: classRow.level,
      subjectId,
      subjectName: subject?.name ?? "Matière",
      teacherNames,
      referential: { total: referentialIds.size, taught: taught.size, evaluated: evaluated.size },
      official: { available: !!scope, total: scope?.size ?? 0, evaluated: officialEvaluated.size },
      documented: { expected, entered },
      lessons: pairLessons.length,
      assessments: pairAssessments.length,
      pastAssessments: past.length,
      pace: year
        ? programmePace({ covered: taught.size, total: referentialIds.size, yearStart: year.startsAt, yearEnd: year.endsAt, today })
        : programmePace({ covered: 0, total: 0, yearStart: today, yearEnd: today, today }),
    };
  }).sort((a, b) => collator.compare(a.className, b.className) || collator.compare(a.subjectName, b.subjectName));

  // --- Assessments ----------------------------------------------------------
  const summarize = (assessment: Assessment): AssessmentSummary => ({
    id: assessment.id,
    title: assessment.title,
    date: assessment.date,
    classId: assessment.class_id,
    className: classById.get(assessment.class_id)?.name ?? "Classe",
    subjectName: subjectById.get(assessment.subject_id)?.name ?? "Matière",
    entered: new Set(enteredResults(resultsByAssessment.get(assessment.id) ?? [], resultsWithLevels).map((row) => row.id)).size,
    enrolled: enrolledByClass.get(assessment.class_id) ?? 0,
    linkedToProgramme: (linksByAssessment.get(assessment.id)?.size ?? 0) > 0 || (notionsByAssessment.get(assessment.id)?.size ?? 0) > 0,
  });
  const pastAssessments = assessments.filter((row) => row.date <= today).map(summarize);
  pastAssessments.sort((a, b) => b.date.localeCompare(a.date) || collator.compare(a.title, b.title));
  const recentAssessments = pastAssessments.slice(0, 6);

  // --- Alerts (deterministic, data first) ------------------------------------
  const alerts: DirectorAlert[] = [];
  const elapsedDays = year ? daysBetween(year.startsAt, today) : 0;
  for (const row of rows) {
    const label = `${row.className} · ${row.subjectName}`;
    const href = `/director/classes/${row.classId}`;
    if (row.pace.status === "at_risk" || row.pace.status === "watch")
      alerts.push({
        kind: row.pace.status,
        family: "risk",
        title: `${label} : ${row.pace.status === "at_risk" ? "risque de retard" : "vigilance"} sur le programme déclaré`,
        detail: `${row.pace.covered} / ${row.pace.total} compétences du référentiel déclarées traitées ; rythme observé ${row.pace.observedPerWeek ?? 0} par semaine, rythme nécessaire ${row.pace.neededPerWeek ?? "—"} par semaine${row.pace.ratioPercent !== null ? ` (${row.pace.ratioPercent} %)` : ""}.`,
        classId: row.classId,
        href,
      });
    if (row.lessons === 0 && row.referential.total > 0)
      alerts.push({
        kind: "no_lessons",
        family: "data",
        title: `${label} : aucune séance déclarée`,
        detail: "Le programme enseigné ne peut pas être suivi tant qu’aucune séance n’est déclarée dans FOCUS Teacher.",
        classId: row.classId,
        href,
      });
    if (row.assessments === 0 && elapsedDays >= 42)
      alerts.push({
        kind: "no_assessment",
        family: "data",
        title: `${label} : aucune évaluation enregistrée`,
        detail: "Aucune évaluation n’est enregistrée dans FOCUS pour cette classe et cette matière depuis la rentrée.",
        classId: row.classId,
        href,
      });
  }
  for (const assessment of pastAssessments) {
    const href = `/director/classes/${assessment.classId}`;
    if (assessment.entered === 0 && daysBetween(assessment.date, today) >= 7)
      alerts.push({
        kind: "no_results",
        family: "data",
        title: `${assessment.title} (${assessment.className}) : aucun résultat saisi`,
        detail: `Évaluation du ${assessment.date} en ${assessment.subjectName} : aucun résultat n’est saisi après 7 jours.`,
        classId: assessment.classId,
        href,
      });
    if (!assessment.linkedToProgramme)
      alerts.push({
        kind: "unlinked_assessment",
        family: "data",
        title: `${assessment.title} (${assessment.className}) : non reliée au programme`,
        detail: "Ni compétence ni notion du programme n’y est associée : elle ne compte pas dans le programme évalué.",
        classId: assessment.classId,
        href,
      });
  }
  for (const classRow of classes)
    if (!assignments.some((row) => row.class_id === classRow.id))
      alerts.push({
        kind: "no_teacher",
        family: "data",
        title: `${classRow.name} : aucun enseignant affecté`,
        detail: "Aucune affectation professeur n’est enregistrée pour cette classe.",
        classId: classRow.id,
        href: `/director/classes/${classRow.id}`,
      });
  const alertOrder: AlertKind[] = ["at_risk", "watch", "no_teacher", "no_results", "no_lessons", "no_assessment", "unlinked_assessment"];
  alerts.sort((a, b) => alertOrder.indexOf(a.kind) - alertOrder.indexOf(b.kind) || collator.compare(a.title, b.title));

  // --- Classes ---------------------------------------------------------------
  const classSummaries: ClassSummary[] = classes.map((classRow) => {
    const classRows = rows.filter((row) => row.classId === classRow.id);
    const classResultIds = new Set(
      assessments.filter((row) => row.class_id === classRow.id).flatMap((row) => (resultsByAssessment.get(row.id) ?? []).map((result) => result.id)),
    );
    const evaluatedCompetencies = new Set(competencyResults.filter((row) => classResultIds.has(row.assessment_result_id)).map((row) => row.competency_id));
    return {
      id: classRow.id,
      name: classRow.name,
      level: classRow.level,
      enrolled: enrolledByClass.get(classRow.id) ?? 0,
      teacherNames: [...new Set(assignments.filter((row) => row.class_id === classRow.id).map((row) => teacherName(row.teacher_id)))].sort(collator.compare),
      subjectNames: [...new Set(classRows.map((row) => row.subjectName))].sort(collator.compare),
      rows: classRows,
      competenciesEvaluated: evaluatedCompetencies.size,
      alerts: alerts.filter((alert) => alert.classId === classRow.id),
    };
  }).sort((a, b) => collator.compare(a.name, b.name));

  // --- Teachers (operational indicators only, never ranked) -----------------
  const teacherSummaries: TeacherSummary[] = teacherIds.map((id) => {
    const own = assignments.filter((row) => row.teacher_id === id);
    const ownKeys = new Set(own.map((row) => pairKey(row.class_id, row.subject_id)));
    const ownAssessments = assessments.filter((row) => row.teacher_id === id);
    const ownPast = ownAssessments.filter((row) => row.date <= today).map(summarize);
    const ownRows = rows.filter((row) => ownKeys.has(row.key));
    return {
      id,
      name: teacherName(id),
      classNames: [...new Set(own.map((row) => classById.get(row.class_id)?.name).filter((name): name is string => !!name))].sort(collator.compare),
      subjectNames: [...new Set(own.map((row) => subjectById.get(row.subject_id)?.name).filter((name): name is string => !!name))].sort(collator.compare),
      assessments: ownAssessments.length,
      documentedAssessments: ownPast.filter((row) => row.entered > 0).length,
      lessons: lessons.filter((row) => row.teacher_id === id).length,
      rows: ownRows,
      missing: {
        assessmentsWithoutResults: ownPast.filter((row) => row.entered === 0).length,
        assessmentsUnlinked: ownPast.filter((row) => !row.linkedToProgramme).length,
        rowsWithoutLessons: ownRows.filter((row) => row.lessons === 0).length,
      },
    };
  }).sort((a, b) => collator.compare(a.name, b.name));

  const sum = (pick: (row: ProgrammeRow) => number) => rows.reduce((total, row) => total + pick(row), 0);
  return {
    directorName: fullName(ownProfile.data ?? undefined, director.email?.split("@")[0] || "Direction"),
    school: { id: schoolId, name: (school.data as { name: string }).name.trim() || "Établissement" },
    otherSchools: adminSchools.length - 1,
    year,
    today,
    totals: {
      students: new Set(memberships.filter((row) => row.role === "student").map((row) => row.user_id)).size,
      teachers: teacherIds.length,
      classes: classes.length,
      assessments: assessments.length,
      lessons: lessons.length,
    },
    rows,
    classes: classSummaries,
    teachers: teacherSummaries,
    recentAssessments,
    pastAssessments,
    alerts,
    overall: {
      referential: { total: sum((row) => row.referential.total), taught: sum((row) => row.referential.taught), evaluated: sum((row) => row.referential.evaluated) },
      official: { total: sum((row) => (row.official.available ? row.official.total : 0)), evaluated: sum((row) => row.official.evaluated) },
      documented: { expected: sum((row) => row.documented.expected), entered: sum((row) => row.documented.entered) },
    },
  };
});

/** Aggregated competency levels of one class: counts of observations, no names. */
export async function loadClassCompetencyDistribution(classId: string): Promise<CompetencyDistribution[] | null> {
  const workspace = await loadDirectorWorkspace();
  if (!workspace.classes.some((row) => row.id === classId)) return null;
  const supabase = await createAuthClient();
  if (!supabase) throw new Error("Supabase n’est pas configuré.");
  const classAssessments = await selectAll<{ id: string }>("Les évaluations de la classe", (from, to) =>
    supabase.from("assessments").select("id", { count: "exact" })
      .eq("school_id", workspace.school.id).eq("class_id", classId).lte("date", workspace.today).order("id").range(from, to));
  const results = await selectAllIn<{ id: string }>("Les résultats", classAssessments.map((row) => row.id), (chunk, from, to) =>
    supabase.from("assessment_results").select("id", { count: "exact" }).in("assessment_id", chunk).order("id").range(from, to));
  const levels = await selectAllIn<CompetencyResult>("Les niveaux de compétence", results.map((row) => row.id), (chunk, from, to) =>
    supabase.from("competency_results").select("assessment_result_id,competency_id,mastery_level", { count: "exact" })
      .in("assessment_result_id", chunk).order("id").range(from, to));
  const competencyIds = [...new Set(levels.map((row) => row.competency_id))];
  const competencies = await selectAllIn<Competency>("Les compétences", competencyIds, (chunk, from, to) =>
    supabase.from("competencies").select("id,subject_id,name", { count: "exact" }).in("id", chunk).order("id").range(from, to));
  const subjectNames = new Map(workspace.rows.map((row) => [row.subjectId, row.subjectName]));
  const byCompetency = new Map<string, CompetencyDistribution>();
  for (const competency of competencies)
    byCompetency.set(competency.id, {
      competencyId: competency.id,
      name: competency.name,
      subjectName: subjectNames.get(competency.subject_id) ?? "Matière",
      counts: { mastered: 0, developing: 0, fragile: 0, not_mastered: 0 },
    });
  for (const level of levels) {
    const entry = byCompetency.get(level.competency_id);
    if (entry) entry.counts[level.mastery_level] += 1;
  }
  return [...byCompetency.values()].sort((a, b) => collator.compare(a.subjectName, b.subjectName) || collator.compare(a.name, b.name));
}

export { percent };
