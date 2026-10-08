-- FOCUS — schéma de production
-- Convention : tout ce qui est "école / élève / note" vit dans le schéma public,
-- protégé par RLS (voir 20260910120200_rls.sql). Aucune donnée réelle n'est
-- insérée par cette migration — voir supabase/seed.sql pour les données de démo.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Types énumérés
-- ---------------------------------------------------------------------------

create type membership_role as enum ('admin', 'teacher', 'student', 'parent');
create type membership_status as enum ('active', 'invited', 'disabled');
create type mastery_level as enum ('mastered', 'developing', 'fragile', 'not_mastered');
create type catchup_status as enum ('not_started', 'in_progress', 'completed');
create type learning_path_origin as enum ('lesson_absence', 'competency_gap');
create type learning_path_status as enum ('not_started', 'in_progress', 'completed');
create type learning_activity_type as enum
  ('explanation', 'example', 'question', 'hint', 'exercise', 'correction', 'quiz');

-- ---------------------------------------------------------------------------
-- Identité de l'établissement
-- ---------------------------------------------------------------------------

create table schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 1:1 avec auth.users. Volontairement minimal (pas de données personnelles
-- non nécessaires) — voir trigger handle_new_user en 20260910120300_triggers.sql.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text,
  last_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Table pivot : qui a quel rôle, dans quelle école. C'est la SEULE source de
-- vérité pour l'autorisation — jamais un rôle envoyé par le client.
create table school_memberships (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role membership_role not null,
  status membership_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, user_id, role)
);

create index idx_school_memberships_user on school_memberships(user_id);
create index idx_school_memberships_school on school_memberships(school_id);

-- ---------------------------------------------------------------------------
-- Structure pédagogique
-- ---------------------------------------------------------------------------

create table academic_years (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  name text not null,
  starts_at date not null,
  ends_at date not null,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index idx_academic_years_school on academic_years(school_id);

-- school_id nul = matière partagée globalement (ex. catalogue standard).
create table subjects (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references schools(id) on delete cascade,
  name text not null,
  code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_subjects_school on subjects(school_id);

create table classes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  academic_year_id uuid not null references academic_years(id) on delete cascade,
  name text not null,
  level text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_classes_school on classes(school_id);
create index idx_classes_year on classes(academic_year_id);

create table teacher_assignments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  teacher_id uuid not null references auth.users(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  subject_id uuid not null references subjects(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (teacher_id, class_id, subject_id)
);

create index idx_teacher_assignments_teacher on teacher_assignments(teacher_id);
create index idx_teacher_assignments_class on teacher_assignments(class_id);

create table student_enrollments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  academic_year_id uuid not null references academic_years(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (student_id, class_id, academic_year_id)
);

create index idx_student_enrollments_student on student_enrollments(student_id);
create index idx_student_enrollments_class on student_enrollments(class_id);

-- school_id nul = banque de compétences partagée (ex. tronc commun).
create table competencies (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references schools(id) on delete cascade,
  subject_id uuid not null references subjects(id) on delete cascade,
  name text not null,
  code text, -- réservé à un futur rattachement au programme officiel
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_competencies_subject on competencies(subject_id);

-- ---------------------------------------------------------------------------
-- Évaluations, notes et compétences (deux données séparées — voir contrainte
-- ci-dessous sur assessment_results, et l'absence totale de dérivation
-- automatique score -> mastery_level nulle part dans ce fichier)
-- ---------------------------------------------------------------------------

create table assessments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  subject_id uuid not null references subjects(id) on delete cascade,
  teacher_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  date date not null,
  coefficient numeric(4,2) not null default 1 check (coefficient > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_assessments_class on assessments(class_id);
create index idx_assessments_teacher on assessments(teacher_id);

create table assessment_competencies (
  assessment_id uuid not null references assessments(id) on delete cascade,
  competency_id uuid not null references competencies(id) on delete cascade,
  primary key (assessment_id, competency_id)
);

create table assessment_results (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references assessments(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  score numeric(4,2) check (score is null or (score >= 0 and score <= 20)),
  absent boolean not null default false,
  teacher_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assessment_id, student_id),
  check ( (absent and score is null) or (not absent) )
);

create index idx_assessment_results_assessment on assessment_results(assessment_id);
create index idx_assessment_results_student on assessment_results(student_id);

-- Maîtrise par compétence : REND COMPTE D'UNE SAISIE EXPLICITE de
-- l'enseignant. Aucun trigger, aucune valeur par défaut, aucune fonction de
-- ce fichier ne dérive `mastery_level` de `assessment_results.score`.
create table competency_results (
  id uuid primary key default gen_random_uuid(),
  assessment_result_id uuid not null references assessment_results(id) on delete cascade,
  competency_id uuid not null references competencies(id) on delete cascade,
  mastery_level mastery_level not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assessment_result_id, competency_id)
);

create index idx_competency_results_result on competency_results(assessment_result_id);
create index idx_competency_results_competency on competency_results(competency_id);

-- ---------------------------------------------------------------------------
-- Devoirs
-- ---------------------------------------------------------------------------

create table homework (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  subject_id uuid not null references subjects(id) on delete cascade,
  teacher_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  instructions text,
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_homework_class on homework(class_id);

create table homework_resources (
  id uuid primary key default gen_random_uuid(),
  homework_id uuid not null references homework(id) on delete cascade,
  label text,
  url text not null,
  created_at timestamptz not null default now()
);

-- Une ligne = consulté. Absence de ligne = non consulté. "Consulté" ne veut
-- jamais dire "fait" (voir garde-fou produit dans le code applicatif).
create table homework_views (
  id uuid primary key default gen_random_uuid(),
  homework_id uuid not null references homework(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  unique (homework_id, student_id)
);

-- ---------------------------------------------------------------------------
-- Séances, absences et rattrapage
-- ---------------------------------------------------------------------------

create table lessons (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  subject_id uuid not null references subjects(id) on delete cascade,
  teacher_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  summary text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_lessons_class on lessons(class_id);

create table lesson_competencies (
  lesson_id uuid not null references lessons(id) on delete cascade,
  competency_id uuid not null references competencies(id) on delete cascade,
  primary key (lesson_id, competency_id)
);

create table lesson_absences (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references lessons(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  catch_up_status catchup_status not null default 'not_started',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lesson_id, student_id)
);

create index idx_lesson_absences_student on lesson_absences(student_id);

-- ---------------------------------------------------------------------------
-- Parcours d'apprentissage (structure prête pour la couche IA — PRIORITY 10 —
-- mais aucune génération IA n'est implémentée par cette migration)
-- ---------------------------------------------------------------------------

create table learning_paths (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  competency_id uuid references competencies(id) on delete set null,
  lesson_absence_id uuid references lesson_absences(id) on delete set null,
  origin learning_path_origin not null,
  status learning_path_status not null default 'not_started',
  estimated_minutes integer check (estimated_minutes is null or estimated_minutes > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_learning_paths_student on learning_paths(student_id);

create table learning_activities (
  id uuid primary key default gen_random_uuid(),
  learning_path_id uuid not null references learning_paths(id) on delete cascade,
  position integer not null check (position > 0),
  activity_type learning_activity_type not null,
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (learning_path_id, position)
);

create table student_progress (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users(id) on delete cascade,
  learning_activity_id uuid not null references learning_activities(id) on delete cascade,
  completed_at timestamptz,
  was_correct boolean,
  created_at timestamptz not null default now(),
  unique (student_id, learning_activity_id)
);
