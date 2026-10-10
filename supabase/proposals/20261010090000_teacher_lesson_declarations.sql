-- PROPOSAL — NOT IN supabase/migrations, NOT APPLIED ANYWHERE.
-- FOCUS Direction's "programme enseigné" needs teachers to declare the
-- lessons they gave and the référentiel competencies worked on. Migration
-- 20261002120000 closed direct writes on public.lessons and
-- public.lesson_competencies ("a future feature reopens writes with audited
-- functions"); this is that function. Table privileges stay closed.
--
-- Independent of the pending Teacher migrations (20261007090000,
-- 20261007130000, 20261009120000): it only reads teacher_assignments,
-- classes, academic_years, subjects, school_memberships and competencies,
-- which exist at the live head 20261004090000. Tested on both heads by
-- tests/lesson-declarations-proposal-db.test.ts. Rollback:
-- supabase/proposals/20261010090000_teacher_lesson_declarations.down.sql.
-- To adopt it, the owner moves it into supabase/migrations (staging first).

create or replace function public.focus_declare_lesson(
  p_class_id uuid,
  p_subject_id uuid,
  p_date date,
  p_summary text,
  p_competency_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid;
  v_year_start date;
  v_year_end date;
  v_lesson uuid;
  v_count integer := coalesce(cardinality(p_competency_ids), 0);
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  -- Only a teacher with an active membership, assigned to this class AND
  -- subject, declares a lesson for it. The school is the CLASS's school (the
  -- assignment, the membership and the subject must all belong to it), and
  -- the class's school year bounds the date.
  select c.school_id, y.starts_at, y.ends_at into v_school, v_year_start, v_year_end
  from public.teacher_assignments ta
  join public.classes c on c.id = ta.class_id and c.school_id = ta.school_id
  join public.academic_years y on y.id = c.academic_year_id and y.school_id = c.school_id
  join public.subjects s on s.id = ta.subject_id and (s.school_id = c.school_id or s.school_id is null)
  join public.school_memberships sm
    on sm.user_id = ta.teacher_id and sm.school_id = c.school_id
   and sm.role = 'teacher' and sm.status = 'active'
  where ta.teacher_id = auth.uid()
    and ta.class_id = p_class_id
    and ta.subject_id = p_subject_id
  limit 1;
  if v_school is null then
    raise exception 'not assigned to this class and subject' using errcode = '42501';
  end if;
  -- A declaration states what happened: never a future lesson, and only
  -- within the class's school year.
  if p_date is null or p_date > (now() at time zone 'Europe/Paris')::date then
    raise exception 'a declared lesson must have taken place' using errcode = '22023';
  end if;
  if p_date < v_year_start or p_date > v_year_end then
    raise exception 'a declared lesson must fall within the class school year' using errcode = '22023';
  end if;
  if p_summary is null or btrim(p_summary) = '' or char_length(p_summary) > 2000 then
    raise exception 'summary must hold 1 to 2000 characters' using errcode = '22023';
  end if;
  if v_count = 0 or v_count > 20 or array_position(p_competency_ids, null) is not null then
    raise exception 'one to twenty competencies' using errcode = '22023';
  end if;
  -- Every competency belongs to the subject's référentiel of this school
  -- (or the shared one).
  if exists (
    select 1 from unnest(p_competency_ids) as c(id)
    where not exists (
      select 1 from public.competencies k
      where k.id = c.id and k.subject_id = p_subject_id
        and (k.school_id = v_school or k.school_id is null)
    )
  ) then
    raise exception 'competency outside the subject référentiel' using errcode = '22023';
  end if;

  insert into public.lessons(school_id, class_id, subject_id, teacher_id, date, summary)
  values (v_school, p_class_id, p_subject_id, auth.uid(), p_date, btrim(p_summary))
  returning id into v_lesson;
  insert into public.lesson_competencies(lesson_id, competency_id)
  select v_lesson, id from (select distinct unnest(p_competency_ids) as id) as d;
  return v_lesson;
end;
$$;

revoke all on function public.focus_declare_lesson(uuid, uuid, date, text, uuid[]) from public, anon;
grant execute on function public.focus_declare_lesson(uuid, uuid, date, text, uuid[]) to authenticated;
