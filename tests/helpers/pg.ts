// Real PostgreSQL (PGlite, WASM) with a minimal stand-in for the Supabase base
// schema that lives outside this repository (schools, classes, assessments,
// authorization helpers, roles and default privileges). Every migration in
// supabase/migrations is then applied in order, exactly as written.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "supabase", "migrations");

const SUPABASE_BASE_SCHEMA = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key default gen_random_uuid());
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

create type public.mastery_level as enum ('mastered', 'developing', 'fragile', 'not_mastered');

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.classes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  academic_year_id uuid not null default gen_random_uuid(),
  name text not null,
  level text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  school_id uuid,
  name text not null,
  code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.competencies (
  id uuid primary key default gen_random_uuid(),
  school_id uuid,
  subject_id uuid not null references public.subjects(id),
  name text not null,
  code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.teacher_assignments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  teacher_id uuid not null references auth.users(id),
  class_id uuid not null references public.classes(id),
  subject_id uuid not null references public.subjects(id),
  created_at timestamptz not null default now()
);
create table public.student_enrollments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  student_id uuid not null references auth.users(id),
  class_id uuid not null references public.classes(id),
  academic_year_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);
create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  class_id uuid not null references public.classes(id),
  subject_id uuid not null references public.subjects(id),
  teacher_id uuid not null references auth.users(id),
  title text not null,
  date date not null,
  coefficient numeric not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.assessment_competencies (
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  competency_id uuid not null references public.competencies(id),
  primary key (assessment_id, competency_id)
);
create table public.assessment_results (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  student_id uuid not null references auth.users(id),
  score numeric,
  absent boolean not null default false,
  teacher_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assessment_id, student_id)
);
create table public.competency_results (
  id uuid primary key default gen_random_uuid(),
  assessment_result_id uuid not null references public.assessment_results(id) on delete cascade,
  competency_id uuid not null references public.competencies(id),
  mastery_level public.mastery_level not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.teaches_class(target_class_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.teacher_assignments ta
    where ta.class_id = target_class_id and ta.teacher_id = auth.uid()
  )
$$;
create function public.is_school_admin(target_school_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select false
$$;
`;

export function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => path.join(MIGRATIONS_DIR, name));
}

export async function createMigratedDatabase(options: { upTo?: string } = {}) {
  const db = new PGlite();
  await db.exec(SUPABASE_BASE_SCHEMA);
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
