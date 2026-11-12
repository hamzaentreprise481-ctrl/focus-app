// supabase/staging/rls-probe.sql — the rollback-only probe run inside a real
// FOCUS database — on a replica with every migration: each identity sees and
// does only what it should, and the probe leaves nothing behind.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createMigratedDatabase } from "./helpers/pg";
import { installEngineKey } from "./helpers/engine";
import { seedLocalSchool } from "./helpers/local-stack";

const PROBE = readFileSync(path.join(__dirname, "..", "supabase", "staging", "rls-probe.sql"), "utf8");
const NEWEST = readdirSync(path.join(__dirname, "..", "supabase", "migrations")).filter((name) => name.endsWith(".sql")).sort().at(-1)!.slice(0, 14);

test("the RLS probe finds every identity confined, and rolls everything back", async () => {
  const db = await createMigratedDatabase({ recordVersions: true });
  try {
    const ids = await seedLocalSchool(db);
    await installEngineKey(db);
    await db.query("insert into public.subjects(school_id, name, code) values ($1, 'Physique-chimie', 'PC')", [ids.school]);
    const before = (await db.query<{ n: number }>("select (select count(*) from public.assessments) + (select count(*) from public.schools) as n")).rows[0].n;

    const error = await db.exec(PROBE).then(
      () => assert.fail("the probe always ends with an exception"),
      (raised: Error) => raised,
    );
    const json = error.message.match(/FOCUS_RLS_PROBE (\{[\s\S]*\})/)?.[1];
    assert.ok(json, error.message);
    const result = JSON.parse(json);
    const refused = (value: string) => typeof value === "string" && value.startsWith("refused: ");

    assert.deepEqual(
      Object.fromEntries(Object.entries(result.student).filter(([key]) => key.startsWith("reads_"))),
      {
        reads_own_hypotheses: 0, reads_teacher_note: 0, reads_own_observations: 0, reads_runs: 0, reads_review_history: 0,
        reads_own_copy: 1, reads_other_student_copy: 0, reads_questions_and_correction: 0,
      },
    );
    for (const key of ["insert_hypothesis", "decide_hypothesis", "create_learning_path_for_teacher"])
      assert.ok(refused(result.student[key]), `student ${key}: ${result.student[key]}`);
    assert.equal(result.student.edit_own_copy, "no row visible to update");

    for (const key of ["reads_hypotheses", "reads_teacher_note", "reads_observations", "reads_review_history", "reads_runs"])
      assert.equal(result.other_subject_teacher[key], 0, `other subject ${key}`);
    for (const key of ["decide_hypothesis", "record_analysis"])
      assert.ok(refused(result.other_subject_teacher[key]), `other subject ${key}: ${result.other_subject_teacher[key]}`);

    for (const [key, value] of Object.entries(result.other_school_teacher))
      if (key.startsWith("reads_")) assert.equal(value, 0, `other school ${key}`);
      else assert.ok(refused(value as string), `other school ${key}: ${value}`);

    assert.equal(result.maths_teacher.reads_own_hypotheses, 1);
    assert.equal(result.maths_teacher.reads_school_b_class_students, 0);
    for (const key of [
      "insert_ai_output_directly", "raise_confidence_directly", "move_assessment_to_school_b", "grade_school_b_student",
      "max_below_awarded_points", "copy_for_student_of_other_class", "record_forged_analysis", "record_unsigned_envelope",
      "delete_analysed_assessment",
    ])
      assert.ok(refused(result.maths_teacher[key]), `maths teacher ${key}: ${result.maths_teacher[key]}`);
    assert.match(result.maths_teacher.record_forged_analysis, /permission denied for function focus_persist_pedagogical_analysis/);
    assert.match(result.maths_teacher.record_unsigned_envelope, /not signed by the FOCUS engine/);

    assert.ok(refused(result.anon.read_copies) && refused(result.anon.call_work_queue));
    assert.equal(result.schema_version, NEWEST);

    const after = (await db.query<{ n: number }>("select (select count(*) from public.assessments) + (select count(*) from public.schools) as n")).rows[0].n;
    assert.equal(after, before, "nothing created by the probe remains");
  } finally {
    await db.close();
  }
});
