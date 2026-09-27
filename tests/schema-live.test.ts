// The repository migrations must rebuild the live project's schema exactly.
// supabase/live-schema-fingerprint.tsv was captured on the live project with
// scripts/schema-fingerprint.sql (functions + grants, tables with columns,
// constraints, indexes, triggers and grants, RLS policies, enum types, the
// auth.users trigger). A migration already applied live that is edited, a
// missing base migration or a renamed version breaks this test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createMigratedDatabase, migrationFiles } from "./helpers/pg";

const ROOT = path.join(__dirname, "..");
const LIVE_HEAD = "20260925214642_supersede_edited_analysis_runs.sql";

function snapshot() {
  return readFileSync(path.join(ROOT, "supabase", "live-schema-fingerprint.tsv"), "utf8")
    .split("\n")
    .filter((line) => line && !line.startsWith("#"));
}

test("migrations up to the live head rebuild the live schema object for object", async () => {
  const db = await createMigratedDatabase({ upTo: LIVE_HEAD });
  try {
    const { rows } = await db.query<{ object: string; hash: string }>(
      readFileSync(path.join(ROOT, "scripts", "schema-fingerprint.sql"), "utf8"),
    );
    const local = rows.map((row) => `${row.object}\t${row.hash}`);
    const live = snapshot();
    assert.deepEqual(
      local.filter((line) => !live.includes(line)),
      [],
      "objects that differ from the live project (local side)",
    );
    assert.deepEqual(live.filter((line) => !local.includes(line)), [], "objects missing locally");
  } finally {
    await db.close();
  }
});

test("migration versions already applied live keep their live version numbers", () => {
  // supabase_migrations.schema_migrations on the live project, 2026-09-26.
  const live = [
    "20260910164313_schema.sql",
    "20260910164329_authz_functions.sql",
    "20260910164413_rls.sql",
    "20260910164423_triggers.sql",
    "20260924210828_harden_trigger_functions.sql",
    "20260925180351_focus_save_assessment_rpc.sql",
    "20260925193842_pedagogical_ai_math_v1.sql",
    "20260925194056_persist_pedagogical_analysis.sql",
    "20260925194125_fix_pedagogical_evidence_validation.sql",
    "20260925194715_optimize_pedagogical_ai_v1.sql",
    "20260925212527_enrich_math_graph_core.sql",
    "20260925213001_fix_pedagogical_analysis_lifecycle.sql",
    "20260925213931_persist_no_evidence_atomically.sql",
    "20260925214407_review_pedagogical_recommendations.sql",
    "20260925214642_supersede_edited_analysis_runs.sql",
  ];
  const files = migrationFiles().map((file) => path.basename(file));
  assert.deepEqual(files.slice(0, live.length), live);
  // Everything after the live head is newer than it, so `supabase db push`
  // applies only the pending migrations, in order.
  assert.ok(files.slice(live.length).every((name) => name > LIVE_HEAD));
});
