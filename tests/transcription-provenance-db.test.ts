// Migration 20261009120000 on the real schema with RLS: provenance of
// scanned answers, outcomes per question checked by the database, confidence
// bounded by the reading a finding rests on, and a weakness that becomes
// "forte" only across several assessments the teacher confirmed.

import { after, afterEach, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { evidenceVersion, installEngineKey, RECORD_SQL, signedEnvelope, TEST_ENGINE_KEY } from "./helpers/engine";
import { signEngineEnvelope, type EngineEnvelope } from "../lib/pedagogy/engine-signature";
import { createMigratedDatabase, seedSchoolFixture, type SchoolFixtureIds } from "./helpers/pg";

let db: PGlite;
let a: SchoolFixtureIds;
let node: string;
let fractions: string;

before(async () => {
  db = await createMigratedDatabase();
  await installEngineKey(db);
  a = await seedSchoolFixture(db, { students: [null, null] as unknown as string[] });
  node = (await db.query<{ id: string }>("select id from public.curriculum_nodes where code = 'MATH.ALG.IDENTITES'")).rows[0].id;
  fractions = (await db.query<{ id: string }>("select id from public.curriculum_nodes where code = 'MATH.NUM.FRACTIONS.OPERATIONS'")).rows[0].id;
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

async function teacher<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec("savepoint call");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [a.teacher]);
    const { rows } = await db.query<T>(sql, params);
    await db.exec("reset role");
    await db.exec("release savepoint call");
    return rows;
  } catch (error) {
    await db.exec("rollback to savepoint call");
    throw error;
  }
}
const hash = () => createHash("sha256").update(randomUUID()).digest("hex");

/** An assessment with the given questions (prompt, correction, notion code). */
async function assessment(questions: Array<{ prompt: string; correction: string; code: string }>, date = "2026-09-14") {
  const id = randomUUID();
  await teacher("select public.focus_save_assessment($1, 'Contrôle', $4::date, $2, $3, '{}'::uuid[], '[]'::jsonb, false)", [id, a.classId, a.subject, date]);
  const [{ result }] = await teacher<{ result: { questionIds: string[] } }>("select public.focus_save_assessment_questions($1, '', '', $2::jsonb) as result", [
    id,
    JSON.stringify(questions.map((q) => ({ prompt: q.prompt, correctionText: q.correction, maxPoints: "2", nodeCodes: [q.code] }))),
  ]);
  return { id, questions: result.questionIds };
}

type Answer = { questionId: string; responseText: string; awardedPoints?: string; transcription?: { source: string; legibility: string; verified: boolean } };
const scan = (assessmentId: string, answers: Answer[], student = a.students[0]) =>
  teacher("select public.focus_import_scanned_copy($1, $2, $3::jsonb, null, false)", [assessmentId, student, JSON.stringify(answers)]);
const save = (assessmentId: string, answers: Answer[], student = a.students[0]) =>
  teacher<{ result: { changed: boolean; supersededAnalyses: number } }>("select public.focus_save_student_responses($1, $2, $3::jsonb) as result", [assessmentId, student, JSON.stringify(answers)]);
const rows = (assessmentId: string, student = a.students[0]) =>
  db.query<{ question_id: string; response_text: string; source: string; legibility: string | null; transcription_verified: boolean; id: string }>(
    "select id, question_id, response_text, source, legibility, transcription_verified from public.student_responses where assessment_id = $1 and student_id = $2",
    [assessmentId, student],
  ).then((r) => r.rows);
const responseId = async (questionId: string, student = a.students[0]) =>
  (await db.query<{ id: string }>("select id from public.student_responses where question_id = $1 and student_id = $2", [questionId, student])).rows[0].id;
const scanned = (legibility: string, verified = false) => ({ source: "scan", legibility, verified });

