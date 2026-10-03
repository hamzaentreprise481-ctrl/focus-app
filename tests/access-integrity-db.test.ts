// Who reads AI output, who decides on it, and the same invariants for direct
// table writes as for the focus_* functions (migration
// 20261002120000_access_integrity_hardening), on the real schema with RLS.
// Every caller is an ordinary `authenticated` session, as PostgREST would run
// it for any Supabase Auth account holding the publishable key.

import { after, afterEach, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { normalizeMathText } from "@/lib/pedagogy/analysis";
import { createMigratedDatabase, seedSchoolFixture, type SchoolFixtureIds } from "./helpers/pg";

let db: PGlite;
let a: SchoolFixtureIds;
let physicsTeacher: string;
let coTeacher: string;
let admin: string;
let otherClass: string;
let otherClassStudent: string;
let otherSchool: { school: string; classId: string; subject: string };

const one = async (sql: string, params: unknown[] = []) => (await db.query<{ id: string }>(sql, params)).rows[0].id;

before(async () => {
  db = await createMigratedDatabase();
  a = await seedSchoolFixture(db, { students: [null, null] as unknown as string[] });
  const user = (email: string) =>
    one(`insert into auth.users(email, raw_app_meta_data) values ($1, '{"role":"teacher"}') returning id`, [email]);
  const member = (userId: string, role: string) =>
    db.query("insert into public.school_memberships(school_id, user_id, role) values ($1, $2, $3)", [a.school, userId, role]);
  const assign = (teacher: string, classId: string, subject: string) =>
    db.query("insert into public.teacher_assignments(school_id, teacher_id, class_id, subject_id) values ($1, $2, $3, $4)", [a.school, teacher, classId, subject]);

  // Same class, another subject.
  physicsTeacher = await user("pc@example.test");
  const physics = await one("insert into public.subjects(school_id, name, code) values ($1, 'Physique-chimie', 'PC') returning id", [a.school]);
  await member(physicsTeacher, "teacher");
  await assign(physicsTeacher, a.classId, physics);
  // Same class and subject (a substitute or co-teacher).
  coTeacher = await user("remplacant@example.test");
  await member(coTeacher, "teacher");
  await assign(coTeacher, a.classId, a.subject);
  // School administrator.
  admin = await one("insert into auth.users(email) values ('direction@example.test') returning id");
  await member(admin, "admin");
  // Another class of the same school, also taught by the maths teacher.
  otherClass = await one(
    "insert into public.classes(school_id, academic_year_id, name, level) values ($1, $2, 'Seconde 5', 'Seconde') returning id",
    [a.school, a.year],
  );
  await assign(a.teacher, otherClass, a.subject);
  otherClassStudent = await one("insert into auth.users default values returning id");
  await member(otherClassStudent, "student");
  await db.query("insert into public.student_enrollments(school_id, student_id, class_id, academic_year_id) values ($1, $2, $3, $4)", [
    a.school, otherClassStudent, otherClass, a.year,
  ]);
  // Another school entirely.
  const school = await one("insert into public.schools(name) values ('Autre lycée') returning id");
  const year = await one(
    "insert into public.academic_years(school_id, name, starts_at, ends_at) values ($1, '2026-2027', '2026-09-01', '2027-07-04') returning id",
    [school],
  );
  otherSchool = {
    school,
    classId: await one("insert into public.classes(school_id, academic_year_id, name) values ($1, $2, '2nde A') returning id", [school, year]),
    subject: await one("insert into public.subjects(school_id, name, code) values ($1, 'Mathématiques', 'MATH') returning id", [school]),
  };
});
after(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.exec("begin");
});
afterEach(async () => {
  await db.exec("rollback");
});

