// The curated catalogue (typical errors, remediations, objectives) imported
// from the Work document, on the real schema with every migration applied.

import { after, afterEach, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { convertWorkCatalogue } from "../lib/curriculum/work-catalogue";
import { createMigratedDatabase, seedSchoolFixture } from "./helpers/pg";
import { workDocument } from "./helpers/work-curriculum";

let db: PGlite;
before(async () => {
  db = await createMigratedDatabase();
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

async function as<T = Record<string, unknown>>(role: "service_role" | "authenticated" | "anon", sql: string, params: unknown[] = [], user?: string): Promise<T[]> {
  await db.exec("savepoint call");
  try {
    await db.exec(`set local role ${role}`);
    if (user) await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
    const { rows } = await db.query<T>(sql, params);
    await db.exec("reset role");
    await db.exec("release savepoint call");
    return rows;
  } catch (error) {
    await db.exec("rollback to savepoint call");
    throw error;
  }
}
const importCatalogue = async (catalogue: unknown, dryRun = false) =>
  (await as<{ report: { changed: boolean; rowsWritten: number; deactivated: number; active: Record<string, number> } }>(
    "service_role",
    "select public.focus_import_curriculum_catalogue($1::jsonb, $2) as report",
    [JSON.stringify(catalogue), dryRun],
  ))[0].report;
const count = async (sql: string) => (await db.query<{ n: number }>(`select count(*)::int as n from (${sql}) q`)).rows[0].n;

function catalogue() {
  const result = convertWorkCatalogue(workDocument(), "work.json");
  assert.deepEqual(result.issues, []);
  return result.catalogue!;
}

test("the committed catalogue is imported with its provenance: 272 objectives, 99 typical errors, 99 remediations, none teacher-validated", async () => {
  assert.equal(await count("select 1 from public.curriculum_objectives where active"), 272);
  assert.equal(await count("select 1 from public.curriculum_typical_errors where active"), 99);
  assert.equal(await count("select 1 from public.curriculum_remediations where active"), 99);
  assert.equal(await count("select 1 from public.curriculum_remediation_targets"), 99);
  assert.equal(await count("select 1 from public.curriculum_typical_errors where teacher_validated or curriculum_typical_errors.provenance <> 'proposition_originale_FOCUS'"), 0);
  assert.equal(await count("select 1 from public.curriculum_objectives where provenance <> 'reformulation_du_programme'"), 0);
  const [row] = (
    await db.query<{ description: string; steps: string[]; check_prompt: string }>(
      `select e.description, r.steps, r.check_prompt from public.curriculum_typical_errors e
         join public.curriculum_remediation_targets t on t.error_id = e.id
         join public.curriculum_remediations r on r.id = t.remediation_id
        where e.code = 'MATH.NUM.ARITHMETIQUE.ERR.01'`,
    )
  ).rows;
  assert.equal(row.description, "Inverser multiple et diviseur");
  assert.deepEqual(row.steps, ["Faire écrire l’égalité multiplicative avant de nommer les rôles"]);
  assert.match(row.check_prompt, /42=7×6/);
  // The migration is exactly what the converter produces today.
  const migration = readFileSync(path.join(__dirname, "..", "supabase", "migrations", "20260926170000_curriculum_catalogue_work_seconde_2026.sql"), "utf8");
  const hash = createHash("sha256").update(JSON.stringify(catalogue())).digest("hex");
  assert.match(migration, new RegExp(`-- Content hash: ${hash}`));
});

test("re-importing is a no-op, a dry run writes nothing, and missing entries are deactivated, never deleted", async () => {
  const [{ n: runs }] = (await db.query<{ n: number }>("select count(*)::int as n from public.curriculum_catalogue_imports")).rows;
  const again = await importCatalogue(catalogue());
  assert.deepEqual([again.changed, again.rowsWritten, again.deactivated], [false, 0, 0]);
  assert.equal((await db.query<{ n: number }>("select count(*)::int as n from public.curriculum_catalogue_imports")).rows[0].n, runs);

  const trimmed = catalogue();
  const node = trimmed.nodes.find((item) => item.code === "MATH.NUM.ARITHMETIQUE")!;
  node.errors = [];
  node.remediations = [];
  const dry = await importCatalogue(trimmed, true);
  assert.equal(dry.deactivated, 2);
  assert.equal(await count("select 1 from public.curriculum_typical_errors where code = 'MATH.NUM.ARITHMETIQUE.ERR.01' and active"), 1);
  const applied = await importCatalogue(trimmed);
  assert.equal(applied.deactivated, 2);
  assert.equal(await count("select 1 from public.curriculum_typical_errors where code = 'MATH.NUM.ARITHMETIQUE.ERR.01' and not active"), 1);
  // Restoring reactivates the same rows.
  const restored = await importCatalogue(catalogue());
  assert.equal(restored.changed, true);
  assert.equal(await count("select 1 from public.curriculum_typical_errors where code = 'MATH.NUM.ARITHMETIQUE.ERR.01' and active"), 1);
});

test("the catalogue is validated before any write", async () => {
  const cases: Array<[(c: ReturnType<typeof catalogue>) => void, RegExp]> = [
    [(c) => (c.sourceUrl = "https://www.education.gouv.fr/inconnu"), /unknown curriculum source/],
    [(c) => (c.nodes[0].code = "MATH.INVENTE"), /not an active node/],
    [(c) => (c.nodes[0].errors[0].code = "MATH.AUTRE.ERR.01"), /invalid entry/],
    [(c) => (c.nodes[0].errors[0].description = "x".repeat(301)), /invalid entry/],
    [(c) => (c.nodes[0].remediations[0].targetErrorCodes = ["MATH.ALG.PRODUIT_NUL.ERR.01"]), /invalid entry/],
    [(c) => (c.nodes[0].remediations[0].steps = []), /invalid entry/],
    [(c) => (c.nodes[1].errors[0].code = c.nodes[0].errors[0].code), /invalid entry|duplicate entry codes/],
  ];
  for (const [mutate, error] of cases) {
    const value = catalogue();
    mutate(value);
    await assert.rejects(importCatalogue(value), error);
  }
});

test("teachers read the catalogue but cannot write it; anonymous users cannot read it", async () => {
  const school = await seedSchoolFixture(db);
  const rows = await as("authenticated", "select code from public.curriculum_typical_errors limit 1", [], school.teacher);
  assert.equal(rows.length, 1);
  await assert.rejects(as("authenticated", "update public.curriculum_typical_errors set description = 'x'", [], school.teacher), /permission denied/);
  await assert.rejects(as("authenticated", "select public.focus_import_curriculum_catalogue('{}'::jsonb, true)", [], school.teacher), /permission denied/);
  await assert.rejects(as("anon", "select code from public.curriculum_remediations limit 1"), /permission denied/);
});

test("an analysis can cite a typical error of the diagnosed notion only", async () => {
  const school = await seedSchoolFixture(db);
  const teacher = (sql: string, params: unknown[] = []) => as<Record<string, string>>("authenticated", sql, params, school.teacher);
  const assessmentId = randomUUID();
  await teacher("select public.focus_save_assessment($1, 'Calcul', current_date, $2, $3, '{}'::uuid[], '[]'::jsonb, false)", [assessmentId, school.classId, school.subject]);
  const [{ result }] = (await teacher("select public.focus_save_assessment_questions($1, '', '', $2::jsonb) as result", [
    assessmentId,
    JSON.stringify([{ prompt: "Développer 3(x+2).", correctionText: "3x+6" }]),
  ])) as unknown as Array<{ result: { questionIds: string[] } }>;
  const questionId = result.questionIds[0];
  await teacher("select public.focus_save_student_responses($1, $2, $3::jsonb)", [assessmentId, school.students[0], JSON.stringify([{ questionId, responseText: "3(x+2)=3x+2" }])]);
  const [{ id: responseId }] = await teacher("select id from public.student_responses where question_id = $1", [questionId]);
  const [{ id: nodeId }] = (await db.query<{ id: string }>("select id from public.curriculum_nodes where code = 'MATH.ALG.DISTRIBUTIVITE'")).rows;
  const persist = (catalogueErrorCode: string) =>
    teacher("select public.focus_persist_pedagogical_analysis($1, $2, $3, 'm', $4, $5::jsonb, $6::jsonb)", [
      school.school,
      school.students[0],
      assessmentId,
      createHash("sha256").update(randomUUID()).digest("hex"),
      JSON.stringify([{ questionId, responseId, nodeId, errorType: "calcul", evidenceExcerpt: "3x+2", explanation: "e", catalogueErrorCode }]),
      JSON.stringify([{ nodeId, difficulty: "d", explanation: "e", recommendedAction: "a" }]),
    ]);
  await assert.rejects(persist("MATH.NUM.ARITHMETIQUE.ERR.01"), /catalogue error does not belong to the notion/);
  await persist("MATH.ALG.DISTRIBUTIVITE.ERR.01");
  const [row] = await teacher(
    `select e.code from public.pedagogical_recommendations r join public.curriculum_typical_errors e on e.id = r.catalogue_error_id where r.assessment_id = $1`,
    [assessmentId],
  );
  assert.equal(row.code, "MATH.ALG.DISTRIBUTIVITE.ERR.01");
});
