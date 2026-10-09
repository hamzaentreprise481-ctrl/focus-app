// Rehearsal of the three pending migrations on a replica of the live project
// as measured on 9 October 2026 (the free plan offers no Supabase branch).
//
// 1. The repository migrations up to the live head (20261004090000) rebuild
//    the live schema exactly: same object count and same total checksum as
//    scripts/schema-fingerprint-total.sql printed on wznqeofsvbutbvbyxfab.
// 2. On that replica, with data written by the OLD functions (assessment,
//    questions, typed copies, an analysis signed by the old server, a teacher
//    decision), 20261007090000 → 20261007130000 → 20261009120000 keep every
//    existing row (supabase/staging/data-checksums.sql, the script to run on
//    live before and after), give existing rows the right defaults, and the
//    three rollbacks return to the exact live schema with the same data.
// 3. After the upgrade, the teacher still reads everything under RLS; an
//    analysis signed by the server still in production (no per-question
//    outcomes) is still recorded; the new server's strict envelope too.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, createMigratedDatabase, seedSchoolFixture, type SchoolFixtureIds } from "./helpers/pg";
import { evidenceVersion, installEngineKey, RECORD_SQL, signedEnvelope, TEST_ENGINE_KEY } from "./helpers/engine";
import { signEngineEnvelope, type EngineEnvelope } from "../lib/pedagogy/engine-signature";

const ROOT = path.join(__dirname, "..");
const LIVE_HEAD = "20261004090000_engine_signed_analyses";
const PENDING = [
  "20261007090000_active_teacher_membership",
  "20261007130000_scan_import_storage",
  "20261009120000_transcription_provenance_question_outcomes",
];
// Measured on the live project on 2026-10-09 with scripts/schema-fingerprint-total.sql.
const LIVE_SCHEMA = { n: 191, total: "f2efd71a41dbcfe224d29d81a8f5c352" };
const FINGERPRINT_TOTAL = readFileSync(path.join(ROOT, "scripts", "schema-fingerprint-total.sql"), "utf8");
const DATA_CHECKSUMS = readFileSync(path.join(ROOT, "supabase", "staging", "data-checksums.sql"), "utf8");

async function schema(db: PGlite) {
  const { rows } = await db.query<{ n: number; total: string }>(FINGERPRINT_TOTAL);
  return { n: Number(rows[0].n), total: rows[0].total };
}
async function checksums(db: PGlite) {
  const { rows } = await db.query<{ table: string; rows: number; checksum: string }>(DATA_CHECKSUMS);
  return rows.map((row) => `${row.table} ${row.rows} ${row.checksum}`);
}
const migration = (name: string) => readFileSync(path.join(ROOT, "supabase", "migrations", `${name}.sql`), "utf8");
const rollback = (name: string) => readFileSync(path.join(ROOT, "supabase", "rollback", `${name}.down.sql`), "utf8");

async function asTeacher<T>(db: PGlite, teacher: string, fn: () => Promise<T>) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [teacher]);
  try {
    return await asRole(db, "authenticated", fn);
  } finally {
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}

/** Data as the CURRENT live code writes it, through the old functions. */
async function liveShapedData(db: PGlite, ids: SchoolFixtureIds) {
  const node = (await db.query<{ id: string }>("select id from public.curriculum_nodes where code = 'MATH.ALG.IDENTITES'")).rows[0].id;
  const assessment = randomUUID();
  const questions = await asTeacher(db, ids.teacher, async () => {
    await db.query("select public.focus_save_assessment($1, 'Contrôle du 2 octobre', '2026-10-02'::date, $2, $3, '{}'::uuid[], '[]'::jsonb, false)", [
      assessment, ids.classId, ids.subject,
    ]);
    const { rows } = await db.query<{ result: { questionIds: string[] } }>("select public.focus_save_assessment_questions($1, 'Calcul littéral', '', $2::jsonb) as result", [
      assessment,
      JSON.stringify([
        { prompt: "Développer (x+5)²", correctionText: "x²+10x+25", maxPoints: "2", nodeCodes: ["MATH.ALG.IDENTITES"] },
        { prompt: "Factoriser x²−9", correctionText: "(x−3)(x+3)", maxPoints: "2", nodeCodes: ["MATH.ALG.IDENTITES"] },
      ]),
    ]);
    const questionIds = rows[0].result.questionIds;
    for (const [index, student] of ids.students.entries())
      await db.query("select public.focus_save_student_responses($1, $2, $3::jsonb)", [
        assessment, student,
        JSON.stringify([
          { questionId: questionIds[0], responseText: index === 0 ? "B = x² + 25" : "x² + 10x + 25", awardedPoints: index === 0 ? "0" : "2" },
          { questionId: questionIds[1], responseText: "(x−3)(x+3)", awardedPoints: "2" },
        ]),
      ]);
    return questionIds;
  });
  const response = (await db.query<{ id: string }>("select id from public.student_responses where question_id = $1 and student_id = $2", [questions[0], ids.students[0]])).rows[0].id;
  // An analysis signed by the old server: its envelope has no questionOutcomes.
  const legacy = {
    teacherId: ids.teacher, schoolId: ids.school, studentId: ids.students[0], assessmentId: assessment, model: "gpt-6-astra",
    inputHash: createHash("sha256").update("live-shaped").digest("hex"),
    evidenceVersion: await evidenceVersion(db, assessment, ids.students[0]),
    kind: "analysis",
    errors: [{ questionId: questions[0], responseId: response, nodeId: node, errorType: "concept", evidenceExcerpt: "x² + 25", explanation: "Le double produit est absent." }],
    recommendations: [{ nodeId: node, difficulty: "Développer le carré d’une somme", explanation: "Le double produit est absent.", recommendedAction: "Faire calculer (a+b)(a+b) terme à terme." }],
  } as unknown as EngineEnvelope;
  const signed = signEngineEnvelope(legacy, Buffer.from(TEST_ENGINE_KEY, "hex"));
  await asTeacher(db, ids.teacher, () => db.query(RECORD_SQL, [signed.p_envelope, signed.p_signature]));
  const recommendation = (await db.query<{ id: string }>("select id from public.pedagogical_recommendations where assessment_id = $1", [assessment])).rows[0].id;
  await asTeacher(db, ids.teacher, () => db.query("select public.focus_review_pedagogical_recommendation($1, 'validate', 'Vu en classe')", [recommendation]));
  return { assessment, questions, node };
}

