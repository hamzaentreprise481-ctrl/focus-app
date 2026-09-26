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
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into v_assessment from public.assessments where id = p_assessment_id;
  if not found
     or v_assessment.school_id <> p_school_id
     or not public.teaches_class(v_assessment.class_id) then
    raise exception 'assessment not accessible' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.student_enrollments se
    where se.student_id = p_student_id
      and se.class_id = v_assessment.class_id
      and se.school_id = p_school_id
  ) then
    raise exception 'student not enrolled' using errcode = '42501';
  end if;

  if jsonb_typeof(coalesce(p_errors, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_recommendations, '[]'::jsonb)) <> 'array' then
    raise exception 'analysis payload must be arrays' using errcode = '22023';
  end if;

  select id into v_run_id
  from public.ai_analysis_runs
  where teacher_id = (select auth.uid())
    and student_id = p_student_id
    and assessment_id = p_assessment_id
    and input_hash = p_input_hash
    and status = 'completed'
  order by created_at desc
  limit 1;

  if found then return v_run_id; end if;

  insert into public.ai_analysis_runs(
    school_id, teacher_id, student_id, assessment_id, model, input_hash,
    status, completed_at
  ) values (
    p_school_id, (select auth.uid()), p_student_id, p_assessment_id,
    p_model, p_input_hash, 'completed', now()
  ) returning id into v_run_id;

  for v_error in
    select value from jsonb_array_elements(coalesce(p_errors, '[]'::jsonb))
  loop
    v_question_id := (v_error->>'questionId')::uuid;
    v_response_id := (v_error->>'responseId')::uuid;
    v_node_id := (v_error->>'nodeId')::uuid;

    if not exists (
      select 1
      from public.assessment_questions q
      join public.student_responses sr
        on sr.question_id = q.id
       and sr.id = v_response_id
      where q.id = v_question_id
        and q.assessment_id = p_assessment_id
        and sr.assessment_id = p_assessment_id
        and sr.student_id = p_student_id
        and position((v_error->>'evidenceExcerpt') in sr.response_text) > 0
    ) then
      raise exception 'invalid evidence reference' using errcode = '22023';
    end if;

    if not exists (
      select 1 from public.curriculum_nodes n
      where n.id = v_node_id and n.active
    ) then
      raise exception 'invalid curriculum node' using errcode = '22023';
    end if;

    insert into public.error_observations(
      analysis_run_id, school_id, student_id, assessment_id, question_id,
      student_response_id, curriculum_node_id, error_type, evidence_excerpt,
      explanation, confidence, source, created_by
    ) values (
      v_run_id, p_school_id, p_student_id, p_assessment_id, v_question_id,
      v_response_id, v_node_id, v_error->>'errorType',
      v_error->>'evidenceExcerpt', v_error->>'explanation',
      v_error->>'confidence', 'ai', (select auth.uid())
    );

    insert into public.question_curriculum_nodes(question_id, curriculum_node_id, relation)
    values (v_question_id, v_node_id, 'assesses')
    on conflict do nothing;

    insert into public.question_curriculum_nodes(question_id, curriculum_node_id, relation)
    select v_question_id, e.from_node_id, 'prerequisite'
    from public.curriculum_edges e
    where e.to_node_id = v_node_id and e.relation = 'prerequisite_of'
    on conflict do nothing;
  end loop;

  for v_rec in
    select value from jsonb_array_elements(coalesce(p_recommendations, '[]'::jsonb))
  loop
    v_node_id := (v_rec->>'nodeId')::uuid;
    if not exists (
      select 1 from public.curriculum_nodes n
      where n.id = v_node_id and n.active
    ) then
      raise exception 'invalid recommendation node' using errcode = '22023';
    end if;

    insert into public.pedagogical_recommendations(
      analysis_run_id, school_id, student_id, assessment_id,
      curriculum_node_id, difficulty, evidence, confidence,
      explanation, recommended_action, created_by
    ) values (
      v_run_id, p_school_id, p_student_id, p_assessment_id,
      v_node_id, v_rec->>'difficulty',
      coalesce(v_rec->'evidence', '[]'::jsonb),
      v_rec->>'confidence', v_rec->>'explanation',
      v_rec->>'recommendedAction', (select auth.uid())
    );
  end loop;

  return v_run_id;
end;
$$;

revoke all on function public.focus_persist_pedagogical_analysis(uuid,uuid,uuid,text,text,jsonb,jsonb) from public;
revoke all on function public.focus_persist_pedagogical_analysis(uuid,uuid,uuid,text,text,jsonb,jsonb) from anon;
grant execute on function public.focus_persist_pedagogical_analysis(uuid,uuid,uuid,text,text,jsonb,jsonb) to authenticated;
