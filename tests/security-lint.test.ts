// The Supabase advisors' checks, on the replica with every migration applied:
// what the live project reported must stay fixed, and new objects must not
// reintroduce it.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { createMigratedDatabase, seedSchoolFixture, type SchoolFixtureIds } from "./helpers/pg";

let db: PGlite;
let ids: SchoolFixtureIds;
before(async () => {
  db = await createMigratedDatabase();
  ids = await seedSchoolFixture(db);
});
after(async () => {
  await db.close();
});

const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
// Extension objects (pgcrypto lives in public in the test database only).
const NOT_EXTENSION = "not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')";

test("every public table has RLS and grants nothing to anon", async () => {
  assert.deepEqual(
    await rows(`select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity`),
    [],
  );
  assert.deepEqual(
    await rows(`
      select c.relname, privilege
      from pg_class c, unnest(array['select', 'insert', 'update', 'delete']) as privilege
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and has_table_privilege('anon', c.oid, privilege)`),
    [],
  );
});

test("no SECURITY DEFINER function is executable by anon, and each pins its search_path", async () => {
  assert.deepEqual(
    await rows(`
      select p.proname from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.prosecdef and ${NOT_EXTENSION}
        and has_function_privilege('anon', p.oid, 'execute')`),
    [],
  );
  assert.deepEqual(
    await rows(`
      select p.proname from pg_proc p
      where p.pronamespace = 'public'::regnamespace and ${NOT_EXTENSION}
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`),
    [],
  );
});

test("policies evaluate auth.uid() once per statement", async () => {
  const policies = await rows<{ tablename: string; policyname: string; expression: string }>(`
    select tablename, policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '') as expression
    from pg_policies where schemaname = 'public'`);
  const perRow = policies.filter((policy) => /(?<!SELECT )auth\.(uid|jwt|role)\(\)/.test(policy.expression));
  assert.deepEqual(perRow.map((policy) => `${policy.tablename}.${policy.policyname}`), []);
  assert.ok(policies.length >= 100, "the policies are still there");
});

test("every foreign key has a covering index", async () => {
  assert.deepEqual(
    await rows(`
      select c.conrelid::regclass::text as t, c.conname
      from pg_constraint c
      where c.contype = 'f' and c.connamespace = 'public'::regnamespace
        and not exists (
          select 1 from pg_index i
          where i.indrelid = c.conrelid
            and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] @> c.conkey
            and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] <@ c.conkey)`),
    [],
  );
});

test("anon is refused; a signed-in teacher still reads exactly their own rows", async () => {
  await db.exec("begin");
  try {
    await db.exec("set local role anon");
    await assert.rejects(db.query("select 1 from public.profiles"), /permission denied/);
  } finally {
    await db.exec("rollback");
  }
  await db.exec("begin");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [ids.teacher]);
    const assignments = await rows<{ teacher_id: string }>("select teacher_id from public.teacher_assignments");
    assert.ok(assignments.length > 0);
    assert.ok(assignments.every((row) => row.teacher_id === ids.teacher));
    const [{ n }] = await rows<{ n: number }>("select count(*)::int as n from public.student_enrollments");
    assert.equal(n, ids.students.length);
  } finally {
    await db.exec("rollback");
  }
});
