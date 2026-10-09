// Tenant-isolation checks against a REAL Supabase project (staging), with
// the publishable key and two fictitious teacher accounts in different
// classes. Prints PASS/FAIL per check, never a token, key or row content.
//
//   FOCUS_CHECK_SUPABASE_URL=… FOCUS_CHECK_SUPABASE_KEY=<publishable key> \
//   FOCUS_CHECK_TEACHER_A_EMAIL=… FOCUS_CHECK_TEACHER_A_PASSWORD=… \
//   FOCUS_CHECK_TEACHER_B_EMAIL=… FOCUS_CHECK_TEACHER_B_PASSWORD=… \
//   node --import tsx scripts/staging-rls-check.ts [--write]
//
// --write also creates one fictitious assessment as teacher A, checks that
// teacher B can neither write its copies nor record an analysis on it, and
// deletes it. Never point this at production.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const env = (name: string) => {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}.`);
    process.exit(2);
  }
  return value;
};
const url = env("FOCUS_CHECK_SUPABASE_URL");
const key = env("FOCUS_CHECK_SUPABASE_KEY");
const write = process.argv.includes("--write");

let failures = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failures++;
}
const client = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const denied = (error: { code?: string } | null) => error?.code === "42501";

async function signIn(prefix: "A" | "B") {
  const supabase = client();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: env(`FOCUS_CHECK_TEACHER_${prefix}_EMAIL`),
    password: env(`FOCUS_CHECK_TEACHER_${prefix}_PASSWORD`),
  });
  check(`teacher ${prefix} signs in`, !error && !!data.user);
  check(`teacher ${prefix} is a teacher by app_metadata`, data.user?.app_metadata?.role === "teacher");
  if (!data.user) process.exit(1);
  return { supabase, id: data.user.id };
}
async function ids(supabase: SupabaseClient, table: string, column: string, filter?: [string, string[]]) {
  let query = supabase.from(table).select(column);
  if (filter) query = query.in(filter[0], filter[1]);
  const { data, error } = await query;
  if (error) throw new Error(`${table}: ${error.code}`);
  return ((data ?? []) as unknown as Array<Record<string, string>>).map((row) => row[column]);
}

