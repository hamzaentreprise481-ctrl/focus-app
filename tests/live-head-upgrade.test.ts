// Rehearsal of the pending migrations on a replica of the live project as it
// is today: every migration up to the live head (20260925214642), the live
// curriculum identifiers (fingerprints measured on the live project), a
// school with the live shape, then the nine V1 migrations. Nothing existing
// may be lost, the staging verification must pass, and a teacher must still
// read their class, students and assessments under RLS.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, createMigratedDatabase, migrationFiles } from "./helpers/pg";
import { LIVE } from "./helpers/work-curriculum";
import { LOCAL_TEACHER, seedLocalSchool } from "./helpers/local-stack";

const LIVE_HEAD = "20260925214642_supersede_edited_analysis_runs.sql";
// Measured on project wznqeofsvbutbvbyxfab on 2026-09-27, with COLLATE "C".
const LIVE_NODES_FINGERPRINT = "35b68399a3cc4fb1f2ec2bb4d82f857a";
const LIVE_EDGES_FINGERPRINT = "90a96047d50c77ce6cfe9801baa03fed";
const FINGERPRINT = `
  select md5(string_agg(id::text || '|' || code, ',' order by code collate "C")) as nodes,
    (select md5(string_agg(x, ',' order by x collate "C")) from (
      select a.code || '>' || b.code || ':' || e.relation as x
      from public.curriculum_edges e
      join public.curriculum_nodes a on a.id = e.from_node_id
      join public.curriculum_nodes b on b.id = e.to_node_id) s) as edges
  from public.curriculum_nodes`;
const PRESERVED = [
  "schools", "academic_years", "classes", "subjects", "profiles", "school_memberships",
  "student_enrollments", "teacher_assignments", "assessments", "assessment_competencies",
  "competencies", "assessment_results", "competency_results",
];

async function liveHeadReplica() {
  const db = await createMigratedDatabase({ upTo: LIVE_HEAD, recordVersions: true });
  await db.exec("set session_replication_role = replica");
  for (const node of LIVE.nodes) {
    const old = (await db.query<{ id: string }>("select id from public.curriculum_nodes where code = $1", [node.code])).rows[0]?.id;
    assert.ok(old, node.code);
    await db.query("update public.curriculum_edges set from_node_id = $2 where from_node_id = $1", [old, node.id]);
    await db.query("update public.curriculum_edges set to_node_id = $2 where to_node_id = $1", [old, node.id]);
    await db.query("update public.curriculum_nodes set id = $2 where id = $1", [old, node.id]);
  }
  await db.exec("set session_replication_role = origin");
  return db;
}

async function counts(db: PGlite) {
  const result: Record<string, number> = {};
  for (const table of PRESERVED)
    result[table] = Number((await db.query<{ n: number }>(`select count(*)::int as n from public.${table}`)).rows[0].n);
  return result;
}

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
const visible = async (db: PGlite, table: string) =>
  Number((await db.query<{ n: number }>(`select count(*)::int as n from public.${table}`)).rows[0].n);

test("the replica's curriculum is the live project's, UUID for UUID and edge for edge", async () => {
  const db = await liveHeadReplica();
  try {
    const [row] = (await db.query<{ nodes: string; edges: string }>(FINGERPRINT)).rows;
    assert.deepEqual(row, { nodes: LIVE_NODES_FINGERPRINT, edges: LIVE_EDGES_FINGERPRINT });
  } finally {
    await db.close();
  }
});

test("the nine pending migrations upgrade the live head without losing a row, and the teacher still reads under RLS", async () => {
  const db = await liveHeadReplica();
  try {
    await seedLocalSchool(db);
    const before = await counts(db);
    const teacherBefore = await asTeacher(db, async () => ({
      classes: await visible(db, "classes"),
      enrollments: await visible(db, "student_enrollments"),
      assessments: await visible(db, "assessments"),
    }));
    assert.ok(teacherBefore.classes > 0 && teacherBefore.enrollments > 0 && teacherBefore.assessments > 0);

    const pending = migrationFiles().filter((file) => path.basename(file) > LIVE_HEAD);
    assert.deepEqual(
      pending.map((file) => path.basename(file).slice(0, 14)),
      ["20260926120000", "20260926140000", "20260926150000", "20260926160000", "20260926170000", "20260926180000", "20260926190000", "20260927090000", "20260927100000"],
    );
    for (const file of pending) {
      await db.exec(readFileSync(file, "utf8"));
      await db.query("insert into supabase_migrations.schema_migrations(version) values ($1)", [path.basename(file).slice(0, 14)]);
    }

    assert.deepEqual(await counts(db), before, "no existing row is lost or duplicated");
    const liveIds = LIVE.nodes.map((node) => node.id);
    const kept = await db.query<{ n: number }>("select count(*)::int as n from public.curriculum_nodes where id = any($1::uuid[]) and active", [liveIds]);
    assert.equal(Number(kept.rows[0].n), 44, "the 44 live nodes keep their UUIDs and stay active");

    await db.exec(readFileSync(path.join(__dirname, "..", "supabase", "staging", "verify.sql"), "utf8"));

    const teacherAfter = await asTeacher(db, async () => ({
      profile: Number((await db.query<{ n: number }>("select count(*)::int as n from public.profiles where id = $1", [LOCAL_TEACHER.id])).rows[0].n),
      classes: await visible(db, "classes"),
      enrollments: await visible(db, "student_enrollments"),
      assessments: await visible(db, "assessments"),
      queue: (await db.query("select * from public.focus_teacher_work_queue()")).rows.length >= 0,
    }));
    assert.deepEqual(teacherAfter, { profile: 1, ...teacherBefore, queue: true });
    const anonymous = await asRole(db, "anon", async () => ({
      version: (await db.query<{ v: string }>("select public.focus_schema_version() as v")).rows[0].v,
      classes: await db.query("select 1 from public.classes").then((r) => r.rows.length, () => 0),
    }));
    assert.deepEqual(anonymous, { version: "20260927100000", classes: 0 });
  } finally {
    await db.close();
  }
});
