// Run by tests/low-row-cap.test.ts with --conditions=react-server (so the
// server-only data modules load, as on the Next server). The Supabase
// stand-in caps every response at 3 rows; the real server reads must still
// return every row. Exits 0 when all checks pass.

import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { evidenceRows, studentMathContext, studentPedagogy } from "../../lib/pedagogy/server";
import { installEngineKey, signedEnvelope } from "../helpers/engine";
import { createMigratedDatabase } from "../helpers/pg";
import { LOCAL_TEACHER, seedLocalSchool } from "../helpers/local-stack";
import { startLocalSupabase } from "../helpers/local-supabase";

async function main() {
  const db = await createMigratedDatabase();
  const ids = await seedLocalSchool(db);
  await installEngineKey(db);
  const server = await startLocalSupabase(db, {
    port: 54410,
    accounts: [{ email: LOCAL_TEACHER.email, password: LOCAL_TEACHER.password, userId: LOCAL_TEACHER.id }],
    maxRows: 3,
  });
  try {
    const supabase = createClient(server.url, server.publishableKey, { auth: { persistSession: false } });
    const signIn = await supabase.auth.signInWithPassword({ email: LOCAL_TEACHER.email, password: LOCAL_TEACHER.password });
    assert.ok(!signIn.error);
    const student = [...ids.studentIds.values()][0];
    const node = (await db.query<{ id: string }>("select id from public.curriculum_nodes where code = 'MATH.ALG.DISTRIBUTIVITE'")).rows[0].id;

    // Four assessments, each with five questions answered and one analysis.
    const assessments: string[] = [];
    for (let index = 0; index < 4; index++) {
      const id = crypto.randomUUID();
      const saved = await supabase.rpc("focus_save_assessment", {
        p_assessment_id: id,
        p_title: `Contrôle ${index + 1}`,
        p_date: `2026-09-${String(10 + index).padStart(2, "0")}`,
        p_class_id: ids.classId,
        p_subject_id: ids.subject,
        p_competency_ids: [],
        p_results: [],
        p_important: false,
      });
      assert.ok(!saved.error, saved.error?.message);
      const questions = await supabase.rpc("focus_save_assessment_questions", {
        p_assessment_id: id,
        p_context_text: "",
        p_instructions_text: "",
        p_questions: Array.from({ length: 5 }, (_, n) => ({ prompt: `Développer ${n + 2}(x+1).`, correctionText: "…", rubricText: "", maxPoints: "", nodeCodes: ["MATH.ALG.DISTRIBUTIVITE"] })),
        p_confirm_response_deletion: false,
      });
      assert.ok(!questions.error, questions.error?.message);
      const questionIds = (questions.data as { questionIds: string[] }).questionIds;
      const responses = await supabase.rpc("focus_save_student_responses", {
        p_assessment_id: id,
        p_student_id: student,
        p_responses: questionIds.map((questionId, n) => ({ questionId, responseText: `${n + 2}(x+1) = ${n + 2}x+1`, awardedPoints: "", teacherAnnotation: "" })),
      });
      assert.ok(!responses.error, responses.error?.message);
      const responseId = (await db.query<{ id: string }>("select id from public.student_responses where question_id = $1", [questionIds[0]])).rows[0].id;
      // Through PostgREST, signed as the FOCUS server does.
      const run = await supabase.rpc(
        "focus_record_engine_analysis",
        await signedEnvelope(db, {
          kind: "analysis",
          teacherId: LOCAL_TEACHER.id,
          schoolId: ids.school,
          studentId: student,
          assessmentId: id,
          model: "fixture",
          inputHash: String(index).repeat(64).slice(0, 64),
          errors: [{ questionId: questionIds[0], responseId, nodeId: node, errorType: "calcul", evidenceExcerpt: "2x+1", explanation: "Le facteur n’est appliqué qu’au premier terme.", confidence: "limitee", catalogueErrorCode: "" }],
          recommendations: [{ nodeId: node, difficulty: "Distribuer", explanation: "Explication", recommendedAction: "Action", confidence: "limitee", evidence: [] }],
        }),
      );
      assert.ok(!run.error, run.error?.message);
      assessments.push(id);
    }
    // The first (oldest) observation is confirmed by the teacher.
    const first = (await db.query<{ id: string }>("select id from public.pedagogical_recommendations where assessment_id = $1", [assessments[0]])).rows[0].id;
    assert.ok(!(await supabase.rpc("focus_review_pedagogical_recommendation", { p_recommendation_id: first, p_decision: "validate", p_note: null })).error);

    const evidence = await evidenceRows(supabase as never, assessments);
    assert.equal(evidence.questions.length, 20, "all questions despite the 3-row cap");
    assert.equal(evidence.responses.length, 20, "all answers despite the 3-row cap");
    assert.equal(evidence.tags.length, 20, "all notion tags despite the 3-row cap");

    const context = await studentMathContext(supabase as never, LOCAL_TEACHER.id, student);
    assert.equal(context.assessments.length, 9, "all the class's assessments despite the 3-row cap");
    const pedagogy = await studentPedagogy(supabase as never, context, student);
    assert.equal(pedagogy.active.length, 4, "every current recommendation despite the 3-row cap");
    assert.ok(pedagogy.active.some((view) => view.id === first && view.status === "validated"), "the oldest confirmed observation is kept");
    console.log("low-row-cap: OK");
  } finally {
    await server.close();
    await db.close();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
  },
);