async function record(assessmentId: string, errors: unknown[], extra: Record<string, unknown> = {}, student = a.students[0]) {
  const recommendations = [...new Set((errors as Array<{ nodeId: string }>).map((e) => e.nodeId))].map((nodeId) => ({
    nodeId,
    difficulty: "Développer le carré d’une somme",
    explanation: "Le double produit est absent.",
    recommendedAction: "Faire calculer (a+b)(a+b) terme à terme.",
  }));
  const signed = await signedEnvelope(db, {
    kind: "analysis", teacherId: a.teacher, schoolId: a.school, studentId: student, assessmentId, inputHash: hash(), errors, recommendations, ...extra,
  } as Parameters<typeof signedEnvelope>[1]);
  const [{ run }] = await teacher<{ run: string }>(RECORD_SQL, [signed.p_envelope, signed.p_signature]);
  return run;
}
const finding = (questionId: string, responseIdValue: string, excerpt: string, nodeId = node) => ({
  questionId, responseId: responseIdValue, nodeId, errorType: "concept", evidenceExcerpt: excerpt, explanation: "Le double produit est absent.",
});

test("a scanned answer keeps its provenance; an unreadable one is never stored as unanswered", async () => {
  const e = await assessment([
    { prompt: "Développer (x+5)²", correction: "x²+10x+25", code: "MATH.ALG.IDENTITES" },
    { prompt: "Calculer 2/3+1/4", correction: "11/12", code: "MATH.NUM.FRACTIONS.OPERATIONS" },
    { prompt: "Factoriser x²−9", correction: "(x−3)(x+3)", code: "MATH.ALG.IDENTITES" },
  ]);
  await scan(e.id, [
    { questionId: e.questions[0], responseText: "B = x² + [illisible] + 25", awardedPoints: "1", transcription: scanned("partielle") },
    { questionId: e.questions[1], responseText: "", transcription: scanned("illisible") },
    { questionId: e.questions[2], responseText: "", transcription: scanned("absente") },
  ]);
  const stored = new Map((await rows(e.id)).map((row) => [row.question_id, row]));
  assert.deepEqual(
    [stored.get(e.questions[0])!.source, stored.get(e.questions[0])!.legibility, stored.get(e.questions[0])!.transcription_verified],
    ["scan", "partielle", false],
  );
  assert.equal(stored.get(e.questions[1])!.response_text, "[illisible]");
  assert.equal(stored.get(e.questions[2])!.legibility, "absente", "a zone missing from the image is kept, not deleted as blank");

  await assert.rejects(scan(e.id, [{ questionId: e.questions[0], responseText: "x", transcription: scanned("vide") }]), /has text but is marked vide/);
  await assert.rejects(scan(e.id, [{ questionId: e.questions[0], responseText: "x", transcription: { source: "manual", legibility: "lisible", verified: true } }]), /invalid transcription/);
  await assert.rejects(scan(e.id, [{ questionId: e.questions[0], responseText: "x", transcription: scanned("parfaite") }]), /invalid transcription/);
  // A typed answer cannot claim to be a partial scan reading.
  await assert.rejects(
    teacher("update public.student_responses set legibility = 'partielle', source = 'manual' where question_id = $1", [e.questions[0]]),
    /student_responses_provenance_check/,
  );
});

test("the teacher's edits make an answer theirs; unchanged scanned answers keep their provenance", async () => {
  const e = await assessment([
    { prompt: "Développer (x+5)²", correction: "x²+10x+25", code: "MATH.ALG.IDENTITES" },
    { prompt: "Calculer 2/3+1/4", correction: "11/12", code: "MATH.NUM.FRACTIONS.OPERATIONS" },
  ]);
  await scan(e.id, [
    { questionId: e.questions[0], responseText: "B = x² + [illisible] + 25", transcription: scanned("partielle") },
    { questionId: e.questions[1], responseText: "3/7", awardedPoints: "0", transcription: scanned("lisible") },
  ]);
  // The evidence editor resends every answer; only the first one changed.
  await save(e.id, [
    { questionId: e.questions[0], responseText: "B = x² + 10x + 25" },
    { questionId: e.questions[1], responseText: "3/7", awardedPoints: "0" },
  ]);
  const stored = new Map((await rows(e.id)).map((row) => [row.question_id, row]));
  assert.deepEqual([stored.get(e.questions[0])!.source, stored.get(e.questions[0])!.legibility, stored.get(e.questions[0])!.transcription_verified], ["manual", null, true]);
  assert.deepEqual([stored.get(e.questions[1])!.source, stored.get(e.questions[1])!.transcription_verified], ["scan", false]);

  // Confirming the reading as it is: verified, and the analysis is superseded.
  const run = await record(e.id, [finding(e.questions[1], await responseId(e.questions[1]), "3/7", fractions)]);
  const [{ n }] = await teacher<{ n: number }>("select public.focus_verify_transcription($1, $2) as n", [e.id, a.students[0]]);
  assert.equal(n, 1);
  assert.equal((await rows(e.id)).every((row) => row.transcription_verified), true);
  const superseded = (await db.query<{ s: string | null }>("select superseded_at as s from public.ai_analysis_runs where id = $1", [run])).rows[0].s;
  assert.notEqual(superseded, null, "the reading changed status: the analysis that used it is replaced");
});

