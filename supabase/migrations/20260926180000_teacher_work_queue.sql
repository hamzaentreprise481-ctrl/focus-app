-- Teacher work queue (dashboard): for each mathematics assessment of the
-- caller's own class/subject assignments, the state of the evidence and of
-- the analyses, in one JSON value (no PostgREST row cap).
--
-- SECURITY INVOKER: every table is read through the caller's RLS, so the
-- function can never reveal more than the teacher could already select.
-- It only reads; it computes nothing pedagogical.

create or replace function public.focus_teacher_work_queue()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with mine as (
    select a.id, a.date
    from public.assessments a
    join public.subjects s on s.id = a.subject_id
    where exists (
        select 1
        from public.teacher_assignments ta
        where ta.teacher_id = (select auth.uid())
          and ta.class_id = a.class_id
          and ta.subject_id = a.subject_id
      )
      and (upper(coalesce(s.code, '')) like 'MATH%' or lower(s.name) like '%math%')
  ),
  questions as (
    select q.assessment_id, count(*)::int as n
    from public.assessment_questions q
    join mine on mine.id = q.assessment_id
    group by q.assessment_id
  ),
  answered as (
    select r.assessment_id, r.student_id
    from public.student_responses r
    join mine on mine.id = r.assessment_id
    where btrim(r.response_text) <> ''
    group by r.assessment_id, r.student_id
  ),
  analysed as (
    select distinct run.assessment_id, run.student_id
    from public.ai_analysis_runs run
    join mine on mine.id = run.assessment_id
    where run.superseded_at is null
      and run.status in ('completed', 'no_evidence')
  ),
  pending as (
    select rec.assessment_id, rec.student_id, count(*)::int as n
    from public.pedagogical_recommendations rec
    join mine on mine.id = rec.assessment_id
    where rec.superseded_at is null
      and rec.teacher_decision is null
    group by rec.assessment_id, rec.student_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'assessmentId', mine.id,
        'questionCount', coalesce(questions.n, 0),
        'answeredStudentIds', coalesce(
          (select jsonb_agg(a.student_id order by a.student_id)
           from answered a
           where a.assessment_id = mine.id),
          '[]'::jsonb),
        'needsAnalysisStudentIds', coalesce(
          (select jsonb_agg(a.student_id order by a.student_id)
           from answered a
           where a.assessment_id = mine.id
             and not exists (
               select 1 from analysed x
               where x.assessment_id = a.assessment_id
                 and x.student_id = a.student_id)),
          '[]'::jsonb),
        'pendingReviews', coalesce(
          (select jsonb_agg(jsonb_build_object('studentId', p.student_id, 'count', p.n) order by p.student_id)
           from pending p
           where p.assessment_id = mine.id),
          '[]'::jsonb)
      )
      order by mine.date desc, mine.id
    ),
    '[]'::jsonb)
  from mine
  left join questions on questions.assessment_id = mine.id;
$$;

revoke all on function public.focus_teacher_work_queue() from public, anon;
grant execute on function public.focus_teacher_work_queue() to authenticated;