async function main() {
  // Anonymous: no application data, only the schema version.
  const anon = client();
  for (const table of ["profiles", "assessments", "student_responses", "pedagogical_recommendations"]) {
    const { data, error } = await anon.from(table).select("*").limit(1);
    check(`anon cannot read ${table}`, denied(error) || (!error && (data ?? []).length === 0));
  }
  check("anon cannot call the work queue", denied((await anon.rpc("focus_teacher_work_queue")).error));
  const version = await anon.rpc("focus_schema_version");
  check("anon reads the schema version", !version.error && /^\d{14}$/.test(String(version.data)));

  const a = await signIn("A");
  const b = await signIn("B");

  const aAssignments = await ids(a.supabase, "teacher_assignments", "teacher_id");
  check("teacher A only sees their own assignments", aAssignments.length > 0 && aAssignments.every((id) => id === a.id));
  const aClasses = await ids(a.supabase, "teacher_assignments", "class_id");
  const bClasses = await ids(b.supabase, "teacher_assignments", "class_id");
  const aOnly = aClasses.filter((id) => !bClasses.includes(id));
  check("the two teachers have at least one class not shared", aOnly.length > 0);
  if (!aOnly.length) {
    console.log("Stopped: the isolation checks need two teachers with different classes.");
    process.exit(1);
  }

  const aAssessments = await ids(a.supabase, "assessments", "id", ["class_id", aOnly]);
  const seenByB = await ids(b.supabase, "assessments", "id", ["class_id", aOnly]);
  check("teacher B sees no assessment of teacher A's classes", seenByB.length === 0);
  const aStudents = await ids(a.supabase, "student_enrollments", "student_id", ["class_id", aOnly]);
  check("teacher B sees no enrollment of teacher A's classes", (await ids(b.supabase, "student_enrollments", "student_id", ["class_id", aOnly])).length === 0);
  if (aAssessments.length) {
    for (const table of ["assessment_questions", "student_responses", "ai_analysis_runs", "pedagogical_recommendations"])
      check(`teacher B reads no ${table} of teacher A`, (await ids(b.supabase, table, "assessment_id", ["assessment_id", aAssessments])).length === 0);
  }
  check(
    "teachers cannot write AI output directly",
    denied((await b.supabase.from("ai_analysis_runs").insert({ school_id: a.id, teacher_id: b.id, student_id: b.id, model: "x", input_hash: "0".repeat(64), status: "completed" })).error),
  );

  if (write) {
    const [classId] = aOnly;
    const subject = (await a.supabase.from("teacher_assignments").select("subject_id,school_id").eq("class_id", classId).limit(1).single()).data as {
      subject_id: string;
      school_id: string;
    } | null;
    const assessmentId = crypto.randomUUID();
    const created = await a.supabase.rpc("focus_save_assessment", {
      p_assessment_id: assessmentId,
      p_title: "Vérification d’isolation (fictif, supprimée)",
      p_date: new Date().toISOString().slice(0, 10),
      p_class_id: classId,
      p_subject_id: subject?.subject_id,
      p_competency_ids: [],
      p_results: [],
      p_important: false,
    });
    check("teacher A creates a fictitious assessment", !created.error);
    if (!created.error) {
      const questions = await a.supabase.rpc("focus_save_assessment_questions", {
        p_assessment_id: assessmentId,
        p_context_text: "",
        p_instructions_text: "",
        p_questions: [{ prompt: "Développer 2(x+1).", correctionText: "2x+2", rubricText: "", maxPoints: "1", nodeCodes: [] }],
        p_confirm_response_deletion: false,
      });
      const questionId = (questions.data as { questionIds?: string[] } | null)?.questionIds?.[0];
      check("teacher A saves a question", !questions.error && !!questionId);
      const student = aStudents[0];
      if (questionId && student) {
        const responses = await b.supabase.rpc("focus_save_student_responses", {
          p_assessment_id: assessmentId,
          p_student_id: student,
          p_responses: [{ questionId, responseText: "2x+1", awardedPoints: "", teacherAnnotation: "" }],
        });
        check("teacher B cannot write teacher A's copies", denied(responses.error));
        const analysis = await b.supabase.rpc("focus_persist_no_evidence", {
          p_school_id: subject?.school_id,
          p_student_id: student,
          p_assessment_id: assessmentId,
          p_model: "check",
          p_input_hash: "0".repeat(64),
          p_reason: "check",
          p_question_outcomes: [],
        });
        check("teacher B cannot record an analysis on it", denied(analysis.error));
        // Teacher A cannot write AI output either: only the FOCUS server's signed envelope is accepted.
        const forged = await a.supabase.rpc("focus_persist_no_evidence", {
          p_school_id: subject?.school_id,
          p_student_id: student,
          p_assessment_id: assessmentId,
          p_model: "check",
          p_input_hash: "0".repeat(64),
          p_reason: "check",
          p_question_outcomes: [],
        });
        check("teacher A cannot record an analysis by calling the persistence function", denied(forged.error));
        const unsigned = await a.supabase.rpc("focus_record_engine_analysis", {
          p_envelope: JSON.stringify({
            v: 1, kind: "no_evidence", teacherId: a.id, schoolId: subject?.school_id, studentId: student, assessmentId,
            model: "check", inputHash: "0".repeat(64), evidenceVersion: "0".repeat(32), issuedAt: new Date().toISOString(), reason: "check",
          }),
          p_signature: "0".repeat(64),
        });
        check("teacher A cannot record an analysis the FOCUS server did not sign", denied(unsigned.error) || unsigned.error?.code === "55000");
      }
      const removed = await a.supabase.from("assessments").delete().eq("id", assessmentId);
      check("the fictitious assessment is deleted", !removed.error);
    }
  }

  console.log(failures ? `${failures} check(s) failed.` : "All isolation checks passed.");
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error(`FAIL unexpected error: ${error instanceof Error ? error.message : "unknown"}`);
  process.exit(1);
});