test("no finding may rest on an unread passage, and outcomes must match the evidence", async () => {
  const e = await assessment([
    { prompt: "Développer (x+5)²", correction: "x²+10x+25", code: "MATH.ALG.IDENTITES" },
    { prompt: "Factoriser x²−9", correction: "(x−3)(x+3)", code: "MATH.ALG.IDENTITES" },
    { prompt: "Développer (x+3)²", correction: "x²+6x+9", code: "MATH.ALG.IDENTITES" },
  ]);
  await scan(e.id, [
    { questionId: e.questions[0], responseText: "B = x² + [illisible] + 25", awardedPoints: "0", transcription: scanned("partielle") },
    { questionId: e.questions[1], responseText: "", awardedPoints: "0", transcription: scanned("illisible") },
    { questionId: e.questions[2], responseText: "x² + 9", awardedPoints: "0", transcription: scanned("lisible") },
  ]);
  const r0 = await responseId(e.questions[0]);
  const r1 = await responseId(e.questions[1]);
  const r2 = await responseId(e.questions[2]);
  await assert.rejects(record(e.id, [finding(e.questions[0], r0, "x² + [illisible]")]), /unread passage/);
  await assert.rejects(record(e.id, [finding(e.questions[1], r1, "[illisible]")]), /unread passage/);

  const outcomes = (o0: string, o1: string, o2: string, excerpt = "") => [
    { questionId: e.questions[0], outcome: o0, excerpt: "", note: "" },
    { questionId: e.questions[1], outcome: o1, excerpt: "", note: "" },
    { questionId: e.questions[2], outcome: o2, excerpt, note: "" },
  ];
  const ok = [finding(e.questions[2], r2, "x² + 9")];
  await assert.rejects(record(e.id, ok, { questionOutcomes: outcomes("insufficient_evidence", "illegible", "error").slice(0, 2) }), /cover every question/);
  await assert.rejects(record(e.id, ok, { questionOutcomes: outcomes("insufficient_evidence", "illegible", "no_error_observed") }), /does not match the findings/);
  await assert.rejects(record(e.id, ok, { questionOutcomes: outcomes("insufficient_evidence", "no_answer", "error") }), /illegible answer has no other outcome/);
  await assert.rejects(record(e.id, ok, { questionOutcomes: outcomes("insufficient_evidence", "illegible", "error", "x² + 10x") }), /excerpt is not in the answer/);
  await assert.rejects(record(e.id, ok, { questionOutcomes: outcomes("insufficient_evidence", "illegible", "error", "[illisible]") }), /excerpt is not in the answer/);
  const run = await record(e.id, ok, { questionOutcomes: outcomes("illegible", "illegible", "error", "x² + 9") });
  const [{ outcomes: stored }] = (await db.query<{ outcomes: Array<{ outcome: string }> }>("select question_outcomes as outcomes from public.ai_analysis_runs where id = $1", [run])).rows;
  assert.deepEqual(stored.map((item) => item.outcome), ["illegible", "illegible", "error"]);
});

