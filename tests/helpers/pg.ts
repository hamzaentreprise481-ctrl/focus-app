// Real PostgreSQL (PGlite, WASM) with a minimal stand-in for what the Supabase
// platform provides before any project migration runs: the API roles, their
// default privileges and the auth schema (auth.users, auth.uid(), auth.jwt()).
// Everything else — the FOCUS base schema, its RLS policies and every later
// change — comes from supabase/migrations, applied in order, exactly as
// written and exactly as recorded in the live project's migration history.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "supabase", "migrations");

const SUPABASE_PLATFORM = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  is_anonymous boolean not null default false,
  created_at timestamptz not null default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.jwt() to anon, authenticated, service_role;
`;

/** The last migration before the Work curriculum import (44-node graph). */
export const BEFORE_WORK_IMPORT = "20260926150000_teacher_evidence_review_v1.sql";
export const WORK_IMPORT_MIGRATION = "20260926160000_curriculum_work_seconde_2026.sql";

export function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => path.join(MIGRATIONS_DIR, name));
}

export async function createMigratedDatabase(options: { upTo?: string } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_PLATFORM);
  for (const file of migrationFiles()) {
    const name = path.basename(file);
    if (options.upTo && name > options.upTo) break;
    try {
      await db.exec(readFileSync(file, "utf8"));
    } catch (error) {
      throw new Error(
        `Migration ${name} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return db;
}

/** Runs `fn` as the given database role, then resets the role. */
export async function asRole<T>(
  db: PGlite,
  role: "service_role" | "authenticated" | "anon",
  fn: () => Promise<T>,
): Promise<T> {
  await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

export interface SchoolFixtureIds {
  school: string;
  year: string;
  classId: string;
  subject: string;
  teacher: string;
  students: string[];
}

/**
 * One school, one academic year, one class with its teacher (assigned for the
 * subject) and enrolled students, with the memberships the base RLS relies on.
 * Runs as the connection's current (superuser) role.
 */
export async function seedSchoolFixture(
  db: PGlite,
  ids: Partial<Omit<SchoolFixtureIds, "students">> & { students?: string[] } = {},
): Promise<SchoolFixtureIds> {
  const one = async (sql: string, params: unknown[] = []) =>
    (await db.query<{ id: string }>(sql, params)).rows[0].id;
  const teacher = await one(
    `insert into auth.users(id, email, raw_app_meta_data, raw_user_meta_data)
     values (coalesce($1::uuid, gen_random_uuid()), 'prof@example.test', '{"role":"teacher"}', '{"first_name":"Prof","last_name":"Test"}')
     returning id`,
    [ids.teacher ?? null],
  );
  const students: string[] = [];
  for (const [index, id] of (ids.students ?? [null, null]).entries())
    students.push(
      await one(
        `insert into auth.users(id, raw_user_meta_data)
         values (coalesce($1::uuid, gen_random_uuid()), jsonb_build_object('first_name', 'Élève', 'last_name', $2::text))
         returning id`,
        [id, String(index + 1)],
      ),
    );
  const school = await one(
    "insert into public.schools(id, name) values (coalesce($1::uuid, gen_random_uuid()), 'Lycée test') returning id",
    [ids.school ?? null],
  );
  const year = await one(
    `insert into public.academic_years(id, school_id, name, starts_at, ends_at, active)
     values (coalesce($1::uuid, gen_random_uuid()), $2, '2026-2027', '2026-09-01', '2027-07-04', true) returning id`,
    [ids.year ?? null, school],
  );
  const classId = await one(
    `insert into public.classes(id, school_id, academic_year_id, name, level)
     values (coalesce($1::uuid, gen_random_uuid()), $2, $3, 'Seconde 3', 'Seconde') returning id`,
    [ids.classId ?? null, school, year],
  );
  const subject = await one(
    `insert into public.subjects(id, school_id, name, code)
     values (coalesce($1::uuid, gen_random_uuid()), $2, 'Mathématiques', 'MATH') returning id`,
    [ids.subject ?? null, school],
  );
  await db.query(
    "insert into public.school_memberships(school_id, user_id, role) values ($1, $2, 'teacher')",
    [school, teacher],
  );
  await db.query(
    "insert into public.teacher_assignments(school_id, teacher_id, class_id, subject_id) values ($1, $2, $3, $4)",
    [school, teacher, classId, subject],
  );
  for (const student of students) {
    await db.query(
      "insert into public.school_memberships(school_id, user_id, role) values ($1, $2, 'student')",
      [school, student],
    );
    await db.query(
      "insert into public.student_enrollments(school_id, student_id, class_id, academic_year_id) values ($1, $2, $3, $4)",
      [school, student, classId, year],
    );
  }
  return { school, year, classId, subject, teacher, students };
}
