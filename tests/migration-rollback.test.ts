// The rollback of 20261002120000 restores the previous schema object for
// object: same fingerprint (functions and their grants, tables with columns,
// constraints, indexes, triggers and grants, RLS policies, types) and same
// default privileges. Without that proof the migration is not reversible.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { createMigratedDatabase } from "./helpers/pg";

const ROOT = path.join(__dirname, "..");
const MIGRATION = "20261002120000_access_integrity_hardening";
const FINGERPRINT = readFileSync(path.join(ROOT, "scripts", "schema-fingerprint.sql"), "utf8");

async function fingerprint(db: PGlite) {
  const { rows } = await db.query<{ object: string; hash: string }>(FINGERPRINT);
  const { rows: defaults } = await db.query<{ acl: string }>(
    "select defaclrole::regrole::text || ':' || defaclnamespace::regnamespace::text || ':' || defaclobjtype::text || ':' || defaclacl::text as acl from pg_default_acl order by 1",
  );
  return [...rows.map((row) => `${row.object}\t${row.hash}`), ...defaults.map((row) => `default ${row.acl}`)];
}

test("the hardening migration can be rolled back to the exact previous schema", async () => {
  const db = await createMigratedDatabase({ upTo: "20260927100000_ai_usage_events.sql" });
  try {
    const before = await fingerprint(db);
    await db.exec(readFileSync(path.join(ROOT, "supabase", "migrations", `${MIGRATION}.sql`), "utf8"));
    const applied = await fingerprint(db);
    assert.notDeepEqual(applied, before, "the migration changes the schema");

    await db.exec(readFileSync(path.join(ROOT, "supabase", "rollback", `${MIGRATION}.down.sql`), "utf8"));
    const after = await fingerprint(db);
    assert.deepEqual(after.filter((line) => !before.includes(line)), [], "objects that differ after the rollback");
    assert.deepEqual(before.filter((line) => !after.includes(line)), [], "objects missing after the rollback");

    // And the migration applies again on top of its rollback.
    await db.exec(readFileSync(path.join(ROOT, "supabase", "migrations", `${MIGRATION}.sql`), "utf8"));
    assert.deepEqual(await fingerprint(db), applied);
  } finally {
    await db.close();
  }
});
