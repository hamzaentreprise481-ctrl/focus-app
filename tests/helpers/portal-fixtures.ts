// Fictitious people and records for the Student and Direction spaces on the
// local stack (tests and manual QA only). Everything here is invented and
// marked as such; nothing comes from a real school.
//
// - Student A (Lucas Bernard) and student B (Emma Leroy) of the seeded
//   Seconde 3 get a login, a teacher comment, a recorded answer with a
//   teacher annotation and explicit competency levels.
// - Direction A administers the seeded school.
// - A second school B (its own direction, teacher, class, student, results)
//   exists only to prove that nothing of it ever reaches A's spaces.

import type { PGlite } from "@electric-sql/pglite";
import type { LocalAccount } from "./local-supabase";

type Ids = { school: string; year: string; classId: string; subject: string; studentIds: Map<string, string>; competencyIds: Map<string, string>; assessmentIds: Map<string, string> };

/** Deterministic labels → UUIDs; same layout as fixtureUuid in local-stack. */
type Uuid = (label: string) => string;

export function portalPeople(uuid: Uuid, studentIds: Map<string, string>) {
  return {
    studentA: { email: "lucas.bernard@eleve.example.test", password: "local-student-a-password", id: studentIds.get("lucas-bernard")!, name: "Lucas Bernard" },
    studentB: { email: "emma.leroy@eleve.example.test", password: "local-student-b-password", id: studentIds.get("emma-leroy")!, name: "Emma Leroy" },
    directorA: { email: "direction@lycee-jean-moulin.example.test", password: "local-director-a-password", id: uuid("director:a"), name: "Nadia Roche" },
    directorB: { email: "direction@college-b.example.test", password: "local-director-b-password", id: uuid("director:b"), name: "Bruno Vasseur" },
    teacherB: { id: uuid("teacher:b"), name: "Hélène Garnier" },
    studentC: { id: uuid("student:c"), name: "Inès Morel" },
  };
}

export type PortalPeople = ReturnType<typeof portalPeople>;

/** Marker texts that must never appear outside their owner's space. */
export const PORTAL_MARKERS = {
  commentA: "Bonne méthode, revois la double distributivité (commentaire fictif pour Lucas).",
  commentB: "Excellent travail sur les fractions (commentaire fictif pour Emma).",
  answerA: "(x + 2)(x + 3) = x² + 6 — réponse fictive de Lucas",
  answerB: "Réponse confidentielle fictive d’Emma",
  annotationA: "Il manque les termes 2x et 3x (annotation fictive).",
  schoolB: "Collège Victor Hugo (fictif)",
  assessmentB: "Contrôle confidentiel du collège B",
  commentC: "Commentaire fictif réservé à Inès, collège B",
  unverifiedReadingA: "Lecture automatique non vérifiée de la copie de Lucas (fictive)",
  pastClass: "2nde 4 (2025-2026, fictive)",
  pastAssessment: "Contrôle de l’an dernier (fictif)",
};

