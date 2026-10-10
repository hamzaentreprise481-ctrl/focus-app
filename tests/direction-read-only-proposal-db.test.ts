// The Direction read-only PROPOSAL (supabase/proposals, not a migration),
// applied on the real schema in PGlite on top of every migration and of the
// live head. The same write attempts run for the direction (role 'admin') and
// for the assessment's teacher, each inside a transaction that is rolled
// back, so every attempt starts from the same data:
//   - without the proposal the admin role writes official data and can
//     promote itself to teacher (the hole this proposal closes);
//   - with it the admin cannot, the teacher still can, the admin still
//     manages the other accounts of the school and reads exactly what it read,
//     a student gains nothing, and school A's direction and school B's never
//     reach each other's school;
//   - its rollback restores the previous behaviour.

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { createMigratedDatabase, seedSchoolFixture } from "./helpers/pg";

const PROPOSAL = path.join(__dirname, "..", "supabase", "proposals", "20261010100000_direction_read_only_official_data.sql");
const ROLLBACK = PROPOSAL.replace(/\.sql$/, ".down.sql");
const LIVE_HEAD = "20261004090000_engine_signed_analyses.sql";

type Ids = Record<
  "school" | "year" | "classId" | "subject" | "teacher" | "director" | "colleague" | "student" | "student2" | "comp1" | "comp2" |
  "assessment" | "result" | "level" | "question" | "response" | "notion1" | "notion2" |
  "schoolB" | "classB" | "subjectB" | "teacherB" | "studentB" | "directorB" | "assessmentB" | "resultB",
  string
>;

/** Official pedagogical data: [name, sql]; $1 is the acting user. */
function officialWrites(ids: Ids): Array<[string, string, unknown[]]> {
  return [
    ["update assessment", "update public.assessments set title = title || ' (modifié)' where id = $2 returning 1", [ids.assessment]],
    ["delete assessment", "delete from public.assessments where id = $2 returning 1", [ids.assessment]],
    ["insert result", "insert into public.assessment_results(assessment_id, student_id, score, absent) values ($2, $3, 20, false) returning 1", [ids.assessment, ids.student2]],
    ["update result", "update public.assessment_results set score = 20 where id = $2 returning 1", [ids.result]],
    ["delete result", "delete from public.assessment_results where id = $2 returning 1", [ids.result]],
    ["insert level", "insert into public.competency_results(assessment_result_id, competency_id, mastery_level) values ($2, $3, 'mastered') returning 1", [ids.result, ids.comp2]],
    ["update level", "update public.competency_results set mastery_level = 'mastered' where id = $2 returning 1", [ids.level]],
    ["delete level", "delete from public.competency_results where id = $2 returning 1", [ids.level]],
    ["insert answer", "insert into public.student_responses(assessment_id, question_id, student_id, response_text) values ($2, $3, $4, 'Réponse forgée') returning 1", [ids.assessment, ids.question, ids.student2]],
    ["update answer", "update public.student_responses set response_text = 'Réponse forgée' where id = $2 returning 1", [ids.response]],
    ["delete answer", "delete from public.student_responses where id = $2 returning 1", [ids.response]],
    ["insert question", "insert into public.assessment_questions(assessment_id, position, prompt, correction_text, rubric, max_points) values ($2, 2, 'Question forgée', 'Corrigé forgé', '{}'::jsonb, 2) returning 1", [ids.assessment]],
    ["update correction", "update public.assessment_questions set correction_text = 'Corrigé forgé' where id = $2 returning 1", [ids.question]],
    ["delete question", "delete from public.assessment_questions where id = $2 returning 1", [ids.question]],
    ["insert subject file", "insert into public.assessment_materials(assessment_id, updated_by) values ($2, $1) returning 1", [ids.assessment]],
    ["insert question notion", "insert into public.question_curriculum_nodes(question_id, curriculum_node_id, relation) values ($2, $3, 'assesses') returning 1", [ids.question, ids.notion2]],
    ["delete question notion", "delete from public.question_curriculum_nodes where question_id = $2 and curriculum_node_id = $3 returning 1", [ids.question, ids.notion1]],
  ];
}

