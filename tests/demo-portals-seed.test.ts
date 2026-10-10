// The demonstration school written by scripts/admin-create-demo-portals.ts,
// replayed on the real schema (PGlite) as service_role — on every migration
// and on the live head — then read back under RLS as the demo student and
// the demo direction. Proves the inserts satisfy every constraint and
// trigger, that the plan is fictitious, and that no other school changes.

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { createMigratedDatabase, seedSchoolFixture } from "./helpers/pg";
import { DEMO_EMAIL_DOMAIN, DEMO_SCHOOL_NAME, demoPlan } from "../scripts/demo-portals/plan";
import { seedDemoPortals, type DemoWriter } from "../scripts/demo-portals/seed";

const LIVE_HEAD = "20261004090000_engine_signed_analyses.sql";
const TODAY = "2026-10-12";

test("the demonstration plan is fictitious and only the student logs in unless the direction login is asked for", () => {
  assert.deepEqual(demoPlan(TODAY).people.filter((person) => person.login).map((person) => person.role), ["student"]);
  const plan = demoPlan(TODAY, { directionLogin: true });
  assert.equal(plan.school, DEMO_SCHOOL_NAME);
  assert.match(plan.school, /\(fictif\)/);
  assert.ok(plan.people.every((person) => person.email.endsWith(`@${DEMO_EMAIL_DOMAIN}`) && /\.invalid$/.test(person.email)));
  assert.deepEqual(plan.people.filter((person) => person.login).map((person) => person.role).sort(), ["admin", "student"]);
  assert.ok(plan.people.every((person) => /Démo/.test(person.lastName)));
  // Every date is in the current school year and not in the future.
  for (const date of [...plan.assessments.map((row) => row.date), ...plan.lessons.map((row) => row.date)])
    assert.ok(date >= plan.year.startsAt && date <= TODAY, date);
  assert.deepEqual(demoPlan(TODAY, { directionLogin: true }), demoPlan(TODAY, { directionLogin: true }));
});

