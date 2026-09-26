-- Persist an insufficient-evidence outcome atomically and prevent duplicate
-- terminal runs for the same teacher/student/assessment/input hash.

create unique index if not exists uq_ai_analysis_runs_terminal_input
  on public.ai_analysis_runs(teacher_id, student_id, assessment_id, input_hash)
  where status in ('completed','no_evidence');

create or replace function public.focus_persist_no_evidence(
  p_school_id uuid,
  p_student_id uuid,
  p_assessment_id uuid,
  p_model text,
  p_input_hash text,
  p_reason text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_assessment public.assessments%rowtype;
  v_run_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode='42501';
  end if;

  if nullif(btrim(p_reason),'') is null then
    raise exception 'reason is required' using errcode='22023';
  end if;

  select * into v_assessment
  from public.assessments
  where id=p_assessment_id;

  if not found
     or v_assessment.school_id<>p_school_id
     or not public.teaches_class(v_assessment.class_id) then
    raise exception 'assessment not accessible' using errcode='42501';
  end if;

  if not exists(
    select 1 from public.student_enrollments se
    where se.student_id=p_student_id
      and se.class_id=v_assessment.class_id
      and se.school_id=p_school_id
  ) then
    raise exception 'student not enrolled' using errcode='42501';
  end if;

  select id into v_run_id
  from public.ai_analysis_runs
  where teacher_id=(select auth.uid())
    and student_id=p_student_id
    and assessment_id=p_assessment_id
    and input_hash=p_input_hash
    and status='no_evidence'
  order by created_at desc
  limit 1;

  if found then return v_run_id; end if;

  update public.pedagogical_recommendations
  set dismissed_at=now()
  where assessment_id=p_assessment_id
    and student_id=p_student_id
    and dismissed_at is null;

  insert into public.ai_analysis_runs(
    school_id,teacher_id,student_id,assessment_id,model,input_hash,
    status,failure_reason,completed_at
  )
  values(
    p_school_id,(select auth.uid()),p_student_id,p_assessment_id,
    p_model,p_input_hash,'no_evidence',left(btrim(p_reason),1000),now()
  )
  on conflict (teacher_id, student_id, assessment_id, input_hash)
    where status in ('completed','no_evidence')
  do nothing
  returning id into v_run_id;

  if v_run_id is null then
    select id into v_run_id
    from public.ai_analysis_runs
    where teacher_id=(select auth.uid())
      and student_id=p_student_id
      and assessment_id=p_assessment_id
      and input_hash=p_input_hash
      and status in ('completed','no_evidence')
    order by created_at desc
    limit 1;
  end if;

  return v_run_id;
end;
$$;

revoke all on function public.focus_persist_no_evidence(uuid,uuid,uuid,text,text,text) from public;
revoke all on function public.focus_persist_no_evidence(uuid,uuid,uuid,text,text,text) from anon;
grant execute on function public.focus_persist_no_evidence(uuid,uuid,uuid,text,text,text) to authenticated;
