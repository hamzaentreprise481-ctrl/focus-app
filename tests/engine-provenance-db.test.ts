// Provenance of AI output (migration 20261004090000_engine_signed_analyses),
// on the real schema with RLS: only an envelope signed by the FOCUS server,
// for the signed-in teacher, recent, and for the evidence version read before
// the evidence, can record an analysis. Every caller is an ordinary
// `authenticated` (or `anon`) session, as PostgREST runs it for any account
// holding the publishable key.

import { after, afterEach, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { evidenceVersion, installEngineKey, RECORD_SQL, signedEnvelope } from "./helpers/engine";
import { createMigratedDatabase, seedSchoolFixture, type SchoolFixtureIds } from "./helpers/pg";

let db: PGlite;
let a: SchoolFixtureIds;
let physicsTeacher: string;
let otherSchoolTeacher: string;

const one = async (sql: string, params: unknown[] = []) => (await db.query<{ id: string }>(sql, params)).rows[0].id;

before(async () => {
  db = await createMigratedDatabase();
  await installEngineKey(db);
  a = await seedSchoolFixture(db, { students: [null, null] as unknown as string[] });
  const user = (email: string) =>
    one(`insert into auth.users(email, raw_app_meta_data) values ($1, '{"role":"teacher"}') returning id`, [email]);
  physicsTeacher = await user("pc@example.test");
  const physics = await one("insert into public.subjects(school_id, name, code) values ($1, 'Physique-chimie', 'PC') returning id", [a.school]);
  await db.query("insert into public.school_memberships(school_id, user_id, role) values ($1, $2, 'teacher')", [a.school, physicsTeacher]);
  await db.query("insert into public.teacher_assignments(school_id, teacher_id, class_id, subject_id) values ($1, $2, $3, $4)", [
    a.school, physicsTeacher, a.classId, physics,
  ]);
  const b = await seedSchoolFixture(db, { students: [null] as unknown as string[] });
  otherSchoolTeacher = b.teacher;
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

async function as<T = Record<string, unknown>>(userId: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec("savepoint call");
  try {
    await db.exec(userId ? "set local role authenticated" : "set local role anon");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
    const { rows } = await db.query<T>(sql, params);
    await db.exec("reset role");
    await db.exec("release savepoint call");
    return rows;
  } catch (error) {
    await db.exec("rollback to savepoint call");
    throw error;
  }
}
const teacher = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => as<T>(a.teacher, sql, params);
const hash = () => createHash("sha256").update(randomUUID()).digest("hex");

/** An assessment with one tagged question and an answer with a classic error. */
async function copy(responseText = "3(x+2) = 3x+2") {
  const assessmentId = randomUUID();
  await teacher("select public.focus_save_assessment($1, 'Contrôle', current_date, $2, $3, '{}'::uuid[], '[]'::jsonb, false)", [
    assessmentId, a.classId, a.subject,
  ]);
  const [{ result }] = await teacher<{ result: { questionIds: string[] } }>(
    "select public.focus_save_assessment_questions($1, '', '', $2::jsonb) as result",
    [assessmentId, JSON.stringify([{ prompt: "Développer 3(x+2).", correctionText: "3(x+2) = 3x+6", maxPoints: "2", nodeCodes: ["MATH.ALG.DISTRIBUTIVITE"] }])],
  );
  const [question] = result.questionIds;
  await teacher("select public.focus_save_student_responses($1, $2, $3::jsonb)", [
    assessmentId, a.students[0], JSON.stringify([{ questionId: question, responseText, awardedPoints: "1" }]),
  ]);
  const [{ id: responseId }] = await teacher<{ id: string }>("select id from public.student_responses where question_id = $1", [question]);
  const node = (await db.query<{ id: string }>("select id from public.curriculum_nodes where code = 'MATH.ALG.DISTRIBUTIVITE'")).rows[0].id;
  const finding = { questionId: question, responseId, nodeId: node, errorType: "calcul", evidenceExcerpt: "3x+2", explanation: "Le 3 n’est appliqué qu’au premier terme." };
  const recommendation = { nodeId: node, difficulty: "Distribuer un facteur", explanation: "Le facteur n’est appliqué qu’au premier terme.", recommendedAction: "Reprendre la distributivité." };
  const envelope = (overrides: Record<string, unknown> = {}, options: Parameters<typeof signedEnvelope>[2] = {}) =>
    signedEnvelope(
      db,
      { kind: "analysis", teacherId: a.teacher, schoolId: a.school, studentId: a.students[0], assessmentId, inputHash: hash(), errors: [finding], recommendations: [recommendation], ...overrides } as Parameters<typeof signedEnvelope>[1],
      options,
    );
  return { assessmentId, question, finding, recommendation, envelope };
}
const record = (signed: { p_envelope: string; p_signature: string }, user: string | null = a.teacher) =>
  as<{ run: string }>(user, RECORD_SQL, [signed.p_envelope, signed.p_signature]);
const runs = async (assessmentId: string) =>
  (await db.query<{ n: number }>("select count(*)::int as n from public.ai_analysis_runs where assessment_id = $1", [assessmentId])).rows[0].n;

test("no API role can call the persistence functions directly, or read the engine key", async () => {
  const { assessmentId, finding, recommendation } = await copy();
  await assert.rejects(
    teacher("select public.focus_persist_pedagogical_analysis($1, $2, $3, 'gpt-forged', $4, $5::jsonb, $6::jsonb)", [
      a.school, a.students[0], assessmentId, hash(), JSON.stringify([finding]), JSON.stringify([recommendation]),
    ]),
    /permission denied for function focus_persist_pedagogical_analysis/,
  );
  await assert.rejects(
    teacher("select public.focus_persist_no_evidence($1, $2, $3, 'm', $4, 'rien à signaler')", [a.school, a.students[0], assessmentId, hash()]),
    /permission denied for function focus_persist_no_evidence/,
  );
  await assert.rejects(teacher("select secret from focus_private.engine_keys"), /permission denied for schema focus_private/);
  await assert.rejects(teacher("select focus_private.hmac_sha256('k', 'm')"), /permission denied for schema focus_private/);
  await assert.rejects(as(null, RECORD_SQL, ["{}", "0".repeat(64)]), /permission denied for function focus_record_engine_analysis/);
  await assert.rejects(as(null, "select * from public.focus_analysis_evidence_versions($1, $2)", [a.students[0], [assessmentId]]), /permission denied/);
  for (const role of ["service_role"]) {
    await db.exec(`savepoint r; set local role ${role}`);
    await assert.rejects(db.query("select secret from focus_private.engine_keys"), /permission denied for schema focus_private/);
    await db.exec("rollback to savepoint r");
  }
  assert.equal(await runs(assessmentId), 0);
});

test("a forged, tampered or wrongly keyed envelope is refused; the engine's is recorded once", async () => {
  const { assessmentId, envelope } = await copy();
  const genuine = await envelope();
  // Not signed, or signed with another key.
  await assert.rejects(record({ p_envelope: genuine.p_envelope, p_signature: "0".repeat(64) }), /not signed by the FOCUS engine/);
  await assert.rejects(record({ p_envelope: genuine.p_envelope, p_signature: "not hex" }), /not signed by the FOCUS engine/);
  await assert.rejects(record(await envelope({}, { key: "ab".repeat(32) })), /not signed by the FOCUS engine/);
  // The engine's text, edited after signing (another explanation).
  const tampered = genuine.p_envelope.replace("Le 3 n’est appliqué", "L’élève ne maîtrise pas");
  assert.notEqual(tampered, genuine.p_envelope);
  await assert.rejects(record({ p_envelope: tampered, p_signature: genuine.p_signature }), /not signed by the FOCUS engine/);
  assert.equal(await runs(assessmentId), 0);

  const [{ run }] = await record(genuine);
  assert.ok(run);
  const [stored] = (await db.query<{ model: string; teacher_id: string }>("select model, teacher_id from public.ai_analysis_runs where id = $1", [run])).rows;
  assert.deepEqual(stored, { model: "test-model", teacher_id: a.teacher });
  // The same signed envelope again: the same run, nothing duplicated.
  const [{ run: again }] = await record(genuine);
  assert.equal(again, run);
  assert.equal(await runs(assessmentId), 1);
});

test("an envelope is valid only for the teacher it was signed for, for ten minutes", async () => {
  const { assessmentId, envelope } = await copy();
  // Signed for the maths teacher, presented by the physics teacher of the class.
  await assert.rejects(record(await envelope(), physicsTeacher), /signed for another teacher/);
  // Signed for the physics teacher: still not their subject.
  await assert.rejects(record(await envelope({ teacherId: physicsTeacher }), physicsTeacher), /not accessible/);
  // Another school's teacher with an envelope signed for them.
  await assert.rejects(record(await envelope({ teacherId: otherSchoolTeacher }), otherSchoolTeacher), /not accessible/);
  // A student of the class.
  await assert.rejects(record(await envelope(), a.students[0]), /signed for another teacher/);
  // Too old, or from the future.
  await assert.rejects(record(await envelope({}, { issuedAt: new Date(Date.now() - 11 * 60_000) })), /expired/);
  await assert.rejects(record(await envelope({}, { issuedAt: new Date(Date.now() + 5 * 60_000) })), /expired/);
  assert.equal(await runs(assessmentId), 0);
});

test("an analysis whose evidence changed after it was read is refused, whatever changed", async () => {
  const changes: Array<[string, (ids: Awaited<ReturnType<typeof copy>>) => Promise<unknown>]> = [
    ["the answer", (ids) => teacher("update public.student_responses set response_text = '3(x+2) = 3x+2 ?' where question_id = $1", [ids.question])],
    ["the points", (ids) => teacher("update public.student_responses set awarded_points = 0 where question_id = $1", [ids.question])],
    ["the annotation", (ids) => teacher("update public.student_responses set teacher_annotation = 'vu' where question_id = $1", [ids.question])],
    ["the correction", (ids) => teacher("update public.assessment_questions set correction_text = '3x + 6' where id = $1", [ids.question])],
    ["the maximum", (ids) => teacher("update public.assessment_questions set max_points = 3 where id = $1", [ids.question])],
    ["the notions", (ids) => teacher("delete from public.question_curriculum_nodes where question_id = $1", [ids.question])],
    ["the materials", (ids) => teacher("update public.assessment_materials set context_text = 'Calculatrice autorisée' where assessment_id = $1", [ids.assessmentId])],
  ];
  for (const [label, change] of changes) {
    const ids = await copy();
    const before = await evidenceVersion(db, ids.assessmentId, a.students[0]);
    const signed = await ids.envelope({ evidenceVersion: before });
    await change(ids);
    assert.notEqual(await evidenceVersion(db, ids.assessmentId, a.students[0]), before, label);
    await assert.rejects(record(signed), /evidence changed since the analysis read it/, label);
    assert.equal(await runs(ids.assessmentId), 0, label);
  }
  // Another student's copy is not this copy's evidence.
  const ids = await copy();
  const signed = await ids.envelope();
  await teacher("select public.focus_save_student_responses($1, $2, $3::jsonb)", [
    ids.assessmentId, a.students[1], JSON.stringify([{ questionId: ids.question, responseText: "3x + 6" }]),
  ]);
  await record(signed);
  assert.equal(await runs(ids.assessmentId), 1);
});

test("the evidence versions are given only for copies the caller may analyse", async () => {
  const { assessmentId } = await copy();
  const versions = (user: string, student = a.students[0]) =>
    as<{ assessment_id: string; evidence_version: string }>(user, "select * from public.focus_analysis_evidence_versions($1, $2)", [student, [assessmentId]]);
  const [mine] = await versions(a.teacher);
  assert.deepEqual(mine, { assessment_id: assessmentId, evidence_version: await evidenceVersion(db, assessmentId, a.students[0]) });
  assert.deepEqual(await versions(physicsTeacher), []);
  assert.deepEqual(await versions(otherSchoolTeacher), []);
  assert.deepEqual(await versions(a.students[0]), []);
  // A student who is not enrolled in the class.
  const stranger = await one("insert into auth.users default values returning id");
  assert.deepEqual(await versions(a.teacher, stranger), []);
});

test("without a key in the database nothing is recorded, and the error says why", async () => {
  const { assessmentId, envelope } = await copy();
  const signed = await envelope();
  await db.query("delete from focus_private.engine_keys");
  await assert.rejects(record(signed), /analysis engine key is not configured/);
  assert.equal(await runs(assessmentId), 0);
});

test("an assessment with analysed copies cannot be deleted through the API; one without analysis can", async () => {
  const analysed = await copy();
  await record(await analysed.envelope());
  await assert.rejects(teacher("delete from public.assessments where id = $1", [analysed.assessmentId]), /analysed copies cannot be deleted/);
  assert.equal((await db.query("select 1 from public.assessments where id = $1", [analysed.assessmentId])).rows.length, 1);
  // Not analysed: its own teacher deletes it.
  const fresh = await copy();
  await teacher("delete from public.assessments where id = $1", [fresh.assessmentId]);
  assert.equal((await db.query("select 1 from public.assessments where id = $1", [fresh.assessmentId])).rows.length, 0);
  // An administrator working in SQL (no API role) still can.
  await db.query("delete from public.assessments where id = $1", [analysed.assessmentId]);
  assert.equal(await runs(analysed.assessmentId), 0);
});