test("confidence is bounded by the reading: partial → limitée, unverified scan → at most modérée", async () => {
  const e1 = await assessment([{ prompt: "Développer (x+5)²", correction: "x²+10x+25", code: "MATH.ALG.IDENTITES" }], "2026-09-14");
  const e2 = await assessment([{ prompt: "Développer (2x+1)²", correction: "4x²+4x+1", code: "MATH.ALG.IDENTITES" }], "2026-09-28");
  const e3 = await assessment([
    { prompt: "Aire (x+3)²", correction: "x²+6x+9", code: "MATH.ALG.IDENTITES" },
    { prompt: "Développer (x+1)²", correction: "x²+2x+1", code: "MATH.ALG.IDENTITES" },
  ], "2026-10-05");
  // Two earlier assessments with the same misconception, confirmed by the teacher.
  for (const [e, text] of [[e1, "x² + 25"], [e2, "4x² + 1"]] as const) {
    await save(e.id, [{ questionId: e.questions[0], responseText: text, awardedPoints: "0" }]);
    const run = await record(e.id, [finding(e.questions[0], await responseId(e.questions[0]), text)]);
    const [{ id }] = (await db.query<{ id: string }>("select id from public.pedagogical_recommendations where analysis_run_id = $1", [run])).rows;
    await teacher("select public.focus_review_pedagogical_recommendation($1, 'validate', '')", [id]);
  }
  const confidenceOf = async (run: string) =>
    (await db.query<{ c: string }>("select confidence as c from public.pedagogical_recommendations where analysis_run_id = $1", [run])).rows[0].c;

  // Typed (verified) third copy: the history makes it "forte".
  await save(e3.id, [{ questionId: e3.questions[0], responseText: "x² + 9", awardedPoints: "0" }]);
  assert.equal(await confidenceOf(await record(e3.id, [finding(e3.questions[0], await responseId(e3.questions[0]), "x² + 9")])), "forte");
  // The same copy as an unverified machine reading: at most "modérée".
  await scan(e3.id, [{ questionId: e3.questions[0], responseText: "x² + 9", awardedPoints: "0", transcription: scanned("lisible") }]);
  assert.equal(await confidenceOf(await record(e3.id, [finding(e3.questions[0], await responseId(e3.questions[0]), "x² + 9")])), "moderee");
  // A partially legible reading: "limitée", whatever the history.
  await scan(e3.id, [
    { questionId: e3.questions[0], responseText: "A = x² + 9 ; [illisible]", awardedPoints: "0", transcription: scanned("partielle", true) },
  ]);
  assert.equal(await confidenceOf(await record(e3.id, [finding(e3.questions[0], await responseId(e3.questions[0]), "x² + 9")])), "limitee");
});

test("one isolated error never becomes a general weakness; repetition across assessments raises it", async () => {
  const e1 = await assessment([{ prompt: "Développer (x+5)²", correction: "x²+10x+25", code: "MATH.ALG.IDENTITES" }], "2026-09-14");
  const e2 = await assessment([{ prompt: "Développer (2x+1)²", correction: "4x²+4x+1", code: "MATH.ALG.IDENTITES" }], "2026-09-28");
  const e3 = await assessment([{ prompt: "Aire (x+3)²", correction: "x²+6x+9", code: "MATH.ALG.IDENTITES" }], "2026-10-05");
  const confidence = async (run: string) =>
    (await db.query<{ c: string }>("select confidence as c from public.pedagogical_recommendations where analysis_run_id = $1", [run])).rows[0].c;
  const analyse = async (e: { id: string; questions: string[] }, text: string, student = a.students[0]) => {
    await save(e.id, [{ questionId: e.questions[0], responseText: text, awardedPoints: "0" }], student);
    return record(e.id, [finding(e.questions[0], await responseId(e.questions[0], student), text)], {}, student);
  };
  const decide = async (run: string, decision: "validate" | "dismiss") => {
    const [{ id }] = (await db.query<{ id: string }>("select id from public.pedagogical_recommendations where analysis_run_id = $1", [run])).rows;
    await teacher("select public.focus_review_pedagogical_recommendation($1, $2, '')", [id, decision]);
  };

  // Student 1: a single error stays "limitée".
  const first = await analyse(e1, "x² + 25");
  assert.equal(await confidence(first), "limitee");
  // The same misconception in a second assessment: "modérée" (repeated, not yet confirmed).
  const second = await analyse(e2, "4x² + 1");
  assert.equal(await confidence(second), "moderee");
  // Confirmed by the teacher, then seen again in another context: "forte".
  await decide(first, "validate");
  await decide(second, "validate");
  assert.equal(await confidence(await analyse(e3, "x² + 9")), "forte");

  // Student 2: a dismissed earlier hypothesis does not count as history.
  const other = a.students[1];
  const dismissed = await analyse(e1, "x² + 25", other);
  await decide(dismissed, "dismiss");
  assert.equal(await confidence(await analyse(e2, "4x² + 1", other)), "limitee");
});

