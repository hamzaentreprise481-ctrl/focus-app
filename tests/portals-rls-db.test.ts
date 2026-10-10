// FOCUS Student and FOCUS Direction on the real schema with RLS (every
// migration, PGlite): what a student and a director can read and write when
// they call PostgREST directly with their own session — the app is not the
// boundary. Two schools, two students in the same class, all fictitious.
// The suite runs on every migration AND on the live head (20261004090000):
// Student and Direction must not depend on the pending migrations.

import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { createMigratedDatabase } from "./helpers/pg";

const LIVE_HEAD = "20261004090000_engine_signed_analyses.sql";

for (const upTo of [undefined, LIVE_HEAD])
describe(upTo ? "on the live head schema" : "on every migration", () => {
  let db: PGlite;
  const ids = {} as Record<
    | "schoolA" | "schoolB" | "yearA" | "yearB" | "classA" | "classB" | "mathA" | "mathB"
    | "directorA" | "directorB" | "teacherA" | "teacherB" | "studentA" | "studentB" | "studentC"
    | "assessmentA" | "assessmentB" | "competencyA" | "resultA" | "resultB" | "resultC" | "questionA" | "responseA" | "responseB",
    string
  >;

  const one = async (sql: string, params: unknown[] = []) => (await db.query<{ id: string }>(sql, params)).rows[0].id;

  before(async () => {
    db = await createMigratedDatabase(upTo ? { upTo } : {});
    const user = (email: string, first: string, last: string) =>
      one("insert into auth.users(email, raw_user_meta_data) values ($1, $2) returning id", [email, JSON.stringify({ first_name: first, last_name: last })]);
    for (const [key, name] of [["schoolA", "Lycée A (fictif)"], ["schoolB", "Lycée B (fictif)"]] as const)
      ids[key] = await one("insert into public.schools(name) values ($1) returning id", [name]);
    for (const [year, school] of [["yearA", "schoolA"], ["yearB", "schoolB"]] as const)
      ids[year] = await one(
        "insert into public.academic_years(school_id, name, starts_at, ends_at, active) values ($1, '2026-2027', '2026-09-01', '2027-07-05', true) returning id",
        [ids[school]],
      );
    ids.classA = await one("insert into public.classes(school_id, academic_year_id, name, level) values ($1, $2, '2nde A', 'Seconde') returning id", [ids.schoolA, ids.yearA]);
    ids.classB = await one("insert into public.classes(school_id, academic_year_id, name, level) values ($1, $2, '2nde B', 'Seconde') returning id", [ids.schoolB, ids.yearB]);
    ids.mathA = await one("insert into public.subjects(school_id, name, code) values ($1, 'Mathématiques', 'MATH') returning id", [ids.schoolA]);
    ids.mathB = await one("insert into public.subjects(school_id, name, code) values ($1, 'Mathématiques', 'MATH') returning id", [ids.schoolB]);

    ids.directorA = await user("direction.a@example.test", "Anne", "Direction");
    ids.directorB = await user("direction.b@example.test", "Bruno", "Direction");
    ids.teacherA = await user("prof.a@example.test", "Claire", "Prof");
    ids.teacherB = await user("prof.b@example.test", "Paul", "Prof");
    ids.studentA = await user("eleve.a@example.test", "Alice", "Eleve");
    ids.studentB = await user("eleve.b@example.test", "Bilal", "Eleve");
    ids.studentC = await user("eleve.c@example.test", "Chloé", "Eleve");
    for (const [person, school, role] of [
      ["directorA", "schoolA", "admin"], ["teacherA", "schoolA", "teacher"], ["studentA", "schoolA", "student"], ["studentB", "schoolA", "student"],
      ["directorB", "schoolB", "admin"], ["teacherB", "schoolB", "teacher"], ["studentC", "schoolB", "student"],
    ] as const)
      await db.query("insert into public.school_memberships(school_id, user_id, role) values ($1, $2, $3)", [ids[school], ids[person], role]);
    await db.query("insert into public.teacher_assignments(school_id, teacher_id, class_id, subject_id) values ($1, $2, $3, $4), ($5, $6, $7, $8)", [
      ids.schoolA, ids.teacherA, ids.classA, ids.mathA, ids.schoolB, ids.teacherB, ids.classB, ids.mathB,
    ]);
    for (const [student, school, klass, year] of [
      ["studentA", "schoolA", "classA", "yearA"], ["studentB", "schoolA", "classA", "yearA"], ["studentC", "schoolB", "classB", "yearB"],
    ] as const)
      await db.query("insert into public.student_enrollments(school_id, student_id, class_id, academic_year_id) values ($1, $2, $3, $4)", [
        ids[school], ids[student], ids[klass], ids[year],
      ]);

    ids.competencyA = await one("insert into public.competencies(school_id, subject_id, name) values ($1, $2, 'Calcul littéral') returning id", [ids.schoolA, ids.mathA]);
    ids.assessmentA = await one(
      "insert into public.assessments(school_id, class_id, subject_id, teacher_id, title, date) values ($1, $2, $3, $4, 'Développements', '2026-10-02') returning id",
      [ids.schoolA, ids.classA, ids.mathA, ids.teacherA],
    );
    ids.assessmentB = await one(
      "insert into public.assessments(school_id, class_id, subject_id, teacher_id, title, date) values ($1, $2, $3, $4, 'Contrôle B', '2026-10-03') returning id",
      [ids.schoolB, ids.classB, ids.mathB, ids.teacherB],
    );
    await db.query("insert into public.assessment_competencies(assessment_id, competency_id) values ($1, $2)", [ids.assessmentA, ids.competencyA]);
    const result = (assessment: string, student: string, score: number, comment: string) =>
      one("insert into public.assessment_results(assessment_id, student_id, score, absent, teacher_comment) values ($1, $2, $3, false, $4) returning id", [
        ids[assessment as "assessmentA"], ids[student as "studentA"], score, comment,
      ]);
    ids.resultA = await result("assessmentA", "studentA", 12, "Commentaire pour Alice");
    ids.resultB = await result("assessmentA", "studentB", 15, "Commentaire pour Bilal");
    ids.resultC = await result("assessmentB", "studentC", 9, "Commentaire pour Chloé");
    for (const [resultKey, level] of [["resultA", "fragile"], ["resultB", "mastered"]] as const)
      await db.query("insert into public.competency_results(assessment_result_id, competency_id, mastery_level) values ($1, $2, $3)", [ids[resultKey], ids.competencyA, level]);
    ids.questionA = await one(
      "insert into public.assessment_questions(assessment_id, position, prompt, correction_text, rubric, max_points) values ($1, 1, 'Développer 2(x+3)', '2x + 6', '{}'::jsonb, 2) returning id",
      [ids.assessmentA],
    );
    ids.responseA = await one(
      "insert into public.student_responses(assessment_id, question_id, student_id, response_text, awarded_points, teacher_annotation) values ($1, $2, $3, 'réponse d’Alice', 0.5, 'annotation Alice') returning id",
      [ids.assessmentA, ids.questionA, ids.studentA],
    );
    ids.responseB = await one(
      "insert into public.student_responses(assessment_id, question_id, student_id, response_text, awarded_points, teacher_annotation) values ($1, $2, $3, 'réponse de Bilal', 2, 'annotation Bilal') returning id",
      [ids.assessmentA, ids.questionA, ids.studentB],
    );
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

  /** One statement as an ordinary `authenticated` session of this user, as PostgREST runs it. */
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
      await db.exec("reset role");
      throw error;
    }
  }
  const count = async (userId: string, sql: string, params: unknown[] = []) =>
    (await as<{ n: number }>(userId, `select count(*)::int as n from (${sql}) x`, params))[0].n;
  const denied = (promise: Promise<unknown>) =>
    assert.rejects(promise, (error: Error) => /row-level security|permission denied|not allowed|42501/i.test(error.message));

  // --- Student --------------------------------------------------------------

  test("a student reads their own grade, answers and competency levels", async () => {
    const results = await as<{ score: string; teacher_comment: string }>(ids.studentA, "select score, teacher_comment from public.assessment_results");
    assert.deepEqual(results.map((row) => [Number(row.score), row.teacher_comment]), [[12, "Commentaire pour Alice"]]);
    const responses = await as<{ response_text: string }>(ids.studentA, "select response_text from public.student_responses");
    assert.deepEqual(responses.map((row) => row.response_text), ["réponse d’Alice"]);
    const levels = await as<{ mastery_level: string }>(ids.studentA, "select mastery_level from public.competency_results");
    assert.deepEqual(levels.map((row) => row.mastery_level), ["fragile"]);
    assert.equal(await count(ids.studentA, "select 1 from public.assessments where id = $1", [ids.assessmentA]), 1);
  });

  test("a student never reads another student's grade, answers, levels or profile — even by UUID", async () => {
    assert.equal(await count(ids.studentA, "select 1 from public.assessment_results where student_id = $1", [ids.studentB]), 0);
    assert.equal(await count(ids.studentA, "select 1 from public.assessment_results where id = $1", [ids.resultB]), 0);
    assert.equal(await count(ids.studentA, "select 1 from public.student_responses where id = $1 or student_id = $2", [ids.responseB, ids.studentB]), 0);
    assert.equal(await count(ids.studentA, "select 1 from public.competency_results where assessment_result_id = $1", [ids.resultB]), 0);
    assert.equal(await count(ids.studentA, "select 1 from public.profiles where id = $1", [ids.studentB]), 0);
    assert.equal(await count(ids.studentA, "select 1 from public.school_memberships where user_id = $1", [ids.studentB]), 0);
    assert.equal(await count(ids.studentA, "select 1 from public.student_enrollments where student_id = $1", [ids.studentB]), 0);
    // Another school entirely.
    assert.equal(await count(ids.studentA, "select 1 from public.assessments where id = $1", [ids.assessmentB]), 0);
    assert.equal(await count(ids.studentA, "select 1 from public.assessment_results where id = $1", [ids.resultC]), 0);
    assert.equal(await count(ids.studentA, "select 1 from public.classes where id = $1", [ids.classB]), 0);
  });

  test("a student never reads questions, corrections or teacher-only analysis", async () => {
    assert.equal(await count(ids.studentA, "select 1 from public.assessment_questions"), 0);
    assert.equal(await count(ids.studentA, "select 1 from public.assessment_materials"), 0);
    for (const table of ["pedagogical_recommendations", "error_observations", "ai_analysis_runs", "pedagogical_review_events", "teacher_assignments"])
      assert.equal(await count(ids.studentA, `select 1 from public.${table}`), 0, table);
  });

  test("a student cannot create, change or delete a grade, a level, an answer or an assessment", async () => {
    await denied(as(ids.studentA, "insert into public.assessment_results(assessment_id, student_id, score, absent) values ($1, $2, 20, false)", [ids.assessmentA, ids.studentA]));
    assert.equal((await as(ids.studentA, "update public.assessment_results set score = 20 where id = $1 returning id", [ids.resultA])).length, 0);
    assert.equal((await as(ids.studentA, "update public.assessment_results set score = 20 where id = $1 returning id", [ids.resultB])).length, 0);
    assert.equal((await as(ids.studentA, "delete from public.assessment_results where id = $1 returning id", [ids.resultA])).length, 0);
    await denied(as(ids.studentA, "insert into public.competency_results(assessment_result_id, competency_id, mastery_level) values ($1, $2, 'mastered')", [ids.resultA, ids.competencyA]));
    assert.equal((await as(ids.studentA, "update public.competency_results set mastery_level = 'mastered' where assessment_result_id = $1 returning id", [ids.resultA])).length, 0);
    assert.equal((await as(ids.studentA, "update public.student_responses set teacher_annotation = 'parfait', awarded_points = 2 where id = $1 returning id", [ids.responseA])).length, 0);
    assert.equal((await as(ids.studentA, "update public.assessments set title = 'piraté' where id = $1 returning id", [ids.assessmentA])).length, 0);
    assert.equal((await as(ids.studentA, "update public.assessment_questions set correction_text = 'x' where id = $1 returning id", [ids.questionA])).length, 0);
    await denied(as(ids.studentA, "insert into public.competencies(school_id, subject_id, name) values ($1, $2, 'Compétence élève')", [ids.schoolA, ids.mathA]));
    await assert.rejects(as(ids.studentA, "select public.focus_save_assessment(null, 'Faux', '2026-10-05', $1, $2, '{}'::uuid[], '[]'::jsonb, false)", [ids.classA, ids.mathA]));
    // Nothing changed.
    const { rows } = await db.query<{ score: string }>("select score from public.assessment_results where id = $1", [ids.resultA]);
    assert.equal(Number(rows[0].score), 12);
  });

  test("a student holds only a student membership: neither teacher nor direction", async () => {
    const roles = await as<{ role: string }>(ids.studentA, "select role::text from public.school_memberships where user_id = $1", [ids.studentA]);
    assert.deepEqual(roles.map((row) => row.role), ["student"]);
  });

  // --- Direction -------------------------------------------------------------

  test("a director reads their own school's aggregates", async () => {
    assert.equal(await count(ids.directorA, "select 1 from public.classes"), 1);
    assert.equal(await count(ids.directorA, "select 1 from public.student_enrollments"), 2);
    assert.equal(await count(ids.directorA, "select 1 from public.teacher_assignments"), 1);
    assert.equal(await count(ids.directorA, "select 1 from public.assessments"), 1);
    assert.equal(await count(ids.directorA, "select 1 from public.assessment_results"), 2);
    assert.equal(await count(ids.directorA, "select 1 from public.competency_results"), 2);
    assert.equal(await count(ids.directorA, "select 1 from public.school_memberships where school_id = $1", [ids.schoolA]), 4);
    assert.equal(await count(ids.directorA, "select 1 from public.profiles where id = $1", [ids.teacherA]), 1);
  });

  test("a director never reads another school — even by UUID", async () => {
    assert.equal(await count(ids.directorA, "select 1 from public.schools where id = $1", [ids.schoolB]), 0);
    assert.equal(await count(ids.directorA, "select 1 from public.classes where id = $1", [ids.classB]), 0);
    assert.equal(await count(ids.directorA, "select 1 from public.assessments where school_id = $1", [ids.schoolB]), 0);
    assert.equal(await count(ids.directorA, "select 1 from public.assessment_results where id = $1", [ids.resultC]), 0);
    assert.equal(await count(ids.directorA, "select 1 from public.student_enrollments where school_id = $1", [ids.schoolB]), 0);
    assert.equal(await count(ids.directorA, "select 1 from public.school_memberships where school_id = $1", [ids.schoolB]), 0);
    assert.equal(await count(ids.directorA, "select 1 from public.teacher_assignments where school_id = $1", [ids.schoolB]), 0);
    assert.equal(await count(ids.directorA, "select 1 from public.profiles where id in ($1, $2)", [ids.teacherB, ids.studentC]), 0);
    assert.equal(await count(ids.directorA, "select 1 from public.academic_years where id = $1", [ids.yearB]), 0);
    // And the other way round.
    assert.equal(await count(ids.directorB, "select 1 from public.assessment_results"), 1);
    assert.equal(await count(ids.directorB, "select 1 from public.classes where id = $1", [ids.classA]), 0);
  });

  test("a teacher is not a director: no admin membership and no other school's data", async () => {
    const roles = await as<{ role: string }>(ids.teacherA, "select role::text from public.school_memberships where user_id = $1", [ids.teacherA]);
    assert.deepEqual(roles.map((row) => row.role), ["teacher"]);
    // Memberships of other people stay hidden from a teacher.
    assert.equal(await count(ids.teacherA, "select 1 from public.school_memberships where user_id <> $1", [ids.teacherA]), 0);
    assert.equal(await count(ids.teacherA, "select 1 from public.classes where id = $1", [ids.classB]), 0);
  });
});
