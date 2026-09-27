// supabase/staging/verify.sql, the check to run on a real staging database,
// is itself checked here: it passes on a replica built with the live
// identifiers and every migration, and fails when something is off.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { BEFORE_WORK_IMPORT, createMigratedDatabase, migrationFiles } from "./helpers/pg";
import { LIVE, useLiveIdentifiers as applyLiveIdentifiers } from "./helpers/work-curriculum";

const VERIFY = readFileSync(path.join(__dirname, "..", "supabase", "staging", "verify.sql"), "utf8");

async function stagingReplica() {
  const db = await createMigratedDatabase({ upTo: BEFORE_WORK_IMPORT, recordVersions: true });
  await applyLiveIdentifiers(db);
  for (const file of migrationFiles().filter((name) => path.basename(name) > BEFORE_WORK_IMPORT)) {
    await db.exec(readFileSync(file, "utf8"));
    await db.query("insert into supabase_migrations.schema_migrations(version) values ($1)", [path.basename(file).slice(0, 14)]);
  }
  return db;
}
const verify = (db: PGlite) => db.exec(VERIFY);

test("the verification script embeds exactly the 44 live identifiers", () => {
  for (const node of LIVE.nodes) assert.ok(VERIFY.includes(`('${node.code}', '${node.id}'::uuid)`), node.code);
  assert.equal((VERIFY.match(/'::uuid\)/g) ?? []).length, 44);
});

test("staging verification passes on a live-identifier replica with every migration", async () => {
  const db = await stagingReplica();
  try {
    await verify(db);
  } finally {
    await db.close();
  }
});

test("staging verification fails on a changed UUID, a missing migration or an anon grant", async () => {
  const db = await stagingReplica();
  try {
    const cases: Array<[string, string, RegExp]> = [
      ["update public.curriculum_nodes set active = false where code = 'MATH.ALG.DISTRIBUTIVITE'", "", /live curriculum identifiers changed or inactive: MATH\.ALG\.DISTRIBUTIVITE/],
      ["delete from supabase_migrations.schema_migrations where version = '20260927100000'", "", /schema version is 20260927090000/],
      ["grant select on public.profiles to anon", "", /anon has privileges on: profiles/],
      ["update public.curriculum_typical_errors set active = false where code = (select min(code) from public.curriculum_typical_errors)", "", /expected 99 typical errors, found 98/],
    ];
    for (const [change, , message] of cases) {
      await db.exec("begin");
      try {
        await db.exec(change);
        await assert.rejects(verify(db), message, change);
      } finally {
        await db.exec("rollback");
      }
    }
  } finally {
    await db.close();
  }
});

test("the fictitious staging seed builds two isolated teachers, idempotently", async () => {
  const db = await stagingReplica();
  try {
    await db.exec("insert into auth.users(email) values ('teacher-a@example.test'), ('teacher-b@example.test')");
    const seed = readFileSync(path.join(__dirname, "..", "supabase", "staging", "seed-fictitious.sql"), "utf8");
    await db.exec(seed);
    await db.exec(seed);
    const { rows } = await db.query<{ email: string; role: string; classes: number; students: number }>(`
      select u.email, u.raw_app_meta_data->>'role' as role, count(distinct ta.class_id)::int as classes, count(se.student_id)::int as students
      from auth.users u
      join public.teacher_assignments ta on ta.teacher_id = u.id
      join public.student_enrollments se on se.class_id = ta.class_id
      where u.email like 'teacher-_@example.test' group by u.email, u.raw_app_meta_data->>'role' order by u.email`);
    assert.deepEqual(rows, [
      { email: "teacher-a@example.test", role: "teacher", classes: 1, students: 3 },
      { email: "teacher-b@example.test", role: "teacher", classes: 1, students: 3 },
    ]);
    // Seeding does not break the staging verification.
    await verify(db);
  } finally {
    await db.close();
  }
});