test("the same scanned copy imported twice (double click, retried request) changes nothing the second time", async () => {
  const e = await assessment([{ prompt: "Développer (x+5)²", correction: "x²+10x+25", code: "MATH.ALG.IDENTITES" }]);
  const answers = [{ questionId: e.questions[0], responseText: "B = x² + 25", awardedPoints: "0", transcription: scanned("lisible") }];
  await scan(e.id, answers);
  const run = await record(e.id, [finding(e.questions[0], await responseId(e.questions[0]), "x² + 25")]);
  const [{ result }] = await teacher<{ result: { responses: { changed: boolean; supersededAnalyses: number } } }>(
    "select public.focus_import_scanned_copy($1, $2, $3::jsonb, null, false) as result",
    [e.id, a.students[0], JSON.stringify(answers)],
  );
  assert.deepEqual(result.responses, { changed: false, supersededAnalyses: 0 });
  const superseded = (await db.query<{ s: string | null }>("select superseded_at as s from public.ai_analysis_runs where id = $1", [run])).rows[0].s;
  assert.equal(superseded, null, "the current analysis stands");
  assert.equal((await rows(e.id)).length, 1);
});

test("an analysis signed by the previous FOCUS server (no per-question outcomes) is still recorded during the switch-over", async () => {
  // Production runs code older than this migration until it is promoted: its
  // envelopes have no questionOutcomes key. They are recorded as before
  // (no outcomes), with every other check; an envelope that HAS the key is
  // checked strictly, so the new server cannot skip it.
  const e = await assessment([
    { prompt: "Développer (x+5)²", correction: "x²+10x+25", code: "MATH.ALG.IDENTITES" },
    { prompt: "Factoriser x²−9", correction: "(x−3)(x+3)", code: "MATH.ALG.IDENTITES" },
  ]);
  await save(e.id, [
    { questionId: e.questions[0], responseText: "B = x² + 25", awardedPoints: "0" },
    { questionId: e.questions[1], responseText: "(x−3)(x+3)", awardedPoints: "2" },
  ]);
  const errors = [finding(e.questions[0], await responseId(e.questions[0]), "x² + 25")];
  const recommendations = [{ nodeId: node, difficulty: "Développer le carré d’une somme", explanation: "Le double produit est absent.", recommendedAction: "Faire calculer (a+b)(a+b) terme à terme." }];
  const legacy = async (fields: Record<string, unknown>) => {
    const envelope = {
      teacherId: a.teacher, schoolId: a.school, studentId: a.students[0], assessmentId: e.id, model: "legacy-model",
      inputHash: hash(), evidenceVersion: await evidenceVersion(db, e.id, a.students[0]), ...fields,
    } as unknown as EngineEnvelope;
    const signed = signEngineEnvelope(envelope, Buffer.from(TEST_ENGINE_KEY, "hex"));
    return (await teacher<{ run: string }>(RECORD_SQL, [signed.p_envelope, signed.p_signature]))[0].run;
  };

  // The new server's envelope with the key present but empty, and findings: refused.
  await assert.rejects(record(e.id, errors, { questionOutcomes: [] }), /question outcomes are missing/);

  const run = await legacy({ kind: "analysis", errors, recommendations });
  const stored = (await db.query<{ status: string; outcomes: unknown[]; findings: number }>(
    `select r.status, r.question_outcomes as outcomes, (select count(*)::int from public.error_observations o where o.analysis_run_id = r.id) as findings
     from public.ai_analysis_runs r where r.id = $1`,
    [run],
  )).rows[0];
  assert.deepEqual(stored, { status: "completed", outcomes: [], findings: 1 });
  // Still no finding on an excerpt that is not in the answer, even from the old server.
  await assert.rejects(legacy({ kind: "analysis", errors: [finding(e.questions[0], await responseId(e.questions[0]), "x² + 10x")], recommendations }));
  // The old server's "insufficient evidence" is recorded too.
  const noEvidence = await legacy({ kind: "no_evidence", reason: "Réponse trop courte." });
  assert.equal((await db.query<{ status: string }>("select status from public.ai_analysis_runs where id = $1", [noEvidence])).rows[0].status, "no_evidence");
});