export async function seedPortalFixtures(db: PGlite, uuid: Uuid, ids: Ids): Promise<{ people: PortalPeople; accounts: LocalAccount[] }> {
  const people = portalPeople(uuid, ids.studentIds);
  const exec = (sql: string, params: unknown[] = []) => db.query(sql, params);

  // Logins for the two students (their auth users already exist).
  await exec("update auth.users set email = $2 where id = $1", [people.studentA.id, people.studentA.email]);
  await exec("update auth.users set email = $2 where id = $1", [people.studentB.id, people.studentB.email]);

  // Direction of school A.
  await exec("insert into auth.users(id, email, raw_user_meta_data) values ($1, $2, $3)", [
    people.directorA.id, people.directorA.email, JSON.stringify({ first_name: "Nadia", last_name: "Roche" }),
  ]);
  await exec("insert into public.school_memberships(school_id, user_id, role) values ($1, $2, 'admin')", [ids.school, people.directorA.id]);

  // Student A and B: comments, an answer with an annotation, competency levels.
  const firstAssessment = [...ids.assessmentIds.values()][0];
  const resultOf = async (studentId: string) =>
    (await db.query<{ id: string }>("select id from public.assessment_results where assessment_id = $1 and student_id = $2", [firstAssessment, studentId])).rows[0]?.id ??
    (await db.query<{ id: string }>("insert into public.assessment_results(assessment_id, student_id, score, absent) values ($1, $2, 11, false) returning id", [firstAssessment, studentId])).rows[0].id;
  const resultA = await resultOf(people.studentA.id);
  const resultB = await resultOf(people.studentB.id);
  await exec("update public.assessment_results set teacher_comment = $2 where id = $1", [resultA, PORTAL_MARKERS.commentA]);
  await exec("update public.assessment_results set teacher_comment = $2 where id = $1", [resultB, PORTAL_MARKERS.commentB]);
  const question = (
    await db.query<{ id: string }>(
      "insert into public.assessment_questions(assessment_id, position, prompt, correction_text, rubric, max_points) values ($1, 99, 'Développer (x + 2)(x + 3)', 'x² + 5x + 6', '{}'::jsonb, 2) returning id",
      [firstAssessment],
    )
  ).rows[0].id;
  // The question assesses one notion of the official programme (programme évalué).
  const notion = (
    await db.query<{ id: string }>(
      "select n.id from public.curriculum_nodes n join public.curriculum_sources s on s.id = n.source_id where s.subject_code = 'MATH' and n.active and n.node_type = 'notion' order by n.code limit 1",
    )
  ).rows[0];
  if (notion) await exec("insert into public.question_curriculum_nodes(question_id, curriculum_node_id, relation) values ($1, $2, 'assesses')", [question, notion.id]);
  await exec(
    "insert into public.student_responses(assessment_id, question_id, student_id, response_text, awarded_points, teacher_annotation) values ($1, $2, $3, $4, 0.5, $5)",
    [firstAssessment, question, people.studentA.id, PORTAL_MARKERS.answerA, PORTAL_MARKERS.annotationA],
  );
  await exec(
    "insert into public.student_responses(assessment_id, question_id, student_id, response_text, awarded_points, teacher_annotation) values ($1, $2, $3, $4, 2, null)",
    [firstAssessment, question, people.studentB.id, PORTAL_MARKERS.answerB],
  );

  // An automatic reading of student A's scanned copy that the teacher has not
  // checked yet (provenance columns exist from 20261009120000): never shown
  // to the student nor sent to the assistant.
  const provenance = await db.query("select 1 from information_schema.columns where table_schema = 'public' and table_name = 'student_responses' and column_name = 'transcription_verified'");
  if (provenance.rows.length) {
    const scanned = (
      await db.query<{ id: string }>(
        "insert into public.assessment_questions(assessment_id, position, prompt, correction_text, rubric, max_points) values ($1, 98, 'Résoudre 3x + 5 = 11', 'x = 2', '{}'::jsonb, 2) returning id",
        [firstAssessment],
      )
    ).rows[0].id;
    await exec(
      "insert into public.student_responses(assessment_id, question_id, student_id, response_text, source, legibility, transcription_verified) values ($1, $2, $3, $4, 'scan', 'lisible', false)",
      [firstAssessment, scanned, people.studentA.id, PORTAL_MARKERS.unverifiedReadingA],
    );
  }

  // Declared lessons for the Direction's "programme enseigné".
  const competencies = [...ids.competencyIds.values()];
  const teacher = (await db.query<{ teacher_id: string }>("select teacher_id from public.teacher_assignments where class_id = $1 limit 1", [ids.classId])).rows[0].teacher_id;
  for (const [index, date] of ["2026-09-08", "2026-09-15", "2026-09-22"].entries()) {
    const lesson = (
      await db.query<{ id: string }>(
        "insert into public.lessons(school_id, class_id, subject_id, teacher_id, date, summary) values ($1, $2, $3, $4, $5, $6) returning id",
        [ids.school, ids.classId, ids.subject, teacher, date, `Séance fictive ${index + 1}`],
      )
    ).rows[0].id;
    await exec("insert into public.lesson_competencies(lesson_id, competency_id) values ($1, $2)", [lesson, competencies[index]]);
  }

  // A previous school year of school A: its class, assignment and assessment
  // must never count in the Direction's figures for the current year.
  const pastYear = uuid("year:a-past");
  const pastClass = uuid("class:a-past");
  await exec("insert into public.academic_years(id, school_id, name, starts_at, ends_at, active) values ($1, $2, '2025-2026', '2025-09-01', '2026-07-04', false)", [pastYear, ids.school]);
  await exec("insert into public.classes(id, school_id, academic_year_id, name, level) values ($1, $2, $3, $4, 'Seconde')", [pastClass, ids.school, pastYear, PORTAL_MARKERS.pastClass]);
  await exec("insert into public.teacher_assignments(school_id, teacher_id, class_id, subject_id) values ($1, $2, $3, $4)", [ids.school, teacher, pastClass, ids.subject]);
  await exec("insert into public.assessments(school_id, class_id, subject_id, teacher_id, title, date) values ($1, $2, $3, $4, $5, '2026-03-10')", [
    ids.school, pastClass, ids.subject, teacher, PORTAL_MARKERS.pastAssessment,
  ]);

  // School B, entirely separate.
  const schoolB = uuid("school:b");
  const yearB = uuid("year:b");
  const classB = uuid("class:b");
  const subjectB = uuid("subject:b");
  await exec("insert into public.schools(id, name) values ($1, $2)", [schoolB, PORTAL_MARKERS.schoolB]);
  await exec("insert into public.academic_years(id, school_id, name, starts_at, ends_at, active) values ($1, $2, '2026-2027', '2026-09-01', '2027-07-04', true)", [yearB, schoolB]);
  await exec("insert into public.classes(id, school_id, academic_year_id, name, level) values ($1, $2, $3, '3e B (fictive)', 'Troisième')", [classB, schoolB, yearB]);
  await exec("insert into public.subjects(id, school_id, name, code) values ($1, $2, 'Mathématiques', 'MATH')", [subjectB, schoolB]);
  for (const [id, email, first, last] of [
    [people.directorB.id, people.directorB.email, "Bruno", "Vasseur"],
    [people.teacherB.id, "helene.garnier@college-b.example.test", "Hélène", "Garnier"],
    [people.studentC.id, null, "Inès", "Morel"],
  ] as const)
    await exec("insert into auth.users(id, email, raw_user_meta_data) values ($1, $2, $3)", [id, email, JSON.stringify({ first_name: first, last_name: last })]);
  await exec("insert into public.school_memberships(school_id, user_id, role) values ($1, $2, 'admin'), ($1, $3, 'teacher'), ($1, $4, 'student')", [
    schoolB, people.directorB.id, people.teacherB.id, people.studentC.id,
  ]);
  await exec("insert into public.teacher_assignments(school_id, teacher_id, class_id, subject_id) values ($1, $2, $3, $4)", [schoolB, people.teacherB.id, classB, subjectB]);
  await exec("insert into public.student_enrollments(school_id, student_id, class_id, academic_year_id) values ($1, $2, $3, $4)", [schoolB, people.studentC.id, classB, yearB]);
  const assessmentB = (
    await db.query<{ id: string }>(
      "insert into public.assessments(school_id, class_id, subject_id, teacher_id, title, date) values ($1, $2, $3, $4, $5, '2026-09-20') returning id",
      [schoolB, classB, subjectB, people.teacherB.id, PORTAL_MARKERS.assessmentB],
    )
  ).rows[0].id;
  await exec("insert into public.assessment_results(assessment_id, student_id, score, absent, teacher_comment) values ($1, $2, 7, false, $3)", [
    assessmentB, people.studentC.id, PORTAL_MARKERS.commentC,
  ]);

  return {
    people,
    accounts: [
      { email: people.studentA.email, password: people.studentA.password, userId: people.studentA.id },
      { email: people.studentB.email, password: people.studentB.password, userId: people.studentB.id },
      { email: people.directorA.email, password: people.directorA.password, userId: people.directorA.id },
      { email: people.directorB.email, password: people.directorB.password, userId: people.directorB.id },
    ],
  };
}