async function as<T = Record<string, unknown>>(userId: string, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec("savepoint call");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    const { rows } = await db.query<T>(sql, params);
    await db.exec("reset role");
    await db.exec("release savepoint call");
    return rows;
  } catch (error) {
    await db.exec("rollback to savepoint call");
    throw error;
  }
}
const teacher = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => as<T>(a.teacher, sql, params);
const hash = () => createHash("sha256").update(randomUUID()).digest("hex");
const nodeId = async (code: string) =>
  (await db.query<{ id: string }>("select id from public.curriculum_nodes where code = $1", [code])).rows[0].id;

async function assessment(classId = a.classId, results: unknown[] = []) {
  const [{ id }] = await teacher<{ id: string }>(
    "select public.focus_save_assessment($1, 'Contrôle', current_date, $2, $3, '{}'::uuid[], $4::jsonb, false) as id",
    [randomUUID(), classId, a.subject, JSON.stringify(results)],
  );
  return id;
}

/** An assessment with one tagged question, one answer and one pending hypothesis. */
async function analysedCopy() {
  const assessmentId = await assessment();
  const [{ result }] = await teacher<{ result: { questionIds: string[] } }>(
    "select public.focus_save_assessment_questions($1, '', '', $2::jsonb) as result",
    [assessmentId, JSON.stringify([{ prompt: "Développer 3(x+2).", correctionText: "3x+6", maxPoints: "2", nodeCodes: ["MATH.ALG.DISTRIBUTIVITE"] }])],
  );
  const [question] = result.questionIds;
  await teacher("select public.focus_save_student_responses($1, $2, $3::jsonb)", [
    assessmentId,
    a.students[0],
    JSON.stringify([{ questionId: question, responseText: "3(x+2) = 3x+2", awardedPoints: "1" }]),
  ]);
  const [{ id: responseId }] = await teacher<{ id: string }>("select id from public.student_responses where question_id = $1", [question]);
  const node = await nodeId("MATH.ALG.DISTRIBUTIVITE");
  const [{ run }] = await teacher<{ run: string }>(
    "select public.focus_persist_pedagogical_analysis($1, $2, $3, 'test-model', $4, $5::jsonb, $6::jsonb) as run",
    [
      a.school,
      a.students[0],
      assessmentId,
      hash(),
      JSON.stringify([{ questionId: question, responseId, nodeId: node, errorType: "calcul", evidenceExcerpt: "3x+2", explanation: "Le 3 n’est appliqué qu’au premier terme." }]),
      JSON.stringify([{ nodeId: node, difficulty: "Distribuer", explanation: "Explication", recommendedAction: "Action" }]),
    ],
  );
  const [{ id: recommendation }] = await teacher<{ id: string }>("select id from public.pedagogical_recommendations where analysis_run_id = $1", [run]);
  await teacher("select public.focus_review_pedagogical_recommendation($1, 'validate', 'Note privée du professeur')", [recommendation]);
  return { assessmentId, question, run, recommendation };
}

const AI_TABLES = [
  ["ai_analysis_runs", "id"],
  ["error_observations", "analysis_run_id"],
  ["pedagogical_recommendations", "analysis_run_id"],
] as const;

async function visibleAiRows(userId: string, run: string, recommendation: string) {
  const counts: Record<string, number> = {};
  for (const [table, column] of AI_TABLES)
    counts[table] = (await as(userId, `select 1 from public.${table} where ${column} = $1`, [run])).length;
  counts.pedagogical_review_events = (
    await as(userId, "select 1 from public.pedagogical_review_events where recommendation_id = $1", [recommendation])
  ).length;
  return counts;
}

test("a student reads their own results and answers, never the AI hypotheses or the teacher's notes", async () => {
  const { run, recommendation, assessmentId } = await analysedCopy();
  assert.deepEqual(await visibleAiRows(a.students[0], run, recommendation), {
    ai_analysis_runs: 0,
    error_observations: 0,
    pedagogical_recommendations: 0,
    pedagogical_review_events: 0,
  });
  // Their own copy stays theirs.
  assert.equal((await as(a.students[0], "select 1 from public.student_responses where assessment_id = $1", [assessmentId])).length, 1);
  // Nor can they decide.
  await assert.rejects(as(a.students[0], "select public.focus_review_pedagogical_recommendation($1, 'dismiss')", [recommendation]), /not writable/);
});

