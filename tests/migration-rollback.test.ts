// Every migration not yet applied live has a rollback that restores the
// previous schema object for object: same fingerprint (functions and their
// grants, tables with columns, constraints, indexes, triggers and grants, RLS
// policies, types), same default privileges, no schema left behind. Without
// that proof a migration is not reversible.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { createMigratedDatabase } from "./helpers/pg";

const ROOT = path.join(__dirname, "..");
const FINGERPRINT = readFileSync(path.join(ROOT, "scripts", "schema-fingerprint.sql"), "utf8");

async function fingerprint(db: PGlite) {
  const { rows } = await db.query<{ object: string; hash: string }>(FINGERPRINT);
  const { rows: defaults } = await db.query<{ acl: string }>(
    "select defaclrole::regrole::text || ':' || defaclnamespace::regnamespace::text || ':' || defaclobjtype::text || ':' || defaclacl::text as acl from pg_default_acl order by 1",
  );
  const { rows: schemas } = await db.query<{ name: string }>(
    "select nspname as name from pg_namespace where nspname not like 'pg\\_%' and nspname <> 'information_schema' order by 1",
  );
  return [
    ...rows.map((row) => `${row.object}\t${row.hash}`),
    ...defaults.map((row) => `default ${row.acl}`),
    ...schemas.map((row) => `schema ${row.name}`),
  ];
}

for (const [previous, migration] of [
  ["20260927100000_ai_usage_events", "20261002120000_access_integrity_hardening"],
  ["20261002120000_access_integrity_hardening", "20261004090000_engine_signed_analyses"],
  ["20261004090000_engine_signed_analyses", "20261007090000_active_teacher_membership"],
] as const) {
  test(`${migration} can be rolled back to the exact schema of ${previous.slice(0, 14)}`, async () => {
    const db = await createMigratedDatabase({ upTo: `${previous}.sql` });
    try {
      const before = await fingerprint(db);
      await db.exec(readFileSync(path.join(ROOT, "supabase", "migrations", `${migration}.sql`), "utf8"));
      const applied = await fingerprint(db);
      assert.notDeepEqual(applied, before, "the migration changes the schema");

      await db.exec(readFileSync(path.join(ROOT, "supabase", "rollback", `${migration}.down.sql`), "utf8"));
      const after = await fingerprint(db);
      assert.deepEqual(after.filter((line) => !before.includes(line)), [], "objects that differ after the rollback");
      assert.deepEqual(before.filter((line) => !after.includes(line)), [], "objects missing after the rollback");

      // And the migration applies again on top of its rollback.
      await db.exec(readFileSync(path.join(ROOT, "supabase", "migrations", `${migration}.sql`), "utf8"));
      assert.deepEqual(await fingerprint(db), applied);
    } finally {
      await db.close();
    }
  });
}
