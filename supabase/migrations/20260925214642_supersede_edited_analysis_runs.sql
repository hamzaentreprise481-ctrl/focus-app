-- Track analysis runs whose underlying evidence was edited so they can never
-- contribute stale longitudinal confidence.

alter table public.ai_analysis_runs
  add column if not exists superseded_at timestamptz;

drop index if exists public.uq_ai_analysis_runs_terminal_input;
create unique index uq_ai_analysis_runs_terminal_input
  on public.ai_analysis_runs(teacher_id, student_id, assessment_id, input_hash)
  where status in ('completed','no_evidence') and superseded_at is null;

create index if not exists idx_ai_analysis_runs_active_student
  on public.ai_analysis_runs(student_id, assessment_id, created_at desc)
  where superseded_at is null;

create or replace function public.focus_save_pedagogical_evidence(
  p_assessment_id uuid,
  p_student_id uuid,
  p_context_text text,
  p_instructions_text text,
  p_questions jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_assessment public.assessments%rowtype;
  v_question jsonb;
  v_question_id uuid;
  v_position integer;
  v_max_points numeric;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode='42501';
  end if;

  select * into v_assessment
  from public.assessments
  where id=p_assessment_id;

  if not found or not (
    v_assessment.teacher_id=(select auth.uid())
    or public.is_school_admin(v_assessment.school_id)
  ) then
    raise exception 'assessment not writable' using errcode='42501';
  end if;

  if not exists(
    select 1 from public.student_enrollments se
    where se.student_id=p_student_id
      and se.class_id=v_assessment.class_id
  ) then
    raise exception 'student not enrolled in assessment class' using errcode='42501';
  end if;

  if jsonb_typeof(coalesce(p_questions,'[]'::jsonb))<>'array' then
    raise exception 'questions must be an array' using errcode='22023';
  end if;

  -- Saving evidence invalidates previous conclusions until this exact evidence
  -- set is analyzed again. This deliberately favors stale-advice prevention.
  update public.ai_analysis_runs
  set superseded_at=now()
  where assessment_id=p_assessment_id
    and student_id=p_student_id
    and superseded_at is null
    and status in ('completed','no_evidence');

  update public.pedagogical_recommendations
  set dismissed_at=now()
  where assessment_id=p_assessment_id
    and student_id=p_student_id
    and dismissed_at is null;

  insert into public.assessment_materials(
    assessment_id,context_text,instructions_text,updated_by
  )
  values(
    p_assessment_id,
    nullif(btrim(p_context_text),''),
    nullif(btrim(p_instructions_text),''),
    (select auth.uid())
  )
  on conflict(assessment_id) do update set
    context_text=excluded.context_text,
    instructions_text=excluded.instructions_text,
    updated_by=excluded.updated_by,
    updated_at=now();

  for v_question in
    select value from jsonb_array_elements(coalesce(p_questions,'[]'::jsonb))
  loop
    v_question_id:=coalesce(nullif(v_question->>'id','')::uuid,gen_random_uuid());
    v_position:=(v_question->>'position')::integer;
    v_max_points:=nullif(v_question->>'maxPoints','')::numeric;

    if v_position is null or v_position<=0
       or nullif(btrim(v_question->>'prompt'),'') is null
       or nullif(btrim(v_question->>'correctionText'),'') is null then
      raise exception 'invalid question payload' using errcode='22023';
    end if;

    insert into public.assessment_questions(
      id,assessment_id,position,prompt,correction_text,rubric,max_points
    )
    values(
      v_question_id,p_assessment_id,v_position,
      btrim(v_question->>'prompt'),
      btrim(v_question->>'correctionText'),
      jsonb_build_object('text',coalesce(v_question->>'rubricText','')),
      v_max_points
    )
    on conflict(id) do update set
      position=excluded.position,
      prompt=excluded.prompt,
      correction_text=excluded.correction_text,
      rubric=excluded.rubric,
      max_points=excluded.max_points,
      updated_at=now();

    if nullif(btrim(coalesce(v_question->>'responseText','')),'') is not null then
      insert into public.student_responses(
        assessment_id,question_id,student_id,response_text,
        awarded_points,teacher_annotation
      )
      values(
        p_assessment_id,v_question_id,p_student_id,
        btrim(v_question->>'responseText'),
        nullif(v_question->>'awardedPoints','')::numeric,
        nullif(btrim(coalesce(v_question->>'teacherAnnotation','')),'')
      )
      on conflict(question_id,student_id) do update set
        response_text=excluded.response_text,
        awarded_points=excluded.awarded_points,
        teacher_annotation=excluded.teacher_annotation,
        updated_at=now();
    else
      delete from public.student_responses
      where question_id=v_question_id
        and student_id=p_student_id;
    end if;
  end loop;
end;
$$;

revoke all on function public.focus_save_pedagogical_evidence(uuid,uuid,text,text,jsonb) from public;
revoke all on function public.focus_save_pedagogical_evidence(uuid,uuid,text,text,jsonb) from anon;
grant execute on function public.focus_save_pedagogical_evidence(uuid,uuid,text,text,jsonb) to authenticated;

create or replace function public.focus_persist_pedagogical_analysis(
  p_school_id uuid,
  p_student_id uuid,
  p_assessment_id uuid,
  p_model text,
  p_input_hash text,
  p_errors jsonb,
  p_recommendations jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_assessment public.assessments%rowtype;
  v_run_id uuid;
  v_error jsonb;
  v_rec jsonb;
  v_question_id uuid;
  v_response_id uuid;
  v_node_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode='42501';
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

  if jsonb_typeof(coalesce(p_errors,'[]'::jsonb))<>'array'
     or jsonb_typeof(coalesce(p_recommendations,'[]'::jsonb))<>'array' then
    raise exception 'analysis payload must be arrays' using errcode='22023';
  end if;

  select id into v_run_id
  from public.ai_analysis_runs
  where teacher_id=(select auth.uid())
    and student_id=p_student_id
    and assessment_id=p_assessment_id
    and input_hash=p_input_hash
    and status='completed'
    and superseded_at is null
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
    status,completed_at,superseded_at
  )
  values(
    p_school_id,(select auth.uid()),p_student_id,p_assessment_id,
    p_model,p_input_hash,'completed',now(),null
  )
  on conflict (teacher_id, student_id, assessment_id, input_hash)
    where status in ('completed','no_evidence') and superseded_at is null
  do nothing
  returning id into v_run_id;

  if v_run_id is null then
    select id into v_run_id
    from public.ai_analysis_runs
    where teacher_id=(select auth.uid())
      and student_id=p_student_id
      and assessment_id=p_assessment_id
      and input_hash=p_input_hash
      and status='completed'
      and superseded_at is null
    order by created_at desc
    limit 1;
  end if;

  if v_run_id is null then
    raise exception 'terminal analysis run conflict' using errcode='40001';
  end if;

  -- If another request won the race and already persisted this run, do not
  -- duplicate its observations or recommendations.
  if exists(
    select 1 from public.error_observations eo
    where eo.analysis_run_id=v_run_id
  ) or exists(
    select 1 from public.pedagogical_recommendations pr
    where pr.analysis_run_id=v_run_id
  ) then
    return v_run_id;
  end if;

  for v_error in
    select value from jsonb_array_elements(coalesce(p_errors,'[]'::jsonb))
  loop
    v_question_id := (v_error->>'questionId')::uuid;
    v_response_id := (v_error->>'responseId')::uuid;
    v_node_id := (v_error->>'nodeId')::uuid;

    if not exists(
      select 1
      from public.assessment_questions q
      join public.student_responses sr
        on sr.question_id=q.id
       and sr.id=v_response_id
      where q.id=v_question_id
        and q.assessment_id=p_assessment_id
        and sr.assessment_id=p_assessment_id
        and sr.student_id=p_student_id
        and position((v_error->>'evidenceExcerpt') in sr.response_text)>0
    ) then
      raise exception 'invalid evidence reference' using errcode='22023';
    end if;

    if not exists(
      select 1 from public.curriculum_nodes n
      where n.id=v_node_id
        and n.active
        and n.node_type='notion'
    ) then
      raise exception 'invalid curriculum notion' using errcode='22023';
    end if;

    insert into public.error_observations(
      analysis_run_id,school_id,student_id,assessment_id,question_id,
      student_response_id,curriculum_node_id,error_type,evidence_excerpt,
      explanation,confidence,source,created_by
    )
    values(
      v_run_id,p_school_id,p_student_id,p_assessment_id,v_question_id,
      v_response_id,v_node_id,v_error->>'errorType',
      v_error->>'evidenceExcerpt',v_error->>'explanation',
      v_error->>'confidence','ai',(select auth.uid())
    );

    insert into public.question_curriculum_nodes(
      question_id,curriculum_node_id,relation
    )
    values(v_question_id,v_node_id,'assesses')
    on conflict do nothing;

    insert into public.question_curriculum_nodes(
      question_id,curriculum_node_id,relation
    )
    select v_question_id,e.from_node_id,'prerequisite'
    from public.curriculum_edges e
    where e.to_node_id=v_node_id
      and e.relation='prerequisite_of'
    on conflict do nothing;
  end loop;

  for v_rec in
    select value from jsonb_array_elements(coalesce(p_recommendations,'[]'::jsonb))
  loop
    v_node_id := (v_rec->>'nodeId')::uuid;

    if not exists(
      select 1 from public.curriculum_nodes n
      where n.id=v_node_id
        and n.active
        and n.node_type='notion'
    ) then
      raise exception 'invalid recommendation notion' using errcode='22023';
    end if;

    insert into public.pedagogical_recommendations(
      analysis_run_id,school_id,student_id,assessment_id,
      curriculum_node_id,difficulty,evidence,confidence,
      explanation,recommended_action,created_by
    )
    values(
      v_run_id,p_school_id,p_student_id,p_assessment_id,
      v_node_id,v_rec->>'difficulty',
      coalesce(v_rec->'evidence','[]'::jsonb),
      v_rec->>'confidence',v_rec->>'explanation',
      v_rec->>'recommendedAction',(select auth.uid())
    );
  end loop;

  return v_run_id;
end;
$$;

revoke all on function public.focus_persist_pedagogical_analysis(uuid,uuid,uuid,text,text,jsonb,jsonb) from public;
revoke all on function public.focus_persist_pedagogical_analysis(uuid,uuid,uuid,text,text,jsonb,jsonb) from anon;
grant execute on function public.focus_persist_pedagogical_analysis(uuid,uuid,uuid,text,text,jsonb,jsonb) to authenticated;

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
    and superseded_at is null
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
    status,failure_reason,completed_at,superseded_at
  )
  values(
    p_school_id,(select auth.uid()),p_student_id,p_assessment_id,
    p_model,p_input_hash,'no_evidence',left(btrim(p_reason),1000),now(),null
  )
  on conflict (teacher_id, student_id, assessment_id, input_hash)
    where status in ('completed','no_evidence') and superseded_at is null
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
      and superseded_at is null
    order by created_at desc
    limit 1;
  end if;

  return v_run_id;
end;
$$;

revoke all on function public.focus_persist_no_evidence(uuid,uuid,uuid,text,text,text) from public;
revoke all on function public.focus_persist_no_evidence(uuid,uuid,uuid,text,text,text) from anon;
grant execute on function public.focus_persist_no_evidence(uuid,uuid,uuid,text,text,text) to authenticated;