test("AI output is read by the teachers of the class and subject and the school admin, not by other subjects", async () => {
  const { run, recommendation, assessmentId } = await analysedCopy();
  const all = { ai_analysis_runs: 1, error_observations: 1, pedagogical_recommendations: 1, pedagogical_review_events: 1 };
  assert.deepEqual(await visibleAiRows(a.teacher, run, recommendation), all);
  assert.deepEqual(await visibleAiRows(coTeacher, run, recommendation), all);
  assert.deepEqual(await visibleAiRows(admin, run, recommendation), all);
  assert.deepEqual(await visibleAiRows(physicsTeacher, run, recommendation), {
    ai_analysis_runs: 0,
    error_observations: 0,
    pedagogical_recommendations: 0,
    pedagogical_review_events: 0,
  });
  // The physics teacher still sees that the class had a maths assessment.
  assert.equal((await as(physicsTeacher, "select 1 from public.assessments where id = $1", [assessmentId])).length, 1);
  await assert.rejects(as(physicsTeacher, "select public.focus_review_pedagogical_recommendation($1, 'dismiss')", [recommendation]), /not writable/);
});

test("a teacher currently assigned to the class and subject decides; one who left the class no longer can", async () => {
  const { recommendation } = await analysedCopy();
  // The substitute dismisses the hypothesis that the maths teacher confirmed.
  await as(coTeacher, "select public.focus_review_pedagogical_recommendation($1, 'dismiss', 'Vu en classe')", [recommendation]);
  const [row] = await teacher<{ teacher_decision: string; teacher_decided_by: string }>(
    "select teacher_decision, teacher_decided_by from public.pedagogical_recommendations where id = $1",
    [recommendation],
  );
  assert.deepEqual([row.teacher_decision, row.teacher_decided_by], ["dismissed", coTeacher]);

  // The author of the analysis leaves the class: no more reading or deciding.
  await db.query("delete from public.teacher_assignments where teacher_id = $1 and class_id = $2", [a.teacher, a.classId]);
  assert.deepEqual(await teacher("select 1 from public.pedagogical_recommendations where id = $1", [recommendation]), []);
  await assert.rejects(teacher("select public.focus_review_pedagogical_recommendation($1, 'validate')", [recommendation]), /not writable/);
});

test("direct writes cannot move an assessment outside the classes, subjects and school the teacher teaches", async () => {
  const assessmentId = await assessment();
  // To a class of another school, or with another school's id.
  await assert.rejects(
    teacher("update public.assessments set class_id = $2, school_id = $3, subject_id = $4 where id = $1", [
      assessmentId, otherSchool.classId, otherSchool.school, otherSchool.subject,
    ]),
    /row-level security|school must be/,
  );
  await assert.rejects(teacher("update public.assessments set school_id = $2 where id = $1", [assessmentId, otherSchool.school]), /row-level security|school must be/);
  // To a subject the teacher does not teach in this class.
  const [{ id: physics }] = await db.query<{ id: string }>("select id from public.subjects where code = 'PC'").then((r) => r.rows);
  await assert.rejects(teacher("update public.assessments set subject_id = $2 where id = $1", [assessmentId, physics]), /row-level security/);
  // Inserted directly for another school.
  await assert.rejects(
    teacher(
      "insert into public.assessments(school_id, class_id, subject_id, teacher_id, title, date) values ($1, $2, $3, $4, 'X', current_date)",
      [otherSchool.school, a.classId, a.subject, a.teacher],
    ),
    /row-level security|school must be/,
  );
  // An administrator cannot attach a class to another school's assessment either.
  await assert.rejects(
    db.query("update public.assessments set school_id = $2 where id = $1", [assessmentId, otherSchool.school]),
    /school must be its class/,
  );
});

