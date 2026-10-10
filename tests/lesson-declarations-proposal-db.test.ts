// The lesson-declaration PROPOSAL (supabase/proposals, not a migration),
// applied on the real schema in PGlite on top of every migration and of the
// live head: who can declare a lesson (own school, class, subject and the
// class's school year), what is refused (another class, subject or school,
// another teacher's name or lesson, students, the direction), what the
// direction then reads, and that its rollback leaves nothing behind.

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { createMigratedDatabase } from "./helpers/pg";

const PROPOSAL = path.join(__dirname, "..", "supabase", "proposals", "20261010090000_teacher_lesson_declarations.sql");
const ROLLBACK = PROPOSAL.replace(/\.sql$/, ".down.sql");
const LIVE_HEAD = "20261004090000_engine_signed_analyses.sql";
const CALL = "select public.focus_declare_lesson($1, $2, $3::date, $4, $5::uuid[]) as id";

for (const upTo of [undefined, LIVE_HEAD])
  describe(upTo ? "on the live head schema" : "on every migration", () => {
    let db: PGlite;
    const ids = {} as Record<"school" | "other" | "year" | "classA" | "classB" | "math" | "physics" | "teacher" | "outsider" | "student" | "director" | "comp1" | "comp2" | "physicsComp" | "otherComp", string>;
    const one = async (sql: string, params: unknown[] = []) => (await db.query<{ id: string }>(sql, params)).rows[0].id;
    async function as<T = Record<string, unknown>>(userId: string, sql: string, params: unknown[] = []) {
      await db.exec("begin");
      try {
        await db.exec("set local role authenticated");
        await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
        const { rows } = await db.query<T>(sql, params);
        await db.exec("commit");
        return rows;
      } catch (error) {
        await db.exec("rollback");
        throw error;
      }
    }

    before(async () => {
      db = await createMigratedDatabase(upTo ? { upTo } : {});
      await db.exec(readFileSync(PROPOSAL, "utf8"));
      ids.school = await one("insert into public.schools(name) values ('Lycée (fictif)') returning id");
      ids.other = await one("insert into public.schools(name) values ('Autre lycée (fictif)') returning id");
      ids.year = await one("insert into public.academic_years(school_id, name, starts_at, ends_at, active) values ($1, '2026-2027', '2026-09-01', '2027-07-04', true) returning id", [ids.school]);
      ids.classA = await one("insert into public.classes(school_id, academic_year_id, name, level) values ($1, $2, '2nde A', 'Seconde') returning id", [ids.school, ids.year]);
      ids.classB = await one("insert into public.classes(school_id, academic_year_id, name, level) values ($1, $2, '2nde B', 'Seconde') returning id", [ids.school, ids.year]);
      ids.math = await one("insert into public.subjects(school_id, name, code) values ($1, 'Mathématiques', 'MATH') returning id", [ids.school]);
      ids.physics = await one("insert into public.subjects(school_id, name, code) values ($1, 'Physique-chimie', 'PC') returning id", [ids.school]);
      for (const key of ["teacher", "outsider", "student", "director"] as const) ids[key] = await one("insert into auth.users default values returning id");
      for (const [key, role] of [["teacher", "teacher"], ["student", "student"], ["director", "admin"]] as const)
        await db.query("insert into public.school_memberships(school_id, user_id, role) values ($1, $2, $3)", [ids.school, ids[key], role]);
      await db.query("insert into public.school_memberships(school_id, user_id, role) values ($1, $2, 'teacher')", [ids.other, ids.outsider]);
      await db.query("insert into public.teacher_assignments(school_id, teacher_id, class_id, subject_id) values ($1, $2, $3, $4)", [ids.school, ids.teacher, ids.classA, ids.math]);
      ids.comp1 = await one("insert into public.competencies(school_id, subject_id, name) values ($1, $2, 'Calcul littéral') returning id", [ids.school, ids.math]);
      ids.comp2 = await one("insert into public.competencies(school_id, subject_id, name) values ($1, $2, 'Équations') returning id", [ids.school, ids.math]);
      ids.physicsComp = await one("insert into public.competencies(school_id, subject_id, name) values ($1, $2, 'Mesure') returning id", [ids.school, ids.physics]);
      const otherMath = await one("insert into public.subjects(school_id, name, code) values ($1, 'Mathématiques', 'MATH') returning id", [ids.other]);
      ids.otherComp = await one("insert into public.competencies(school_id, subject_id, name) values ($1, $2, 'Autre école') returning id", [ids.other, otherMath]);
    });
    after(async () => {
      await db.close();
    });

    test("an assigned teacher declares a past lesson with référentiel competencies", async () => {
      const [{ id }] = await as<{ id: string }>(ids.teacher, CALL, [ids.classA, ids.math, "2026-09-15", " Distributivité ", [ids.comp1, ids.comp2, ids.comp1]]);
      const lesson = await db.query<{ summary: string; teacher_id: string; school_id: string }>("select summary, teacher_id, school_id from public.lessons where id = $1", [id]);
      assert.deepEqual(lesson.rows[0], { summary: "Distributivité", teacher_id: ids.teacher, school_id: ids.school });
      const links = await db.query<{ n: number }>("select count(*)::int as n from public.lesson_competencies where lesson_id = $1", [id]);
      assert.equal(links.rows[0].n, 2, "duplicates are merged");
      // The direction reads it; the student reads it for their class only if enrolled.
      const read = await as<{ n: number }>(ids.director, "select count(*)::int as n from public.lessons where id = $1", [id]);
      assert.equal(read[0].n, 1);
    });

    test("everything else is refused", async () => {
      const refused = async (userId: string, params: unknown[], pattern: RegExp) =>
        assert.rejects(as(userId, CALL, params), pattern);
      await refused(ids.teacher, [ids.classB, ids.math, "2026-09-15", "Autre classe", [ids.comp1]], /not assigned/);
      await refused(ids.teacher, [ids.classA, ids.physics, "2026-09-15", "Autre matière", [ids.physicsComp]], /not assigned/);
      await refused(ids.outsider, [ids.classA, ids.math, "2026-09-15", "Autre école", [ids.comp1]], /not assigned/);
      await refused(ids.student, [ids.classA, ids.math, "2026-09-15", "Élève", [ids.comp1]], /not assigned/);
      await refused(ids.director, [ids.classA, ids.math, "2026-09-15", "Direction", [ids.comp1]], /not assigned/);
      await refused(ids.teacher, [ids.classA, ids.math, "2099-01-01", "Future", [ids.comp1]], /must have taken place/);
      await refused(ids.teacher, [ids.classA, ids.math, "2026-08-20", "Avant la rentrée", [ids.comp1]], /within the class school year/);
      await refused(ids.teacher, [ids.classA, ids.math, "2026-09-15", "   ", [ids.comp1]], /summary/);
      await refused(ids.teacher, [ids.classA, ids.math, "2026-09-15", "Sans compétence", []], /one to twenty/);
      await refused(ids.teacher, [ids.classA, ids.math, "2026-09-15", "Autre matière", [ids.physicsComp]], /outside the subject/);
      await refused(ids.teacher, [ids.classA, ids.math, "2026-09-15", "Autre école", [ids.otherComp]], /outside the subject/);
      // Direct table writes stay closed.
      await assert.rejects(
        as(ids.teacher, "insert into public.lessons(school_id, class_id, subject_id, teacher_id, date, summary) values ($1, $2, $3, $4, '2026-09-15', 'Direct')", [ids.school, ids.classA, ids.math, ids.teacher]),
        /permission denied/,
      );
      // A disabled teacher membership closes it too.
      await db.query("update public.school_memberships set status = 'disabled' where user_id = $1", [ids.teacher]);
      await refused(ids.teacher, [ids.classA, ids.math, "2026-09-15", "Désactivé", [ids.comp1]], /not assigned/);
      await db.query("update public.school_memberships set status = 'active' where user_id = $1", [ids.teacher]);
      const anon = await db.query<{ granted: boolean }>("select has_function_privilege('anon', 'public.focus_declare_lesson(uuid, uuid, date, text, uuid[])', 'execute') as granted");
      assert.equal(anon.rows[0].granted, false);
    });

    test("an assignment inconsistent with the class's school never opens a declaration", async () => {
      // If such rows ever exist (written by service_role), the class's school
      // decides: an outsider's assignment filed under another school, or a
      // subject of another school, is refused.
      const otherSubject = await one("select id from public.subjects where school_id = $1", [ids.other]);
      for (const [school, teacher, subject] of [[ids.other, ids.outsider, ids.math], [ids.school, ids.teacher, otherSubject]]) {
        let inserted = true;
        await db.query("insert into public.teacher_assignments(school_id, teacher_id, class_id, subject_id) values ($1, $2, $3, $4)", [school, teacher, ids.classA, subject])
          .catch(() => (inserted = false));
        if (inserted)
          await assert.rejects(as(teacher, CALL, [ids.classA, subject, "2026-09-15", "Incohérent", [ids.comp1]]), /not assigned/);
      }
      const leaked = await db.query<{ n: number }>("select count(*)::int as n from public.lessons where summary = 'Incohérent'");
      assert.equal(leaked.rows[0].n, 0);
    });

    test("a lesson is always declared in the caller's own name, and nobody rewrites another teacher's lesson", async () => {
      // The function takes no teacher argument: the declared teacher is always
      // auth.uid().
      const args = await db.query<{ args: string }>("select pg_get_function_identity_arguments('public.focus_declare_lesson'::regproc) as args");
      assert.doesNotMatch(args.rows[0].args, /teacher/);
      // A co-teacher of the same class and subject declares under their own name.
      const coTeacher = await one("insert into auth.users default values returning id");
      await db.query("insert into public.school_memberships(school_id, user_id, role) values ($1, $2, 'teacher')", [ids.school, coTeacher]);
      await db.query("insert into public.teacher_assignments(school_id, teacher_id, class_id, subject_id) values ($1, $2, $3, $4)", [ids.school, coTeacher, ids.classA, ids.math]);
      const [{ id }] = await as<{ id: string }>(coTeacher, CALL, [ids.classA, ids.math, "2026-09-16", "Séance du collègue", [ids.comp1]]);
      const owner = await db.query<{ teacher_id: string }>("select teacher_id from public.lessons where id = $1", [id]);
      assert.equal(owner.rows[0].teacher_id, coTeacher);
      // The first teacher cannot change, delete or re-tag it: table writes stay closed.
      for (const [sql, params] of [
        ["update public.lessons set summary = 'Usurpée', teacher_id = $2 where id = $1", [id, ids.teacher]],
        ["delete from public.lessons where id = $1", [id]],
        ["insert into public.lesson_competencies(lesson_id, competency_id) values ($1, $2)", [id, ids.comp2]],
      ] as const)
        await assert.rejects(as(ids.teacher, sql, [...params]), /permission denied/);
      const after = await db.query<{ summary: string; teacher_id: string }>("select summary, teacher_id from public.lessons where id = $1", [id]);
      assert.deepEqual(after.rows[0], { summary: "Séance du collègue", teacher_id: coTeacher });
    });

    test("only dates inside the class's own school year are accepted, including a past year", async () => {
      // A class of the previous school year (ended 4 July 2026), still assigned.
      const pastYear = await one("insert into public.academic_years(school_id, name, starts_at, ends_at, active) values ($1, '2025-2026', '2025-09-01', '2026-07-04', false) returning id", [ids.school]);
      const pastClass = await one("insert into public.classes(school_id, academic_year_id, name, level) values ($1, $2, '2nde A 2025', 'Seconde') returning id", [ids.school, pastYear]);
      await db.query("insert into public.teacher_assignments(school_id, teacher_id, class_id, subject_id) values ($1, $2, $3, $4)", [ids.school, ids.teacher, pastClass, ids.math]);
      const [{ id }] = await as<{ id: string }>(ids.teacher, CALL, [pastClass, ids.math, "2026-03-10", "Séance de l'an dernier", [ids.comp1]]);
      assert.ok(id);
      await assert.rejects(as(ids.teacher, CALL, [pastClass, ids.math, "2026-09-15", "Après la fin de l'année", [ids.comp1]]), /within the class school year/);
      await assert.rejects(as(ids.teacher, CALL, [pastClass, ids.math, "2025-08-31", "Avant le début de l'année", [ids.comp1]]), /within the class school year/);
    });

    test("the rollback removes the function", async () => {
      await db.exec(readFileSync(ROLLBACK, "utf8"));
      const left = await db.query<{ n: number }>("select count(*)::int as n from pg_proc where proname = 'focus_declare_lesson'");
      assert.equal(left.rows[0].n, 0);
    });
  });