for (const upTo of [undefined, LIVE_HEAD])
  describe(upTo ? "seeded on the live head schema" : "seeded on every migration", () => {
    let db: PGlite;
    let result: Awaited<ReturnType<typeof seedDemoPortals>>;
    let otherSchoolBefore: string;

    const asRole = async <T>(role: "service_role" | "authenticated", userId: string | null, sql: string, params: unknown[] = []) => {
      await db.exec("begin");
      try {
        await db.exec(`set local role ${role}`);
        if (userId) await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
        const { rows } = await db.query<T>(sql, params);
        await db.exec("commit");
        return rows;
      } catch (error) {
        await db.exec("rollback");
        throw error;
      }
    };
    const fingerprint = async (school: string) =>
      (
        await db.query<{ v: string }>(
          `select concat_ws('|', (select count(*) from public.classes where school_id = $1),
             (select count(*) from public.assessments where school_id = $1),
             (select count(*) from public.assessment_results r join public.assessments a on a.id = r.assessment_id where a.school_id = $1),
             (select string_agg(coalesce(r.score::text, '') || coalesce(r.teacher_comment, ''), ',' order by r.id) from public.assessment_results r join public.assessments a on a.id = r.assessment_id where a.school_id = $1),
             (select count(*) from public.school_memberships where school_id = $1)) as v`,
          [school],
        )
      ).rows[0].v;

    const writer = (): DemoWriter => ({
      async insert(table, rows, returning = "id") {
        const out: never[] = [];
        for (const row of rows) {
          const columns = Object.keys(row);
          const values = columns.map((column) => {
            const value = row[column];
            return value !== null && typeof value === "object" ? JSON.stringify(value) : value;
          });
          out.push(
            ...(await asRole<never>(
              "service_role",
              null,
              `insert into public.${table}(${columns.join(", ")}) values (${columns.map((_, index) => `$${index + 1}`).join(", ")}) returning ${returning}`,
              values,
            )),
          );
        }
        return out;
      },
      async select(table, columns, equals, options = {}) {
        const keys = Object.keys(equals);
        const where = keys.length ? ` where ${keys.map((key, index) => `${key} = $${index + 1}`).join(" and ")}` : "";
        const order = options.orderBy ? ` order by ${options.orderBy}` : "";
        const limit = options.limit ? ` limit ${Number(options.limit)}` : "";
        return asRole("service_role", null, `select ${columns} from public.${table}${where}${order}${limit}`, Object.values(equals));
      },
      async createUser(person) {
        const { rows } = await db.query<{ id: string }>(
          "insert into auth.users(email, raw_app_meta_data, raw_user_meta_data) values ($1, $2, $3) returning id",
          [person.email, JSON.stringify({ focus_demo: true }), JSON.stringify({ first_name: person.firstName, last_name: person.lastName })],
        );
        return rows[0].id;
      },
    });

    before(async () => {
      db = await createMigratedDatabase(upTo ? { upTo } : {});
      // A pre-existing school that must stay untouched.
      const other = await seedSchoolFixture(db);
      otherSchoolBefore = await fingerprint(other.school);
      result = await seedDemoPortals(writer(), demoPlan(TODAY, { directionLogin: true }));
      (result as unknown as { otherSchool: string }).otherSchool = other.school;
    });
    after(async () => {
      await db.close();
    });

    test("with --with-direction-login, only the student and the direction get a login, with a strong one-time password", () => {
      assert.deepEqual(result.logins.map((login) => [login.space, login.path]), [
        ["Student", "/connexion-eleve"],
        ["Direction", "/connexion-direction"],
      ]);
      assert.ok(result.logins.every((login) => login.password.length >= 24 && login.email.endsWith(".invalid")));
    });

    test("the demo student reads their own results, answers and levels — not student B's", async () => {
      const student = result.userIds.studentA;
      const results = await asRole<{ score: string; teacher_comment: string }>("authenticated", student, "select score, teacher_comment from public.assessment_results order by score");
      assert.deepEqual(results.map((row) => Number(row.score)), [9, 11, 14]);
      assert.ok(results.every((row) => !/élève B/.test(row.teacher_comment)));
      const answers = await asRole<{ response_text: string }>("authenticated", student, "select response_text from public.student_responses");
      assert.equal(answers.length, 5);
      assert.ok(!answers.some((row) => row.response_text === "x² + 5x + 6"));
      const levels = await asRole<{ n: number }>("authenticated", student, "select count(*)::int as n from public.competency_results");
      assert.equal(levels[0].n, 3);
      const other = await asRole<{ n: number }>("authenticated", student, "select count(*)::int as n from public.assessment_results where student_id = $1", [result.userIds.studentB]);
      assert.equal(other[0].n, 0);
    });

    test("the demo direction reads the demo school only", async () => {
      const director = result.userIds.director;
      const counts = await asRole<{ classes: number; enrollments: number; assessments: number; results: number; lessons: number }>(
        "authenticated",
        director,
        `select (select count(*)::int from public.classes) as classes,
                (select count(*)::int from public.student_enrollments) as enrollments,
                (select count(*)::int from public.assessments) as assessments,
                (select count(*)::int from public.assessment_results) as results,
                (select count(*)::int from public.lessons) as lessons`,
      );
      assert.deepEqual(counts[0], { classes: 1, enrollments: 2, assessments: 3, results: 6, lessons: 3 });
      const tagged = await asRole<{ n: number }>("authenticated", director, "select count(*)::int as n from public.question_curriculum_nodes");
      assert.equal(tagged[0].n, 3, "one official notion per assessment");
    });

    test("nothing else changes, and a second run writes nothing", async () => {
      const other = (result as unknown as { otherSchool: string }).otherSchool;
      assert.equal(await fingerprint(other), otherSchoolBefore);
      const before = await fingerprint(result.schoolId);
      await assert.rejects(seedDemoPortals(writer(), demoPlan(TODAY, { directionLogin: true })), /already exists: nothing was written/);
      assert.equal(await fingerprint(result.schoolId), before);
      const schools = await db.query<{ n: number }>("select count(*)::int as n from public.schools where name = $1", [DEMO_SCHOOL_NAME]);
      assert.equal(schools.rows[0].n, 1);
    });
  });