/** Writes about the acting account itself. */
function selfEscalation(ids: Ids): Array<[string, string, unknown[]]> {
  return [
    ["own teacher membership", "insert into public.school_memberships(school_id, user_id, role) values ($2, $1, 'teacher') returning 1", [ids.school]],
    ["own assignment", "insert into public.teacher_assignments(school_id, teacher_id, class_id, subject_id) values ($2, $1, $3, $4) returning 1", [ids.school, ids.classId, ids.subject]],
    ["own membership role", "update public.school_memberships set role = 'teacher' where user_id = $1 returning 1", []],
    ["take over a colleague's membership", "update public.school_memberships set user_id = $1 where user_id = $2 returning 1", [ids.teacher]],
  ];
}

/** Writes by school A's direction into school B. */
function intoOtherSchool(ids: Ids): Array<[string, string, unknown[]]> {
  return [
    ["update B's assessment", "update public.assessments set title = 'Forgé' where id = $2 returning 1", [ids.assessmentB]],
    ["update B's result", "update public.assessment_results set score = 20 where id = $2 returning 1", [ids.resultB]],
    ["delete B's result", "delete from public.assessment_results where id = $2 returning 1", [ids.resultB]],
    ["own membership in B", "insert into public.school_memberships(school_id, user_id, role) values ($2, $1, 'admin') returning 1", [ids.schoolB]],
    ["colleague membership in B", "insert into public.school_memberships(school_id, user_id, role) values ($2, $3, 'teacher') returning 1", [ids.schoolB, ids.colleague]],
    ["colleague assignment in B", "insert into public.teacher_assignments(school_id, teacher_id, class_id, subject_id) values ($2, $3, $4, $5) returning 1", [ids.schoolB, ids.colleague, ids.classB, ids.subjectB]],
    ["disable B's teacher", "update public.school_memberships set status = 'disabled' where user_id = $2 returning 1", [ids.teacherB]],
  ];
}

/** School administration of OTHER accounts, kept by the proposal. */
function administration(ids: Ids): Array<[string, string, unknown[]]> {
  return [
    ["colleague membership", "insert into public.school_memberships(school_id, user_id, role) values ($2, $3, 'teacher') returning 1", [ids.school, ids.colleague]],
    ["colleague assignment", "insert into public.teacher_assignments(school_id, teacher_id, class_id, subject_id) values ($2, $3, $4, $5) returning 1", [ids.school, ids.colleague, ids.classId, ids.subject]],
    ["disable a student", "update public.school_memberships set status = 'disabled' where user_id = $2 returning 1", [ids.student2]],
  ];
}

