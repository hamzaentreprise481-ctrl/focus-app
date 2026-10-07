import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import {
  createMigratedDatabase,
  seedSchoolFixture,
  type SchoolFixtureIds,
} from "./helpers/pg";

let db: PGlite;
let a: SchoolFixtureIds;

before(async () => {
  db = await createMigratedDatabase();
  a = await seedSchoolFixture(db, {
    students: [null] as unknown as string[],
  });
});
after(async () => db.close());
beforeEach(async () => {
  await db.exec("begin");
});
afterEach(async () => {
  await db.exec("rollback");
});

async function asTeacher<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  await db.exec("savepoint scan_call");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [
      a.teacher,
    ]);
    const { rows } = await db.query<T>(sql, params);
    await db.exec("reset role");
    await db.exec("release savepoint scan_call");
    return rows;
  } catch (error) {
    await db.exec("rollback to savepoint scan_call");
    await db.exec("reset role");
    throw error;
  }
}

async function fixture() {
  const assessmentId = randomUUID();
  await asTeacher(
    "select public.focus_save_assessment($1, 'Scan', current_date, $2, $3, '{}'::uuid[], '[]'::jsonb, false)",
    [assessmentId, a.classId, a.subject],
  );
  const [{ result }] = await asTeacher<{
    result: { questionIds: string[] };
  }>(
    "select public.focus_save_assessment_questions($1, 'Sujet', 'Consignes', $2::jsonb, false) as result",
    [
      assessmentId,
      JSON.stringify([
        {
          prompt: "Résoudre x + 2 = 4",
          correctionText: "x = 2",
          rubricText: "",
          maxPoints: "4",
          nodeCodes: [],
        },
      ]),
    ],
  );
  return { assessmentId, questionId: result.questionIds[0] };
}

test("scanned copy RPC saves evidence and score in one transaction", async () => {
  const { assessmentId, questionId } = await fixture();
  const studentId = a.students[0];
  const [{ result }] = await asTeacher<{
    result: { scoreSaved: boolean; responses: { changed: boolean } };
  }>(
    "select public.focus_import_scanned_copy($1, $2, $3::jsonb, $4) as result",
    [
      assessmentId,
      studentId,
      JSON.stringify([
        {
          questionId,
          responseText: "x = 2",
          awardedPoints: "4",
          teacherAnnotation: "OK",
        },
      ]),
      18,
    ],
  );
  assert.equal(result.scoreSaved, true);
  assert.equal(result.responses.changed, true);

  const response = await db.query<{
    response_text: string;
    awarded_points: string;
    teacher_annotation: string;
  }>(
    "select response_text, awarded_points::text, teacher_annotation from public.student_responses where assessment_id = $1 and student_id = $2",
    [assessmentId, studentId],
  );
  assert.deepEqual(response.rows[0], {
    response_text: "x = 2",
    awarded_points: "4",
    teacher_annotation: "OK",
  });

  const grade = await db.query<{ score: string }>(
    "select score::text from public.assessment_results where assessment_id = $1 and student_id = $2",
    [assessmentId, studentId],
  );
  assert.equal(grade.rows[0].score, "18.00");
});

test("invalid scanned evidence rolls back the score write too", async () => {
  const { assessmentId, questionId } = await fixture();
  const studentId = a.students[0];
  await assert.rejects(
    asTeacher(
      "select public.focus_import_scanned_copy($1, $2, $3::jsonb, $4)",
      [
        assessmentId,
        studentId,
        JSON.stringify([
          {
            questionId,
            responseText: "x = 9",
            awardedPoints: "9",
            teacherAnnotation: "",
          },
        ]),
        6,
      ],
    ),
    /points must be between|exceed/,
  );

  const responses = await db.query(
    "select 1 from public.student_responses where assessment_id = $1 and student_id = $2",
    [assessmentId, studentId],
  );
  const grades = await db.query(
    "select 1 from public.assessment_results where assessment_id = $1 and student_id = $2",
    [assessmentId, studentId],
  );
  assert.equal(responses.rows.length, 0);
  assert.equal(grades.rows.length, 0);
});
