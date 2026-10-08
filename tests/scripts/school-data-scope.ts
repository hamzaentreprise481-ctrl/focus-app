// Run by tests/school-data-scope.test.ts with --conditions=react-server.
// The teacher's workspace reader, through the caller's RLS, must keep only
// the assessments of the teacher's own (class, subject) assignments: RLS
// lets a teacher read a colleague's assessments in a class they share.

import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { readSchoolData } from "../../lib/school-data-reader";
import { createMigratedDatabase } from "../helpers/pg";
import { LOCAL_TEACHER, OTHER_TEACHER, fixtureUuid, seedLocalSchool } from "../helpers/local-stack";
import { startLocalSupabase } from "../helpers/local-supabase";

async function main() {
  const db = await createMigratedDatabase();
  const ids = await seedLocalSchool(db);
  const physics = fixtureUuid("subject:physics");
  await db.query("insert into public.subjects(id, school_id, name, code) values ($1, $2, 'Physique-chimie', 'PC')", [physics, ids.school]);
  // A colleague teaches physics in the teacher's class and gave a test there.
  await db.query("insert into public.teacher_assignments(school_id, teacher_id, class_id, subject_id) values ($1, $2, $3, $4)", [
    ids.school, OTHER_TEACHER.id, ids.classId, physics,
  ]);
  await db.query(
    "insert into public.assessments(school_id, class_id, subject_id, teacher_id, title, date) values ($1, $2, $3, $4, 'Physique : circuits', '2026-10-02')",
    [ids.school, ids.classId, physics, OTHER_TEACHER.id],
  );
  // The teacher also teaches physics, in another class.
  await db.query("insert into public.teacher_assignments(school_id, teacher_id, class_id, subject_id) values ($1, $2, $3, $4)", [
    ids.school, LOCAL_TEACHER.id, ids.otherClassId, physics,
  ]);

  const server = await startLocalSupabase(db, {
    port: 54420,
    accounts: [{ email: LOCAL_TEACHER.email, password: LOCAL_TEACHER.password, userId: LOCAL_TEACHER.id }],
  });
  try {
    const supabase = createClient(server.url, server.publishableKey, { auth: { persistSession: false } });
    const signIn = await supabase.auth.signInWithPassword({ email: LOCAL_TEACHER.email, password: LOCAL_TEACHER.password });
    assert.ok(!signIn.error);
    // Sanity: RLS does expose the colleague's assessment to this teacher.
    const visible = await supabase.from("assessments").select("title").eq("class_id", ids.classId);
    assert.ok(visible.data?.some((row) => row.title === "Physique : circuits"), "precondition: RLS exposes the colleague's assessment");

    const data = await readSchoolData(supabase as never, LOCAL_TEACHER.id);
    const titles = data.dataset.evaluations.map((evaluation) => evaluation.name);
    assert.ok(!titles.includes("Physique : circuits"), "a colleague's other-subject assessment is not in the analysis");
    assert.ok(!titles.includes("Contrôle Seconde 5"), "a colleague's mathematics assessment in another class is not in the analysis");
    assert.equal(data.dataset.evaluations.filter((evaluation) => evaluation.classId === ids.classId).length, ids.assessmentIds.size);
    const classes = new Map(data.dataset.classes.map((c) => [c.id, c.subject]));
    assert.equal(classes.get(ids.classId), "Mathématiques");
    assert.equal(classes.get(ids.otherClassId), "Physique-chimie");
    assert.deepEqual(data.editableEvaluationIds.sort(), [...ids.assessmentIds.values()].sort());
    console.log("school-data-scope: OK");
  } finally {
    await server.close();
    await db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
