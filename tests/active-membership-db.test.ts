// A teaching assignment grants access only while the teacher's membership
// in the school is active (migration 20261007090000): a disabled teacher's
// still-valid session reads no class, student, result or AI output and can
// record nothing; re-activating the membership restores access.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, createMigratedDatabase } from "./helpers/pg";
import { LOCAL_TEACHER, seedLocalSchool } from "./helpers/local-stack";

async function asTeacher<T>(db: PGlite, fn: () => Promise<T>) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)", [
    LOCAL_TEACHER.id,
    JSON.stringify({ sub: LOCAL_TEACHER.id, role: "authenticated", app_metadata: { role: "teacher" } }),
  ]);
  try {
    return await asRole(db, "authenticated", fn);
  } finally {
    await db.query("select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false)");
  }
}

const count = async (db: PGlite, sql: string) => Number((await db.query<{ n: number }>(sql)).rows[0].n);

test("a disabled teacher membership closes every class-based access until it is re-activated", async () => {
  const db = await createMigratedDatabase();
  try {
    const ids = await seedLocalSchool(db);
    const reads = () =>
      asTeacher(db, async () => ({
        classes: await count(db, "select count(*)::int as n from public.classes"),
        enrollments: await count(db, "select count(*)::int as n from public.student_enrollments"),
        assessments: await count(db, "select count(*)::int as n from public.assessments"),
        results: await count(db, "select count(*)::int as n from public.assessment_results"),
        queue: ((await db.query<{ q: unknown[] }>("select public.focus_teacher_work_queue() as q")).rows[0].q ?? []).length,
      }));
    const save = (title: string) =>
      asTeacher(db, () =>
        db.query("select public.focus_save_assessment($1, $2, $3::date, $4, $5, '{}'::uuid[], '[]'::jsonb, false)", [
          crypto.randomUUID(),
          title,
          "2026-11-02",
          ids.classId,
          ids.subject,
        ]),
      );

    const active = await reads();
    assert.ok(active.classes > 0 && active.enrollments > 0 && active.assessments > 0 && active.results > 0 && active.queue > 0);
    await save("Contrôle — membre actif");

    await db.query("update public.school_memberships set status = 'disabled' where user_id = $1 and role = 'teacher'", [LOCAL_TEACHER.id]);
    assert.deepEqual(await reads(), { classes: 0, enrollments: 0, assessments: 0, results: 0, queue: 0 });
    await assert.rejects(save("Contrôle — membre désactivé"), /not assigned|not accessible|inaccessible|row-level security|42501/);
    // Nor through a direct insert.
    await assert.rejects(
      asTeacher(db, () =>
        db.query("insert into public.assessments(school_id, class_id, subject_id, teacher_id, title, date) values ($1, $2, $3, $4, 'Direct', '2026-11-03')", [
          ids.school,
          ids.classId,
          ids.subject,
          LOCAL_TEACHER.id,
        ]),
      ),
      /row-level security/,
    );

    // An invitation not yet accepted grants nothing either.
    await db.query("update public.school_memberships set status = 'invited' where user_id = $1 and role = 'teacher'", [LOCAL_TEACHER.id]);
    assert.equal((await reads()).classes, 0);

    // The assignments were kept: re-activation restores the same access.
    await db.query("update public.school_memberships set status = 'active' where user_id = $1 and role = 'teacher'", [LOCAL_TEACHER.id]);
    const restored = await reads();
    assert.equal(restored.classes, active.classes);
    assert.equal(restored.enrollments, active.enrollments);
    assert.equal(restored.results, active.results);
    assert.equal(restored.assessments, active.assessments + 1, "plus the one saved while active");
  } finally {
    await db.close();
  }
});