test("the repository migrations rebuild the live schema of 9 October object for object", async () => {
  const db = await createMigratedDatabase({ upTo: `${LIVE_HEAD}.sql` });
  try {
    assert.deepEqual(await schema(db), LIVE_SCHEMA);
  } finally {
    await db.close();
  }
});

test("the pending migrations keep every live row, and their rollbacks return to the exact live schema", async () => {
  const db = await createMigratedDatabase({ upTo: `${LIVE_HEAD}.sql` });
  const fresh = await createMigratedDatabase();
  try {
    const head = await schema(fresh);
    await installEngineKey(db);
    const ids = await seedSchoolFixture(db, { students: [null, null, null] as unknown as string[] });
    await liveShapedData(db, ids);
    const before = await checksums(db);
    assert.ok(before.some((line) => line.startsWith("ai_analysis_runs 1 ")), "the replica holds an analysis");
    assert.ok(before.some((line) => line.startsWith("student_responses 6 ")), "and typed copies");

    for (const name of PENDING) await db.exec(migration(name));
    assert.deepEqual(await schema(db), head, "same schema as a database migrated from scratch");
    assert.deepEqual(await checksums(db), before, "no existing row changed or disappeared");
    const defaults = (await db.query<{ source: string; legibility: string | null; verified: boolean; n: number }>(
      "select source, legibility, transcription_verified as verified, count(*)::int as n from public.student_responses group by 1, 2, 3",
    )).rows;
    assert.deepEqual(defaults, [{ source: "manual", legibility: null, verified: true, n: 6 }], "existing copies are typed, verified answers");
    const runs = (await db.query<{ outcomes: unknown[] }>("select question_outcomes as outcomes from public.ai_analysis_runs")).rows;
    assert.deepEqual(runs, [{ outcomes: [] }], "an existing analysis has no per-question outcomes, as before");

    for (const name of [...PENDING].reverse()) await db.exec(rollback(name));
    assert.deepEqual(await schema(db), LIVE_SCHEMA, "back to the exact live schema");
    assert.deepEqual(await checksums(db), before, "with the same data");

    for (const name of PENDING) await db.exec(migration(name));
    assert.deepEqual(await schema(db), head, "and the migrations apply again");
  } finally {
    await db.close();
    await fresh.close();
  }
});

test("after the upgrade: the teacher reads everything, and both the old and the new server can record", async () => {
  const db = await createMigratedDatabase({ upTo: `${LIVE_HEAD}.sql` });
  try {
    await installEngineKey(db);
    const ids = await seedSchoolFixture(db, { students: [null, null] as unknown as string[] });
    const data = await liveShapedData(db, ids);
    for (const name of PENDING) await db.exec(migration(name));

    const visible = await asTeacher(db, ids.teacher, async () => {
      const count = async (sql: string) => Number((await db.query<{ n: number }>(sql, [data.assessment])).rows[0].n);
      return {
        responses: await count("select count(*)::int as n from public.student_responses where assessment_id = $1"),
        runs: await count("select count(*)::int as n from public.ai_analysis_runs where assessment_id = $1"),
        recommendations: await count("select count(*)::int as n from public.pedagogical_recommendations where assessment_id = $1 and teacher_decision = 'validated'"),
      };
    });
    assert.deepEqual(visible, { responses: 4, runs: 1, recommendations: 1 });

    // The second student's copy, analysed by the server still in production
    // (no questionOutcomes key), then by the new one (strict outcomes).
    const student = ids.students[1];
    const legacy = signEngineEnvelope(
      {
        teacherId: ids.teacher, schoolId: ids.school, studentId: student, assessmentId: data.assessment, model: "gpt-6-astra",
        inputHash: "b".repeat(64), evidenceVersion: await evidenceVersion(db, data.assessment, student), kind: "no_evidence", reason: "Aucune erreur démontrable.",
      } as unknown as EngineEnvelope,
      Buffer.from(TEST_ENGINE_KEY, "hex"),
    );
    await asTeacher(db, ids.teacher, () => db.query(RECORD_SQL, [legacy.p_envelope, legacy.p_signature]));
    const strict = await signedEnvelope(db, { kind: "analysis", teacherId: ids.teacher, schoolId: ids.school, studentId: student, assessmentId: data.assessment, inputHash: "c".repeat(64), errors: [] });
    const run = (await asTeacher(db, ids.teacher, () => db.query<{ run: string }>(RECORD_SQL, [strict.p_envelope, strict.p_signature]))).rows[0].run;
    const outcomes = (await db.query<{ outcomes: Array<{ outcome: string }> }>("select question_outcomes as outcomes from public.ai_analysis_runs where id = $1", [run])).rows[0].outcomes;
    assert.deepEqual(outcomes.map((item) => item.outcome), ["no_error_observed", "no_error_observed"]);
  } finally {
    await db.close();
  }
});