test("an assessment keeps its class once it has questions or results of that class", async () => {
  // With questions: refused, even through a direct update.
  const { assessmentId } = await analysedCopy();
  await assert.rejects(teacher("update public.assessments set class_id = $2 where id = $1", [assessmentId, otherClass]), /cannot change class/);

  // With results of the class: a direct move would orphan them.
  const graded = await assessment(a.classId, [{ studentId: a.students[0], score: "12" }]);
  await assert.rejects(teacher("update public.assessments set class_id = $2 where id = $1", [graded, otherClass]), /students of another class/);
  // Through focus_save_assessment the results are replaced with the new class's students: allowed.
  await teacher("select public.focus_save_assessment($1, 'Contrôle', current_date, $2, $3, '{}'::uuid[], $4::jsonb, false)", [
    graded, otherClass, a.subject, JSON.stringify([{ studentId: otherClassStudent, score: "14" }]),
  ]);
  const rows = await teacher<{ student_id: string }>("select student_id from public.assessment_results where assessment_id = $1", [graded]);
  assert.deepEqual(rows.map((row) => row.student_id), [otherClassStudent]);
});

test("direct result writes only for enrolled students and the assessment's competencies", async () => {
  const assessmentId = await assessment();
  await assert.rejects(
    teacher("insert into public.assessment_results(assessment_id, student_id, score) values ($1, $2, 10)", [assessmentId, otherClassStudent]),
    /row-level security/,
  );
  const [{ id: result }] = await teacher<{ id: string }>(
    "insert into public.assessment_results(assessment_id, student_id, score) values ($1, $2, 10) returning id",
    [assessmentId, a.students[0]],
  );
  await assert.rejects(
    teacher("update public.assessment_results set student_id = $2 where id = $1", [result, otherClassStudent]),
    /row-level security/,
  );
  const competency = await one("insert into public.competencies(school_id, subject_id, name) values ($1, $2, 'Calcul') returning id", [a.school, a.subject]);
  await assert.rejects(
    teacher("insert into public.competency_results(assessment_result_id, competency_id, mastery_level) values ($1, $2, 'fragile')", [result, competency]),
    /row-level security/,
  );
  await db.query("insert into public.assessment_competencies(assessment_id, competency_id) values ($1, $2)", [assessmentId, competency]);
  await teacher("insert into public.competency_results(assessment_result_id, competency_id, mastery_level) values ($1, $2, 'fragile')", [result, competency]);
});

test("a question's maximum and notions keep their rules on direct writes", async () => {
  const { question } = await analysedCopy();
  // One point awarded out of two: the maximum cannot drop below it.
  await assert.rejects(teacher("update public.assessment_questions set max_points = 0.5 where id = $1", [question]), /below points already awarded/);
  await teacher("update public.assessment_questions set max_points = 1 where id = $1", [question]);

  const competency = await nodeId("MATH.COMP.CALCULER");
  await assert.rejects(
    teacher("insert into public.question_curriculum_nodes(question_id, curriculum_node_id, relation) values ($1, $2, 'assesses')", [question, competency]),
    /only assess an active notion/,
  );
  const notions = await db.query<{ id: string }>(
    "select id from public.curriculum_nodes where node_type = 'notion' and active and code <> 'MATH.ALG.DISTRIBUTIVITE' order by code limit 6",
  );
  for (const [index, row] of notions.rows.entries()) {
    const insert = teacher("insert into public.question_curriculum_nodes(question_id, curriculum_node_id, relation) values ($1, $2, 'assesses')", [question, row.id]);
    // Already one notion: five more are allowed, the seventh is not.
    if (index < 5) await insert;
    else await assert.rejects(insert, /at most 6 notions/);
  }
});

