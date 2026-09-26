-- Hardening from the Supabase advisors on the live project (security 0028,
-- performance 0001 and 0003). No change for signed-in users: every policy
-- keeps its exact meaning. Checked on the replica by
-- tests/security-lint.test.ts and by every RLS test of the suite.

-- ---------------------------------------------------------------------------
-- 1. The anonymous role never reaches application data.
-- The app reads and writes only with the teacher's session; RLS already
-- returned nothing to anon (the helpers are false without auth.uid()).
-- Now anon is refused before RLS, and new tables start without anon access.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;

-- The RLS helpers are SECURITY DEFINER (to read memberships without
-- recursing into RLS) and only answer questions about the caller. Policies
-- evaluate them as `authenticated`; anon has no use for them.
revoke execute on function
  public.is_school_admin(uuid),
  public.is_school_member(uuid),
  public.teaches_class(uuid),
  public.enrolled_in_class(uuid),
  public.can_read_school_scoped(uuid),
  public.shares_class_with(uuid)
from public, anon;
grant execute on function
  public.is_school_admin(uuid),
  public.is_school_member(uuid),
  public.teaches_class(uuid),
  public.enrolled_in_class(uuid),
  public.can_read_school_scoped(uuid),
  public.shares_class_with(uuid)
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Evaluate auth.uid() once per statement, not once per row (0003).
-- `(select auth.uid())` is the same value; only the plan changes. Policies
-- already written that way are left as they are.
-- ---------------------------------------------------------------------------

do $$
declare
  p record;
  v_qual text;
  v_check text;
begin
  for p in
    select pol.polname,
           c.relname,
           pg_get_expr(pol.polqual, pol.polrelid) as qual,
           pg_get_expr(pol.polwithcheck, pol.polrelid) as with_check
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
  loop
    v_qual := regexp_replace(p.qual, '(?<!SELECT )auth\.uid\(\)', '(select auth.uid())', 'g');
    v_check := regexp_replace(p.with_check, '(?<!SELECT )auth\.uid\(\)', '(select auth.uid())', 'g');
    if v_qual is distinct from p.qual or v_check is distinct from p.with_check then
      execute format(
        'alter policy %I on public.%I%s%s',
        p.polname,
        p.relname,
        case when p.qual is not null then format(' using (%s)', v_qual) else '' end,
        case when p.with_check is not null then format(' with check (%s)', v_check) else '' end
      );
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Covering indexes for foreign keys (0001).
-- ---------------------------------------------------------------------------

create index if not exists idx_teacher_assignments_school on public.teacher_assignments(school_id);
create index if not exists idx_teacher_assignments_subject on public.teacher_assignments(subject_id);
create index if not exists idx_student_enrollments_school on public.student_enrollments(school_id);
create index if not exists idx_student_enrollments_year on public.student_enrollments(academic_year_id);
create index if not exists idx_competencies_school on public.competencies(school_id);
create index if not exists idx_assessments_school on public.assessments(school_id);
create index if not exists idx_assessments_subject on public.assessments(subject_id);
create index if not exists idx_assessment_competencies_competency on public.assessment_competencies(competency_id);
create index if not exists idx_homework_school on public.homework(school_id);
create index if not exists idx_homework_subject on public.homework(subject_id);
create index if not exists idx_homework_teacher on public.homework(teacher_id);
create index if not exists idx_homework_resources_homework on public.homework_resources(homework_id);
create index if not exists idx_homework_views_student on public.homework_views(student_id);
create index if not exists idx_lessons_school on public.lessons(school_id);
create index if not exists idx_lessons_subject on public.lessons(subject_id);
create index if not exists idx_lessons_teacher on public.lessons(teacher_id);
create index if not exists idx_lesson_competencies_competency on public.lesson_competencies(competency_id);
create index if not exists idx_learning_paths_school on public.learning_paths(school_id);
create index if not exists idx_learning_paths_competency on public.learning_paths(competency_id);
create index if not exists idx_learning_paths_lesson_absence on public.learning_paths(lesson_absence_id);
create index if not exists idx_student_progress_activity on public.student_progress(learning_activity_id);
create index if not exists idx_student_responses_question_assessment on public.student_responses(question_id, assessment_id);