for (const upTo of [undefined, LIVE_HEAD])
  describe(upTo ? "on the live head schema" : "on every migration", () => {
    let db: PGlite;
    const ids = {} as Ids;
    const one = async (sql: string, params: unknown[] = []) => (await db.query<{ id: string }>(sql, params)).rows[0].id;

    /** Runs one write as `userId` and rolls it back: true when it took effect. */
    async function took(userId: string, sql: string, params: unknown[]) {
      await db.exec("begin");
      try {
        await db.exec("set local role authenticated");
        await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
        // $1 is always bound to the acting user; statements that do not use it
        // return it so its type is known.
        const text = sql.includes("$1") ? sql : sql.replace(/returning 1$/, "returning 1, $1::uuid");
        return (await db.query(text, [userId, ...params])).rows.length > 0;
      } catch (error) {
        if (!/row-level security|permission denied/.test(String(error))) throw error;
        return false;
      } finally {
        await db.exec("rollback");
      }
    }
    async function outcomes(userId: string, writes: Array<[string, string, unknown[]]>) {
      const result: Record<string, boolean> = {};
      for (const [name, sql, params] of writes) result[name] = await took(userId, sql, params);
      return result;
    }
    let restrictiveBefore = 0;
    const restrictivePolicies = async () =>
      (await db.query<{ n: number }>("select count(*)::int as n from pg_policies where schemaname = 'public' and permissive = 'RESTRICTIVE'")).rows[0].n;
    const all = (writes: Array<[string, string, unknown[]]>, value: boolean) =>
      Object.fromEntries(writes.map(([name]) => [name, value]));

    /** What `userId` reads under RLS: per-table counts, and rows of `foreignSchool`. */
    async function reads(userId: string, foreignSchool: string) {
      await db.exec("begin");
      try {
        await db.exec("set local role authenticated");
        await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
        const { rows } = await db.query<Record<string, number>>(
          `select (select count(*) from public.assessments)::int as assessments,
                  (select count(*) from public.assessment_results)::int as results,
                  (select count(*) from public.competency_results)::int as levels,
                  (select count(*) from public.student_responses)::int as answers,
                  (select count(*) from public.classes)::int as classes,
                  (select count(*) from public.student_enrollments)::int as enrollments,
                  (select count(*) from public.school_memberships)::int as memberships,
                  (select count(*) from public.teacher_assignments)::int as assignments,
                  ((select count(*) from public.assessments where school_id = $1)
                   + (select count(*) from public.assessment_results r join public.assessments a on a.id = r.assessment_id where a.school_id = $1)
                   + (select count(*) from public.classes where school_id = $1)
                   + (select count(*) from public.student_enrollments where school_id = $1)
                   + (select count(*) from public.school_memberships where school_id = $1)
                   + (select count(*) from public.teacher_assignments where school_id = $1)
                   + (select count(*) from public.schools where id = $1))::int as foreign_rows`,
          [foreignSchool],
        );
        return rows[0];
      } finally {
        await db.exec("rollback");
      }
    }
    let directorReadsBefore: Record<string, number>;

    before(async () => {
      db = await createMigratedDatabase(upTo ? { upTo } : {});
      const school = await seedSchoolFixture(db);
      Object.assign(ids, { school: school.school, year: school.year, classId: school.classId, subject: school.subject, teacher: school.teacher });
      [ids.student, ids.student2] = school.students;
      for (const key of ["director", "colleague"] as const) ids[key] = await one("insert into auth.users default values returning id");
      await db.query("insert into public.school_memberships(school_id, user_id, role) values ($1, $2, 'admin')", [ids.school, ids.director]);
      ids.comp1 = await one("insert into public.competencies(school_id, subject_id, name) values ($1, $2, 'Calcul littéral') returning id", [ids.school, ids.subject]);
      ids.comp2 = await one("insert into public.competencies(school_id, subject_id, name) values ($1, $2, 'Équations') returning id", [ids.school, ids.subject]);
      ids.assessment = await one(
        "insert into public.assessments(school_id, class_id, subject_id, teacher_id, title, date) values ($1, $2, $3, $4, 'Contrôle (fictif)', '2026-09-20') returning id",
        [ids.school, ids.classId, ids.subject, ids.teacher],
      );
      await db.query("insert into public.assessment_competencies(assessment_id, competency_id) values ($1, $2), ($1, $3)", [ids.assessment, ids.comp1, ids.comp2]);
      ids.result = await one("insert into public.assessment_results(assessment_id, student_id, score, absent) values ($1, $2, 11, false) returning id", [ids.assessment, ids.student]);
      ids.level = await one("insert into public.competency_results(assessment_result_id, competency_id, mastery_level) values ($1, $2, 'fragile') returning id", [ids.result, ids.comp1]);
      ids.question = await one(
        "insert into public.assessment_questions(assessment_id, position, prompt, correction_text, rubric, max_points) values ($1, 1, 'Développer (x + 2)(x + 3)', 'x² + 5x + 6', '{}'::jsonb, 2) returning id",
        [ids.assessment],
      );
      ids.response = await one(
        "insert into public.student_responses(assessment_id, question_id, student_id, response_text, awarded_points) values ($1, $2, $3, 'x² + 6', 0.5) returning id",
        [ids.assessment, ids.question, ids.student],
      );
      const notions = await db.query<{ id: string }>(
        "select n.id from public.curriculum_nodes n join public.curriculum_sources s on s.id = n.source_id where s.subject_code = 'MATH' and n.active and n.node_type = 'notion' order by n.code limit 2",
      );
      [ids.notion1, ids.notion2] = notions.rows.map((row) => row.id);
      await db.query("insert into public.question_curriculum_nodes(question_id, curriculum_node_id, relation) values ($1, $2, 'assesses')", [ids.question, ids.notion1]);
      // School B, with its own direction, teacher, student and results.
      ids.schoolB = await one("insert into public.schools(name) values ('Collège B (fictif)') returning id");
      const yearB = await one("insert into public.academic_years(school_id, name, starts_at, ends_at, active) values ($1, '2026-2027', '2026-09-01', '2027-07-04', true) returning id", [ids.schoolB]);
      ids.classB = await one("insert into public.classes(school_id, academic_year_id, name, level) values ($1, $2, '3e B', 'Troisième') returning id", [ids.schoolB, yearB]);
      ids.subjectB = await one("insert into public.subjects(school_id, name, code) values ($1, 'Mathématiques', 'MATH') returning id", [ids.schoolB]);
      for (const key of ["teacherB", "studentB", "directorB"] as const) ids[key] = await one("insert into auth.users default values returning id");
      await db.query("insert into public.school_memberships(school_id, user_id, role) values ($1, $2, 'teacher'), ($1, $3, 'student'), ($1, $4, 'admin')", [ids.schoolB, ids.teacherB, ids.studentB, ids.directorB]);
      await db.query("insert into public.teacher_assignments(school_id, teacher_id, class_id, subject_id) values ($1, $2, $3, $4)", [ids.schoolB, ids.teacherB, ids.classB, ids.subjectB]);
      await db.query("insert into public.student_enrollments(school_id, student_id, class_id, academic_year_id) values ($1, $2, $3, $4)", [ids.schoolB, ids.studentB, ids.classB, yearB]);
      ids.assessmentB = await one(
        "insert into public.assessments(school_id, class_id, subject_id, teacher_id, title, date) values ($1, $2, $3, $4, 'Contrôle B (fictif)', '2026-09-21') returning id",
        [ids.schoolB, ids.classB, ids.subjectB, ids.teacherB],
      );
      ids.resultB = await one("insert into public.assessment_results(assessment_id, student_id, score, absent) values ($1, $2, 9, false) returning id", [ids.assessmentB, ids.studentB]);
      restrictiveBefore = await restrictivePolicies();
    });
    after(async () => {
      await db.close();
    });

    test("without the proposal, the admin role writes official data and can promote itself", async () => {
      const official = await outcomes(ids.director, officialWrites(ids));
      for (const name of ["update assessment", "delete assessment", "update result", "delete result", "update level", "delete level", "update answer", "update correction", "delete question"])
        assert.equal(official[name], true, `admin cannot "${name}" today: the baseline changed`);
      assert.deepEqual(await outcomes(ids.director, selfEscalation(ids)), all(selfEscalation(ids), true));
      directorReadsBefore = await reads(ids.director, ids.schoolB);
      assert.ok(Object.entries(directorReadsBefore).every(([table, n]) => table === "foreign_rows" || n > 0), JSON.stringify(directorReadsBefore));
    });

    test("with the proposal, the direction writes no official data and cannot promote itself", async () => {
      await db.exec(readFileSync(PROPOSAL, "utf8"));
      assert.equal(await restrictivePolicies(), restrictiveBefore + 26);
      assert.deepEqual(await outcomes(ids.director, officialWrites(ids)), all(officialWrites(ids), false));
      assert.deepEqual(await outcomes(ids.director, selfEscalation(ids)), all(selfEscalation(ids), false));
      // Not by taking over a colleague's assignment either (no update path).
      assert.equal(await took(ids.director, "update public.teacher_assignments set teacher_id = $1 where teacher_id = $2 returning 1", [ids.teacher]), false);
      // Reading is unchanged: the direction sees exactly what it saw before.
      assert.deepEqual(await reads(ids.director, ids.schoolB), directorReadsBefore);
    });

    test("with the proposal, the assessment's teacher keeps every write and the direction administers other accounts", async () => {
      assert.deepEqual(await outcomes(ids.teacher, officialWrites(ids)), all(officialWrites(ids), true));
      assert.deepEqual(await outcomes(ids.director, administration(ids)), all(administration(ids), true));
      // A student gains nothing: no official data, no membership, no assignment.
      assert.deepEqual(await outcomes(ids.student, officialWrites(ids)), all(officialWrites(ids), false));
      assert.deepEqual(await outcomes(ids.student, selfEscalation(ids)), all(selfEscalation(ids), false));
      assert.deepEqual(await outcomes(ids.student, administration(ids)), all(administration(ids), false));
    });

    test("with the proposal, school A's direction never reads or writes school B, and B never A", async () => {
      assert.equal((await reads(ids.director, ids.schoolB)).foreign_rows, 0);
      assert.deepEqual(await outcomes(ids.director, intoOtherSchool(ids)), all(intoOtherSchool(ids), false));
      const readsB = await reads(ids.directorB, ids.school);
      assert.equal(readsB.foreign_rows, 0);
      assert.equal(readsB.assessments, 1, "B's direction still reads its own school");
      assert.deepEqual(await outcomes(ids.directorB, officialWrites(ids)), all(officialWrites(ids), false));
      assert.deepEqual(await outcomes(ids.directorB, administration(ids)), all(administration(ids), false));
    });

    test("the rollback restores the previous behaviour", async () => {
      await db.exec(readFileSync(ROLLBACK, "utf8"));
      assert.equal(await restrictivePolicies(), restrictiveBefore);
      assert.equal(await took(ids.director, "update public.assessment_results set score = 20 where id = $2 returning 1", [ids.result]), true);
    });
  });