test("a direct call cannot record a finding on an answer given full marks or identical to the correction", async () => {
  const assessmentId = await assessment();
  const [{ result }] = await teacher<{ result: { questionIds: string[] } }>(
    "select public.focus_save_assessment_questions($1, '', '', $2::jsonb) as result",
    [assessmentId, JSON.stringify([{ prompt: "Développer 3(x+2).", correctionText: "3(x+2) = 3x+6", maxPoints: "2", nodeCodes: ["MATH.ALG.DISTRIBUTIVITE"] }])],
  );
  const [question] = result.questionIds;
  const node = await nodeId("MATH.ALG.DISTRIBUTIVITE");
  const record = async (student: string, responseText: string, awardedPoints: string, excerpt: string) => {
    await teacher("select public.focus_save_student_responses($1, $2, $3::jsonb)", [
      assessmentId,
      student,
      JSON.stringify([{ questionId: question, responseText, awardedPoints }]),
    ]);
    const [{ id: responseId }] = await teacher<{ id: string }>(
      "select id from public.student_responses where question_id = $1 and student_id = $2",
      [question, student],
    );
    return teacher("select public.focus_persist_pedagogical_analysis($1, $2, $3, 'm', $4, $5::jsonb, '[]'::jsonb)", [
      a.school,
      student,
      assessmentId,
      hash(),
      JSON.stringify([{ questionId: question, responseId, nodeId: node, errorType: "calcul", evidenceExcerpt: excerpt, explanation: "Le 3 n’est appliqué qu’au premier terme." }]),
    ]);
  };
  // Full marks: the teacher judged the answer right.
  await assert.rejects(record(a.students[0], "3(x+2) = 3x+2", "2", "3x+2"), /full marks/);
  // The correction itself, written differently (case, spaces, final full stop).
  await assert.rejects(record(a.students[1], " 3(X + 2) = 3X + 6. ", "", "3X + 6"), /identical to the correction/);
  // Neither: the same finding is recorded.
  await record(a.students[0], "3(x+2) = 3x+2", "1", "3x+2");
  const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.error_observations where assessment_id = $1", [assessmentId]);
  assert.equal(rows[0].n, 1);
});

test("the database compares an answer with the correction exactly as the app does", async () => {
  const samples = ["2 × (x − 3).", "2·x – 3;;", "3X + 6. ", "ｘ² + 1", "  ", "a.b;c"];
  for (const sample of samples) {
    const { rows } = await db.query<{ value: string }>("select public.focus_normalize_math_text($1) as value", [sample]);
    assert.equal(rows[0].value, normalizeMathText(sample), JSON.stringify(sample));
  }
  // Only the persistence function (its owner) uses it.
  const { rows } = await db.query<{ allowed: boolean }>(
    "select has_function_privilege('authenticated', 'public.focus_normalize_math_text(text)', 'execute') as allowed",
  );
  assert.equal(rows[0].allowed, false);
});

test("API roles hold no TRUNCATE, TRIGGER or REFERENCES, and the unused V0 tables are read-only", async () => {
  const { rows: risky } = await db.query<{ relname: string; privilege: string }>(
    `select c.relname, p.privilege from pg_class c, unnest(array['truncate', 'trigger', 'references']) as p(privilege)
     where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and has_table_privilege('authenticated', c.oid, p.privilege)`,
  );
  assert.deepEqual(risky, []);
  const { rows: writable } = await db.query<{ relname: string }>(
    `select distinct c.relname from pg_class c, unnest(array['insert', 'update', 'delete']) as p(privilege)
     where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
       and c.relname in ('homework', 'homework_resources', 'homework_views', 'lessons', 'lesson_competencies', 'lesson_absences', 'learning_paths', 'learning_activities', 'student_progress')
       and has_table_privilege('authenticated', c.oid, p.privilege)`,
  );
  assert.deepEqual(writable, []);
  // A student cannot create a learning path, even for a teacher they share a class with.
  await assert.rejects(
    as(a.students[0], "insert into public.learning_paths(school_id, student_id, origin) values ($1, $2, 'competency_gap')", [a.school, a.teacher]),
    /permission denied/,
  );
  // The teacher workflow still writes through its functions.
  await analysedCopy();
});
