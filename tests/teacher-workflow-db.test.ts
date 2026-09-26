// Teacher workflow on the real schema (every migration, real RLS): assessment
// definition vs student evidence, supersession, AI-output write paths,
// database-computed confidence and teacher review history.

import { after, afterEach, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { buildCurriculumIndex, parseCurriculumGraphPayload } from "../lib/curriculum/graph";
import { relatedNotionCodes } from "../lib/pedagogy/analysis";
import { createMigratedDatabase, seedSchoolFixture, type SchoolFixtureIds } from "./helpers/pg";

let db: PGlite;
let a: SchoolFixtureIds;
let otherTeacher: string;
let otherClass: string;
let otherStudent: string;

before(async () => {
  db = await createMigratedDatabase();
  a = await seedSchoolFixture(db, { students: [null, null, null] as unknown as string[] });
  const one = async (sql: string, params: unknown[] = []) => (await db.query<{ id: string }>(sql, params)).rows[0].id;
  otherTeacher = await one(`insert into auth.users(email, raw_app_meta_data) values ('b@example.test', '{"role":"teacher"}') returning id`);
  otherStudent = await one("insert into auth.users default values returning id");
  otherClass = await one(
    "insert into public.classes(school_id, academic_year_id, name, level) values ($1, $2, 'Seconde 5', 'Seconde') returning id",
    [a.school, a.year],
  );
  await db.query("insert into public.school_memberships(school_id, user_id, role) values ($1, $2, 'teacher'), ($1, $3, 'student')", [a.school, otherTeacher, otherStudent]);
  await db.query("insert into public.teacher_assignments(school_id, teacher_id, class_id, subject_id) values ($1, $2, $3, $4)", [a.school, otherTeacher, otherClass, a.subject]);
  await db.query("insert into public.student_enrollments(school_id, student_id, class_id, academic_year_id) values ($1, $2, $3, $4)", [a.school, otherStudent, otherClass, a.year]);
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

async function as<T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec("savepoint call");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
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

async function assessment(title = "Contrôle", owner = a.teacher, classId = a.classId) {
  const [{ id }] = await as<{ id: string }>(
    owner,
    "select public.focus_save_assessment($1, $2, current_date, $3, $4, '{}'::uuid[], '[]'::jsonb, true) as id",
    [randomUUID(), title, classId, a.subject],
  );
  return id;
}

type QuestionDraft = { id?: string; prompt?: string; correctionText?: string; rubricText?: string; maxPoints?: string; nodeCodes?: string[] };
async function saveQuestions(assessmentId: string, questions: QuestionDraft[], confirm = false, user = a.teacher) {
  const [{ result }] = await as<{ result: { changed: boolean; questionIds: string[]; supersededAnalyses: number; deletedAnswers: number } }>(
    user,
    "select public.focus_save_assessment_questions($1, 'Sujet', 'Consignes', $2::jsonb, $3) as result",
    [assessmentId, JSON.stringify(questions.map((q) => ({ prompt: "Développer 3(x+2).", correctionText: "3x+6", ...q }))), confirm],
  );
  return result;
}
async function saveResponses(assessmentId: string, studentId: string, responses: Array<{ questionId: string; responseText?: string; awardedPoints?: string; teacherAnnotation?: string }>, user = a.teacher) {
  const [{ result }] = await as<{ result: { changed: boolean; supersededAnalyses: number } }>(
    user,
    "select public.focus_save_student_responses($1, $2, $3::jsonb) as result",
    [assessmentId, studentId, JSON.stringify(responses)],
  );
  return result;
}
const nodeId = async (code: string) =>
  (await db.query<{ id: string }>("select id from public.curriculum_nodes where code = $1", [code])).rows[0].id;
const hash = () => createHash("sha256").update(randomUUID()).digest("hex");

async function analyse(assessmentId: string, studentId: string, errors: Array<{ questionId: string; node: string; excerpt: string; confidence?: string }>) {
  const responses = await teacher<{ id: string; question_id: string }>(
    "select id, question_id from public.student_responses where assessment_id = $1 and student_id = $2",
    [assessmentId, studentId],
  );
  const payloadErrors = [];
  for (const error of errors)
    payloadErrors.push({
      questionId: error.questionId,
      responseId: responses.find((row) => row.question_id === error.questionId)!.id,
      nodeId: await nodeId(error.node),
      errorType: "calcul",
      evidenceExcerpt: error.excerpt,
      explanation: "Le facteur n’est appliqué qu’au premier terme.",
      confidence: error.confidence ?? "forte",
    });
  const nodes = [...new Set(payloadErrors.map((item) => item.nodeId))];
  const [{ run }] = await teacher<{ run: string }>(
    "select public.focus_persist_pedagogical_analysis($1, $2, $3, 'test-model', $4, $5::jsonb, $6::jsonb) as run",
    [
      a.school,
      studentId,
      assessmentId,
      hash(),
      JSON.stringify(payloadErrors),
      JSON.stringify(nodes.map((id) => ({ nodeId: id, difficulty: "Distribuer", explanation: "Explication", recommendedAction: "Action", confidence: "forte", evidence: [{ questionId: "forged", excerpt: "forged" }] }))),
    ],
  );
  return run;
}

async function activeRuns(assessmentId: string, studentId?: string) {
  return (
    await db.query<{ n: number }>(
      "select count(*)::int as n from public.ai_analysis_runs where assessment_id = $1 and ($2::uuid is null or student_id = $2) and superseded_at is null",
      [assessmentId, studentId ?? null],
    )
  ).rows[0].n;
}

// ---------------------------------------------------------------------------

test("AI output tables cannot be written directly, only through the audited functions", async () => {
  const assessmentId = await assessment();
  const attempts = [
    ["insert into public.ai_analysis_runs(school_id, teacher_id, student_id, assessment_id, model, input_hash, status) values ($1, $2, $3, $4, 'm', 'h', 'completed')", [a.school, a.teacher, a.students[0], assessmentId]],
    ["update public.pedagogical_recommendations set confidence = 'forte'", []],
    ["update public.ai_analysis_runs set superseded_at = null", []],
    ["delete from public.error_observations", []],
    ["insert into public.pedagogical_review_events(recommendation_id, school_id, student_id, decision, decided_by) values ($1, $2, $3, 'validated', $4)", [randomUUID(), a.school, a.students[0], a.teacher]],
  ] as const;
  for (const [sql, params] of attempts)
    await assert.rejects(teacher(sql, [...params]), /permission denied/, sql);
  // The old combined per-student editor function no longer exists.
  await assert.rejects(teacher("select public.focus_save_pedagogical_evidence($1, $2, '', '', '[]')", [assessmentId, a.students[0]]), /does not exist/);
});

test("assessment definition: create, reorder without collisions, no-op saves change nothing", async () => {
  const assessmentId = await assessment();
  const first = await saveQuestions(assessmentId, [{ prompt: "Q1", maxPoints: "2" }, { prompt: "Q2", maxPoints: "3" }, { prompt: "Q3" }]);
  assert.equal(first.changed, true);
  const [q1, q2, q3] = first.questionIds;
  // Reverse the order: every kept question changes position.
  const reordered = await saveQuestions(assessmentId, [
    { id: q3, prompt: "Q3" },
    { id: q2, prompt: "Q2", maxPoints: "3" },
    { id: q1, prompt: "Q1", maxPoints: "2" },
  ]);
  assert.equal(reordered.changed, true);
  const rows = await teacher<{ id: string; position: number }>("select id, position from public.assessment_questions where assessment_id = $1 order by position", [assessmentId]);
  assert.deepEqual(rows.map((row) => row.id), [q3, q2, q1]);
  // Same content again (2 vs 2.00 included): nothing is written.
  const same = await saveQuestions(assessmentId, [
    { id: q3, prompt: "Q3" },
    { id: q2, prompt: "Q2", maxPoints: "3.00" },
    { id: q1, prompt: "Q1", maxPoints: "2" },
  ]);
  assert.deepEqual([same.changed, same.supersededAnalyses], [false, 0]);
  const [{ important }] = await teacher<{ important: boolean }>("select important from public.assessments where id = $1", [assessmentId]);
  assert.equal(important, true);
});

test("assessment definition is validated before anything is written", async () => {
  const assessmentId = await assessment();
  const other = await assessment("Autre");
  const [foreign] = (await saveQuestions(other, [{ prompt: "Autre question" }])).questionIds;
  const cases: Array<[QuestionDraft[], RegExp]> = [
    [[{ prompt: " " }], /needs a prompt/],
    [[{ correctionText: "" }], /needs a correction/],
    [[{ maxPoints: "0" }], /maximum points/],
    [[{ maxPoints: "abc" }], /invalid maximum points/],
    [[{ nodeCodes: ["MATH.COMP.CALCULER"] }], /unknown or inactive notion/],
    [[{ nodeCodes: ["MATH.INVENTE"] }], /unknown or inactive notion/],
    [[{ id: foreign }], /belongs to another assessment/],
    [Array.from({ length: 41 }, () => ({})), /at most 40/],
  ];
  for (const [questions, error] of cases) await assert.rejects(saveQuestions(assessmentId, questions), error);
  assert.deepEqual(await teacher("select id from public.assessment_questions where assessment_id = $1", [assessmentId]), []);
  // Another teacher cannot write the definition.
  await assert.rejects(saveQuestions(assessmentId, [{}], false, otherTeacher), /not writable/);
});

test("removing a question with answers requires explicit confirmation", async () => {
  const assessmentId = await assessment();
  const [q1, q2] = (await saveQuestions(assessmentId, [{ prompt: "Q1" }, { prompt: "Q2" }])).questionIds;
  await saveResponses(assessmentId, a.students[0], [{ questionId: q2, responseText: "3x+2" }]);
  await assert.rejects(saveQuestions(assessmentId, [{ id: q1, prompt: "Q1" }]), /deletes 1 student answers/);
  assert.equal((await teacher("select 1 from public.student_responses where question_id = $1", [q2])).length, 1);
  const confirmed = await saveQuestions(assessmentId, [{ id: q1, prompt: "Q1" }], true);
  assert.deepEqual([confirmed.changed, confirmed.deletedAnswers], [true, 1]);
  assert.equal((await teacher("select 1 from public.student_responses where question_id = $1", [q2])).length, 0);
});

test("student evidence: points within the maximum, questions of this assessment, enrolled students only", async () => {
  const assessmentId = await assessment();
  const other = await assessment("Autre");
  const [q] = (await saveQuestions(assessmentId, [{ maxPoints: "2" }])).questionIds;
  const [foreign] = (await saveQuestions(other, [{}])).questionIds;
  await assert.rejects(saveResponses(assessmentId, a.students[0], [{ questionId: q, responseText: "x", awardedPoints: "3" }]), /points must be between/);
  await assert.rejects(saveResponses(assessmentId, a.students[0], [{ questionId: q, awardedPoints: "-1" }]), /points must be between/);
  await assert.rejects(saveResponses(assessmentId, a.students[0], [{ questionId: foreign, responseText: "x" }]), /another assessment/);
  await assert.rejects(saveResponses(assessmentId, otherStudent, [{ questionId: q, responseText: "x" }]), /not enrolled/);
  await assert.rejects(saveResponses(assessmentId, a.students[0], [{ questionId: q, responseText: "x" }], otherTeacher), /not writable/);
  // The database checks even a direct write that RLS allows.
  await saveResponses(assessmentId, a.students[0], [{ questionId: q, responseText: "3x+2", awardedPoints: "1.5" }]);
  await assert.rejects(teacher("update public.student_responses set awarded_points = 5 where question_id = $1", [q]), /exceed the question maximum/);
  // A response cannot point at another assessment's question.
  await assert.rejects(
    teacher("insert into public.student_responses(assessment_id, question_id, student_id, response_text) values ($1, $2, $3, 'x')", [assessmentId, foreign, a.students[1]]),
    /violates foreign key|row-level security/,
  );
  // Lowering the maximum below awarded points is refused.
  await assert.rejects(saveQuestions(assessmentId, [{ id: q, maxPoints: "1" }]), /below points already awarded/);
  // Clearing every field removes the row; saving the same values is a no-op.
  assert.equal((await saveResponses(assessmentId, a.students[0], [{ questionId: q, responseText: "3x+2", awardedPoints: "1.50" }])).changed, false);
  assert.equal((await saveResponses(assessmentId, a.students[0], [{ questionId: q, responseText: " ", awardedPoints: "" }])).changed, true);
  assert.equal((await teacher("select 1 from public.student_responses where question_id = $1", [q])).length, 0);
});

test("editing a student's evidence supersedes only that student's analysis; editing the correction supersedes the whole class", async () => {
  const assessmentId = await assessment();
  const [q] = (await saveQuestions(assessmentId, [{ nodeCodes: ["MATH.ALG.DISTRIBUTIVITE"] }])).questionIds;
  for (const student of a.students.slice(0, 2)) {
    await saveResponses(assessmentId, student, [{ questionId: q, responseText: "3(x+2)=3x+2" }]);
    await analyse(assessmentId, student, [{ questionId: q, node: "MATH.ALG.DISTRIBUTIVITE", excerpt: "3x+2" }]);
  }
  assert.equal(await activeRuns(assessmentId), 2);
  const edited = await saveResponses(assessmentId, a.students[0], [{ questionId: q, responseText: "3(x+2)=3x+6" }]);
  assert.deepEqual([edited.changed, edited.supersededAnalyses], [true, 1]);
  assert.deepEqual([await activeRuns(assessmentId, a.students[0]), await activeRuns(assessmentId, a.students[1])], [0, 1]);
  const [{ superseded }] = await teacher<{ superseded: number }>(
    "select count(*)::int as superseded from public.pedagogical_recommendations where assessment_id = $1 and student_id = $2 and superseded_at is not null",
    [assessmentId, a.students[0]],
  );
  assert.equal(superseded, 1);
  // A direct write (allowed by RLS) supersedes too: the trigger does it.
  await analyse(assessmentId, a.students[0], [{ questionId: q, node: "MATH.ALG.DISTRIBUTIVITE", excerpt: "3x+6" }]);
  await teacher("update public.student_responses set teacher_annotation = 'vu' where question_id = $1 and student_id = $2", [q, a.students[0]]);
  assert.equal(await activeRuns(assessmentId, a.students[0]), 0);
  // The correction belongs to the class: changing it supersedes everyone.
  const redefined = await saveQuestions(assessmentId, [{ id: q, correctionText: "3x + 6", nodeCodes: ["MATH.ALG.DISTRIBUTIVITE"] }]);
  assert.deepEqual([redefined.changed, redefined.supersededAnalyses], [true, 1]);
  assert.equal(await activeRuns(assessmentId), 0);
  // Changing only the assessed notions supersedes as well.
  await analyse(assessmentId, a.students[1], [{ questionId: q, node: "MATH.ALG.DISTRIBUTIVITE", excerpt: "3x+2" }]);
  await saveQuestions(assessmentId, [{ id: q, correctionText: "3x + 6", nodeCodes: ["MATH.ALG.DISTRIBUTIVITE", "MATH.ALG.FACTORISATION_SIMPLE"] }]);
  assert.equal(await activeRuns(assessmentId), 0);
});

test("the database computes confidence from history and rebuilds recommendation evidence", async () => {
  const first = await assessment("A1");
  const [q1] = (await saveQuestions(first, [{}])).questionIds;
  await saveResponses(first, a.students[0], [{ questionId: q1, responseText: "3(x+2)=3x+2" }]);
  await analyse(first, a.students[0], [{ questionId: q1, node: "MATH.ALG.DISTRIBUTIVITE", excerpt: "3x+2", confidence: "forte" }]);
  const [rec] = await teacher<{ id: string; confidence: string; evidence: unknown }>(
    "select id, confidence, evidence from public.pedagogical_recommendations where assessment_id = $1",
    [first],
  );
  // The caller asked for "forte"; one observation is "limitee". Forged
  // evidence is replaced by the validated excerpt.
  assert.equal(rec.confidence, "limitee");
  assert.deepEqual(rec.evidence, [{ questionId: q1, excerpt: "3x+2" }]);

  // A second assessment with the same error: moderee.
  const second = await assessment("A2");
  const [q2] = (await saveQuestions(second, [{}])).questionIds;
  await saveResponses(second, a.students[0], [{ questionId: q2, responseText: "2(x+5)=2x+5" }]);
  await analyse(second, a.students[0], [{ questionId: q2, node: "MATH.ALG.DISTRIBUTIVITE", excerpt: "2x+5" }]);
  let [{ confidence }] = await teacher<{ confidence: string }>("select confidence from public.pedagogical_recommendations where assessment_id = $1", [second]);
  assert.equal(confidence, "moderee");

  // Once the teacher confirms the earlier one, a third occurrence is forte.
  await teacher("select public.focus_review_pedagogical_recommendation($1, 'validate', 'Vu en classe')", [rec.id]);
  const third = await assessment("A3");
  const [q3] = (await saveQuestions(third, [{}])).questionIds;
  await saveResponses(third, a.students[0], [{ questionId: q3, responseText: "4(x+1)=4x+1" }]);
  await analyse(third, a.students[0], [{ questionId: q3, node: "MATH.ALG.DISTRIBUTIVITE", excerpt: "4x+1" }]);
  [{ confidence }] = await teacher<{ confidence: string }>("select confidence from public.pedagogical_recommendations where assessment_id = $1", [third]);
  assert.equal(confidence, "forte");

  // A dismissed observation no longer counts: dismissing both earlier ones
  // brings a new occurrence back to limitee.
  for (const assessmentId of [first, second]) {
    const [{ id }] = await teacher<{ id: string }>("select id from public.pedagogical_recommendations where assessment_id = $1", [assessmentId]);
    await teacher("select public.focus_review_pedagogical_recommendation($1, 'dismiss')", [id]);
  }
  const fourth = await assessment("A4");
  const [q4] = (await saveQuestions(fourth, [{}])).questionIds;
  await saveResponses(fourth, a.students[0], [{ questionId: q4, responseText: "5(x+1)=5x+1" }]);
  await analyse(fourth, a.students[0], [{ questionId: q4, node: "MATH.ALG.DISTRIBUTIVITE", excerpt: "5x+1" }]);
  [{ confidence }] = await teacher<{ confidence: string }>("select confidence from public.pedagogical_recommendations where assessment_id = $1", [fourth]);
  assert.equal(confidence, "moderee"); // the third (not dismissed) still counts
});

test("persisted errors must quote the answer meaningfully, target a notion and relate to the tagged notions", async () => {
  const assessmentId = await assessment();
  const [q] = (await saveQuestions(assessmentId, [{ nodeCodes: ["MATH.ALG.DISTRIBUTIVITE"] }])).questionIds;
  await saveResponses(assessmentId, a.students[0], [{ questionId: q, responseText: "3(x+2)=3x+2" }]);
  await assert.rejects(analyse(assessmentId, a.students[0], [{ questionId: q, node: "MATH.ALG.DISTRIBUTIVITE", excerpt: "2" }]), /invalid evidence reference/);
  await assert.rejects(analyse(assessmentId, a.students[0], [{ questionId: q, node: "MATH.ALG.DISTRIBUTIVITE", excerpt: "3x+6" }]), /invalid evidence reference/);
  await assert.rejects(analyse(assessmentId, a.students[0], [{ questionId: q, node: "MATH.COMP.CALCULER", excerpt: "3x+2" }]), /invalid curriculum notion/);
  await assert.rejects(analyse(assessmentId, a.students[0], [{ questionId: q, node: "MATH.STAT.PROPORTIONS", excerpt: "3x+2" }]), /unrelated to the question/);
  // A recommendation needs validated evidence on its own notion.
  const [{ id: responseId }] = await teacher<{ id: string }>("select id from public.student_responses where question_id = $1", [q]);
  await assert.rejects(
    teacher("select public.focus_persist_pedagogical_analysis($1, $2, $3, 'm', $4, $5::jsonb, $6::jsonb)", [
      a.school,
      a.students[0],
      assessmentId,
      hash(),
      JSON.stringify([{ questionId: q, responseId, nodeId: await nodeId("MATH.ALG.DISTRIBUTIVITE"), errorType: "calcul", evidenceExcerpt: "3x+2", explanation: "e" }]),
      JSON.stringify([{ nodeId: await nodeId("MATH.ALG.FACTORISATION_SIMPLE"), difficulty: "d", explanation: "e", recommendedAction: "a" }]),
    ]),
    /recommendation without evidence/,
  );
  assert.equal(await activeRuns(assessmentId), 0);
  // The other teacher cannot analyse a student of this class.
  await assert.rejects(
    as(otherTeacher, "select public.focus_persist_no_evidence($1, $2, $3, 'm', $4, 'r')", [a.school, a.students[0], assessmentId, hash()]),
    /not accessible/,
  );
});

test("TypeScript and SQL agree on which notions relate to a question's assessed notions", async () => {
  const [{ graph }] = await teacher<{ graph: unknown }>("select public.focus_curriculum_graph('MATH', array['SECONDE_GT']) as graph");
  const index = buildCurriculumIndex(parseCurriculumGraphPayload(graph));
  const notions = index.summaries.filter((summary) => summary.inScope && summary.nodeType === "notion");
  const assessmentId = await assessment();
  const tags = ["MATH.ALG.DISTRIBUTIVITE", "MATH.FONC.SIGNES", "MATH.STAT.PROPORTIONS", "MATH.GEO.VECTEURS"].filter((code) => index.nodeByCode.has(code));
  const questionIds = (await saveQuestions(assessmentId, tags.map((code) => ({ nodeCodes: [code] })))).questionIds;
  for (const [position, tag] of tags.entries()) {
    const expected = relatedNotionCodes(index.summaries, [tag]);
    const rows = await teacher<{ code: string; related: boolean }>(
      "select n.code, public.focus_notion_related_to_question(n.id, $1) as related from public.curriculum_nodes n where n.code = any($2::text[])",
      [questionIds[position], notions.map((notion) => notion.code)],
    );
    for (const row of rows) assert.equal(row.related, expected.has(row.code), `${tag} → ${row.code}`);
  }
});

test("teacher review: explicit decisions, notes and history; superseded recommendations are frozen", async () => {
  const assessmentId = await assessment();
  const [q] = (await saveQuestions(assessmentId, [{}])).questionIds;
  await saveResponses(assessmentId, a.students[0], [{ questionId: q, responseText: "3(x+2)=3x+2" }]);
  await analyse(assessmentId, a.students[0], [{ questionId: q, node: "MATH.ALG.DISTRIBUTIVITE", excerpt: "3x+2" }]);
  const [{ id }] = await teacher<{ id: string }>("select id from public.pedagogical_recommendations where assessment_id = $1", [assessmentId]);

  await teacher("select public.focus_review_pedagogical_recommendation($1, 'validate', 'Confirmé en classe')", [id]);
  await teacher("select public.focus_review_pedagogical_recommendation($1, 'dismiss', 'Finalement une étourderie')", [id]);
  const [rec] = await teacher<{ teacher_decision: string; teacher_note: string; teacher_validated: boolean; dismissed_at: string | null }>(
    "select teacher_decision, teacher_note, teacher_validated, dismissed_at from public.pedagogical_recommendations where id = $1",
    [id],
  );
  assert.deepEqual([rec.teacher_decision, rec.teacher_note, rec.teacher_validated, rec.dismissed_at !== null], ["dismissed", "Finalement une étourderie", false, true]);
  const [observation] = await teacher<{ teacher_decision: string; verified_by_teacher: boolean }>(
    "select teacher_decision, verified_by_teacher from public.error_observations where assessment_id = $1",
    [assessmentId],
  );
  assert.deepEqual([observation.teacher_decision, observation.verified_by_teacher], ["dismissed", false]);
  const events = await teacher<{ decision: string; note: string }>(
    "select decision, note from public.pedagogical_review_events where recommendation_id = $1 order by decided_at, id",
    [id],
  );
  assert.deepEqual(events.map((event) => event.decision).sort(), ["dismissed", "validated"]);
  // Other teachers see neither the recommendation nor its history.
  assert.deepEqual(await as(otherTeacher, "select id from public.pedagogical_recommendations where id = $1", [id]), []);
  assert.deepEqual(await as(otherTeacher, "select id from public.pedagogical_review_events where recommendation_id = $1", [id]), []);
  await assert.rejects(as(otherTeacher, "select public.focus_review_pedagogical_recommendation($1, 'validate')", [id]), /not writable/);
  await assert.rejects(teacher("select public.focus_review_pedagogical_recommendation($1, 'maybe')", [id]), /invalid decision/);

  // New evidence supersedes the recommendation: it can no longer be decided.
  await saveResponses(assessmentId, a.students[0], [{ questionId: q, responseText: "3(x+2)=3x+6" }]);
  await assert.rejects(teacher("select public.focus_review_pedagogical_recommendation($1, 'validate')", [id]), /superseded/);
});

test("an assessment with questions cannot move to another class", async () => {
  const assessmentId = await assessment();
  await saveQuestions(assessmentId, [{}]);
  const [otherClassOfA] = (
    await db.query<{ id: string }>(
      "insert into public.classes(school_id, academic_year_id, name, level) values ($1, $2, 'Seconde 9', 'Seconde') returning id",
      [a.school, a.year],
    )
  ).rows;
  await db.query("insert into public.teacher_assignments(school_id, teacher_id, class_id, subject_id) values ($1, $2, $3, $4)", [a.school, a.teacher, otherClassOfA.id, a.subject]);
  await assert.rejects(
    teacher("select public.focus_save_assessment($1, 'Contrôle', current_date, $2, $3, '{}'::uuid[], '[]'::jsonb, false)", [assessmentId, otherClassOfA.id, a.subject]),
    /cannot change class/,
  );
});

test("teachers read only their own classes' evidence", async () => {
  const assessmentId = await assessment();
  const [q] = (await saveQuestions(assessmentId, [{}])).questionIds;
  await saveResponses(assessmentId, a.students[0], [{ questionId: q, responseText: "3x+2" }]);
  for (const table of ["assessment_questions", "student_responses", "assessment_materials"])
    assert.deepEqual(await as(otherTeacher, `select 1 from public.${table} where assessment_id = $1`, [assessmentId]), [], table);
  assert.deepEqual(await as(otherTeacher, "select 1 from public.assessments where id = $1", [assessmentId]), []);
  assert.deepEqual(await as(otherTeacher, "select 1 from public.profiles where id = $1", [a.students[0]]), []);
});

test("the dashboard work queue follows evidence, analyses and decisions, through the caller's RLS", async () => {
  type Row = { assessmentId: string; questionCount: number; answeredStudentIds: string[]; needsAnalysisStudentIds: string[]; pendingReviews: Array<{ studentId: string; count: number }> };
  const queue = async (user = a.teacher) => (await as<{ q: Row[] }>(user, "select public.focus_teacher_work_queue() as q"))[0].q;
  const row = async (id: string, user = a.teacher) => (await queue(user)).find((item) => item.assessmentId === id);
  const sorted = (ids: string[]) => [...ids].sort();

  const empty = await assessment("Sans sujet");
  assert.deepEqual(await row(empty), { assessmentId: empty, questionCount: 0, answeredStudentIds: [], needsAnalysisStudentIds: [], pendingReviews: [] });

  const assessmentId = await assessment("Copies");
  const [q] = (await saveQuestions(assessmentId, [{}])).questionIds;
  await saveResponses(assessmentId, a.students[0], [{ questionId: q, responseText: "3(x+2)=3x+2" }]);
  await saveResponses(assessmentId, a.students[1], [{ questionId: q, responseText: "3x+6" }]);
  // Points without an answer is not a copy to analyse.
  await saveResponses(assessmentId, a.students[2], [{ questionId: q, responseText: "  ", awardedPoints: "0" }]);
  let current = (await row(assessmentId))!;
  assert.equal(current.questionCount, 1);
  assert.deepEqual(current.answeredStudentIds, sorted([a.students[0], a.students[1]]));
  assert.deepEqual(current.needsAnalysisStudentIds, sorted([a.students[0], a.students[1]]));

  await analyse(assessmentId, a.students[0], [{ questionId: q, node: "MATH.ALG.DISTRIBUTIVITE", excerpt: "3x+2" }]);
  await teacher("select public.focus_persist_no_evidence($1, $2, $3, 'm', $4, 'Réponse juste')", [a.school, a.students[1], assessmentId, hash()]);
  current = (await row(assessmentId))!;
  assert.deepEqual(current.needsAnalysisStudentIds, []);
  assert.deepEqual(current.pendingReviews, [{ studentId: a.students[0], count: 1 }]);

  // A decision takes the hypothesis out of the queue.
  const [{ id }] = await teacher<{ id: string }>("select id from public.pedagogical_recommendations where assessment_id = $1", [assessmentId]);
  await teacher("select public.focus_review_pedagogical_recommendation($1, 'validate')", [id]);
  assert.deepEqual((await row(assessmentId))!.pendingReviews, []);

  // Editing a copy supersedes its analysis: it needs a new one.
  await saveResponses(assessmentId, a.students[1], [{ questionId: q, responseText: "3x+5" }]);
  assert.deepEqual((await row(assessmentId))!.needsAnalysisStudentIds, [a.students[1]]);

  // Another teacher's queue never lists these assessments; anon cannot call it.
  assert.equal(await row(assessmentId, otherTeacher), undefined);
  await assert.rejects(
    (async () => {
      await db.exec("savepoint anon");
      try {
        await db.exec("set local role anon");
        await db.query("select public.focus_teacher_work_queue()");
      } finally {
        await db.exec("rollback to savepoint anon");
      }
    })(),
    /permission denied/,
  );
});
