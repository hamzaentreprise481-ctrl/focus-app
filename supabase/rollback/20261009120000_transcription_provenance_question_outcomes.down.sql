-- Rollback of 20261009120000_transcription_provenance_question_outcomes.
-- Restores every object exactly as it stood after 20261007130000 (bodies
-- copied from 20260926150000, 20261002120000 and 20261004090000). It drops
-- the provenance of scanned answers and the per-question outcomes: it undoes
-- a faulty deployment, it is never a fix.

drop function public.focus_verify_transcription(uuid, uuid);

drop function public.focus_persist_pedagogical_analysis(uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb);
drop function public.focus_persist_no_evidence(uuid, uuid, uuid, text, text, text, jsonb);
drop function focus_private.checked_question_outcomes(uuid, uuid, jsonb, uuid[]);
drop function focus_private.capped_confidence(text, uuid[]);

create function public.focus_persist_pedagogical_analysis(
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
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
  v_error jsonb;
  v_rec jsonb;
  v_question_id uuid;
  v_response_id uuid;
  v_node_id uuid;
  v_response_text text;
  v_excerpt text;
  v_awarded_points numeric;
  v_max_points numeric;
  v_correction_text text;
  v_catalogue_id uuid;
begin
  perform public.focus_assert_analysis_context(p_school_id, p_student_id, p_assessment_id);
  -- One analysis write at a time per student and assessment (double clicks).
  perform pg_advisory_xact_lock(hashtextextended('focus.analysis:' || p_student_id || ':' || p_assessment_id, 0));
  if nullif(btrim(coalesce(p_model, '')), '') is null or char_length(p_model) > 120
     or coalesce(p_input_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid analysis metadata' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_errors, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_recommendations, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_errors, '[]'::jsonb)) > 12
     or jsonb_array_length(coalesce(p_recommendations, '[]'::jsonb)) > 12 then
    raise exception 'analysis payload must be arrays of at most 12 items' using errcode = '22023';
  end if;

  select id into v_run_id from public.ai_analysis_runs
  where teacher_id = auth.uid() and student_id = p_student_id and assessment_id = p_assessment_id
    and input_hash = p_input_hash and status = 'completed' and superseded_at is null
  order by created_at desc limit 1;
  if found then return v_run_id; end if;

  -- The new analysis of the current evidence replaces the earlier ones.
  perform public.focus_supersede_analyses(p_assessment_id, p_student_id);

  insert into public.ai_analysis_runs (school_id, teacher_id, student_id, assessment_id, model, input_hash, status, completed_at)
  values (p_school_id, auth.uid(), p_student_id, p_assessment_id, p_model, p_input_hash, 'completed', now())
  returning id into v_run_id;

  create temporary table if not exists focus_validated_errors (
    question_id uuid, response_id uuid, node_id uuid, excerpt text, catalogue_error_id uuid
  ) on commit drop;
  truncate focus_validated_errors;

  for v_error in select value from jsonb_array_elements(coalesce(p_errors, '[]'::jsonb)) loop
    begin
      v_question_id := (v_error->>'questionId')::uuid;
      v_response_id := (v_error->>'responseId')::uuid;
      v_node_id := (v_error->>'nodeId')::uuid;
    exception when others then
      raise exception 'invalid evidence reference' using errcode = '22023';
    end;
    v_excerpt := coalesce(v_error->>'evidenceExcerpt', '');
    select sr.response_text, sr.awarded_points, q.max_points, q.correction_text
    into v_response_text, v_awarded_points, v_max_points, v_correction_text
    from public.student_responses sr
    join public.assessment_questions q on q.id = sr.question_id
    where sr.id = v_response_id and q.id = v_question_id and q.assessment_id = p_assessment_id
      and sr.assessment_id = p_assessment_id and sr.student_id = p_student_id;
    -- The excerpt is literally in the answer and says something: at least
    -- three characters, or the whole (shorter) answer.
    if v_response_text is null or position(v_excerpt in v_response_text) = 0
       or not (char_length(btrim(v_excerpt)) >= 3 or btrim(v_excerpt) = btrim(v_response_text))
       or btrim(v_excerpt) = '' or char_length(v_excerpt) > 500 then
      raise exception 'invalid evidence reference' using errcode = '22023';
    end if;
    -- The teacher's judgement is final: no error on an answer given full
    -- marks, or identical to the correction (as lib/pedagogy/analysis.ts).
    if v_max_points is not null and v_awarded_points is not null and v_awarded_points >= v_max_points then
      raise exception 'answer given full marks' using errcode = '22023';
    end if;
    if coalesce(v_correction_text, '') <> ''
       and public.focus_normalize_math_text(v_response_text) = public.focus_normalize_math_text(v_correction_text) then
      raise exception 'answer identical to the correction' using errcode = '22023';
    end if;
    if not exists (select 1 from public.curriculum_nodes n where n.id = v_node_id and n.active and n.node_type = 'notion') then
      raise exception 'invalid curriculum notion' using errcode = '22023';
    end if;
    if not public.focus_notion_related_to_question(v_node_id, v_question_id) then
      raise exception 'notion unrelated to the question' using errcode = '22023';
    end if;
    if coalesce(v_error->>'errorType', '') not in ('concept', 'calcul', 'raisonnement', 'representation', 'communication', 'methode', 'prerequis')
       or nullif(btrim(coalesce(v_error->>'explanation', '')), '') is null
       or char_length(v_error->>'explanation') > 900 then
      raise exception 'invalid error description' using errcode = '22023';
    end if;
    -- An optional typical error of the catalogue, only for that notion.
    v_catalogue_id := null;
    if nullif(btrim(coalesce(v_error->>'catalogueErrorCode', '')), '') is not null then
      select te.id into v_catalogue_id from public.curriculum_typical_errors te
      where te.code = v_error->>'catalogueErrorCode' and te.node_id = v_node_id and te.active;
      if v_catalogue_id is null then
        raise exception 'catalogue error does not belong to the notion' using errcode = '22023';
      end if;
    end if;
    insert into focus_validated_errors values (v_question_id, v_response_id, v_node_id, v_excerpt, v_catalogue_id);
  end loop;

  insert into public.error_observations (
    analysis_run_id, school_id, student_id, assessment_id, question_id, student_response_id,
    curriculum_node_id, error_type, evidence_excerpt, explanation, confidence, source, created_by, catalogue_error_id
  )
  select v_run_id, p_school_id, p_student_id, p_assessment_id, (e.value->>'questionId')::uuid,
         (e.value->>'responseId')::uuid, (e.value->>'nodeId')::uuid, e.value->>'errorType',
         e.value->>'evidenceExcerpt', btrim(e.value->>'explanation'),
         public.focus_confidence_for(p_student_id, p_assessment_id, (e.value->>'nodeId')::uuid,
           (select count(*)::integer from focus_validated_errors v where v.node_id = (e.value->>'nodeId')::uuid)),
         'ai', auth.uid(),
         (select te.id from public.curriculum_typical_errors te
           where te.code = e.value->>'catalogueErrorCode' and te.node_id = (e.value->>'nodeId')::uuid and te.active)
  from jsonb_array_elements(coalesce(p_errors, '[]'::jsonb)) e;

  for v_rec in select value from jsonb_array_elements(coalesce(p_recommendations, '[]'::jsonb)) loop
    begin
      v_node_id := (v_rec->>'nodeId')::uuid;
    exception when others then
      raise exception 'invalid recommendation notion' using errcode = '22023';
    end;
    -- A recommendation exists only for a notion with validated evidence in
    -- this analysis; its evidence is rebuilt from that evidence.
    if not exists (select 1 from focus_validated_errors v where v.node_id = v_node_id) then
      raise exception 'recommendation without evidence' using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(v_rec->>'difficulty', '')), '') is null or char_length(v_rec->>'difficulty') > 220
       or nullif(btrim(coalesce(v_rec->>'explanation', '')), '') is null or char_length(v_rec->>'explanation') > 900
       or nullif(btrim(coalesce(v_rec->>'recommendedAction', '')), '') is null or char_length(v_rec->>'recommendedAction') > 700 then
      raise exception 'invalid recommendation text' using errcode = '22023';
    end if;
    if exists (select 1 from public.pedagogical_recommendations r where r.analysis_run_id = v_run_id and r.curriculum_node_id = v_node_id) then
      raise exception 'duplicate recommendation notion' using errcode = '22023';
    end if;
    insert into public.pedagogical_recommendations (
      analysis_run_id, school_id, student_id, assessment_id, curriculum_node_id, difficulty, evidence,
      confidence, explanation, recommended_action, created_by, catalogue_error_id
    )
    values (
      v_run_id, p_school_id, p_student_id, p_assessment_id, v_node_id, btrim(v_rec->>'difficulty'),
      (select jsonb_agg(jsonb_build_object('questionId', v.question_id, 'excerpt', v.excerpt))
         from focus_validated_errors v where v.node_id = v_node_id),
      public.focus_confidence_for(p_student_id, p_assessment_id, v_node_id,
        (select count(*)::integer from focus_validated_errors v where v.node_id = v_node_id)),
      btrim(v_rec->>'explanation'), btrim(v_rec->>'recommendedAction'), auth.uid(),
      (select v.catalogue_error_id from focus_validated_errors v
        where v.node_id = v_node_id and v.catalogue_error_id is not null limit 1)
    );
  end loop;

  return v_run_id;
end;
$$;

revoke all on function public.focus_persist_pedagogical_analysis(uuid, uuid, uuid, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.focus_persist_pedagogical_analysis(uuid, uuid, uuid, text, text, jsonb, jsonb) to authenticated;
revoke execute on function public.focus_persist_pedagogical_analysis(uuid, uuid, uuid, text, text, jsonb, jsonb) from authenticated;

create function public.focus_persist_no_evidence(
  p_school_id uuid,
  p_student_id uuid,
  p_assessment_id uuid,
  p_model text,
  p_input_hash text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
begin
  perform public.focus_assert_analysis_context(p_school_id, p_student_id, p_assessment_id);
  perform pg_advisory_xact_lock(hashtextextended('focus.analysis:' || p_student_id || ':' || p_assessment_id, 0));
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'reason is required' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_model, '')), '') is null or char_length(p_model) > 120
     or coalesce(p_input_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid analysis metadata' using errcode = '22023';
  end if;

  select id into v_run_id from public.ai_analysis_runs
  where teacher_id = auth.uid() and student_id = p_student_id and assessment_id = p_assessment_id
    and input_hash = p_input_hash and status = 'no_evidence' and superseded_at is null
  order by created_at desc limit 1;
  if found then return v_run_id; end if;

  perform public.focus_supersede_analyses(p_assessment_id, p_student_id);

  insert into public.ai_analysis_runs (school_id, teacher_id, student_id, assessment_id, model, input_hash, status, failure_reason, completed_at)
  values (p_school_id, auth.uid(), p_student_id, p_assessment_id, p_model, p_input_hash, 'no_evidence', left(btrim(p_reason), 1000), now())
  returning id into v_run_id;
  return v_run_id;
end;
$$;
revoke all on function public.focus_persist_no_evidence(uuid, uuid, uuid, text, text, text) from public, anon;
grant execute on function public.focus_persist_no_evidence(uuid, uuid, uuid, text, text, text) to authenticated;
revoke execute on function public.focus_persist_no_evidence(uuid, uuid, uuid, text, text, text) from authenticated;

create or replace function public.focus_record_engine_analysis(p_envelope text, p_signature text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key bytea;
  v_env jsonb;
  v_kind text;
  v_teacher uuid;
  v_school uuid;
  v_student uuid;
  v_assessment uuid;
  v_issued timestamptz;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select k.secret into v_key from focus_private.engine_keys k where k.id = 1;
  if v_key is null then
    raise exception 'analysis engine key is not configured' using errcode = '55000';
  end if;
  if p_envelope is null or p_signature is null or octet_length(p_envelope) > 262144
     or p_signature !~ '^[0-9a-f]{64}$'
     or encode(focus_private.hmac_sha256(v_key, convert_to(p_envelope, 'UTF8')), 'hex') <> p_signature then
    raise exception 'analysis is not signed by the FOCUS engine' using errcode = '42501';
  end if;

  begin
    v_env := p_envelope::jsonb;
    v_kind := v_env->>'kind';
    v_teacher := (v_env->>'teacherId')::uuid;
    v_school := (v_env->>'schoolId')::uuid;
    v_student := (v_env->>'studentId')::uuid;
    v_assessment := (v_env->>'assessmentId')::uuid;
    v_issued := (v_env->>'issuedAt')::timestamptz;
  exception when others then
    raise exception 'invalid analysis envelope' using errcode = '22023';
  end;
  if jsonb_typeof(v_env) is distinct from 'object' or v_env->>'v' is distinct from '1'
     or v_kind is null or v_kind not in ('analysis', 'no_evidence')
     or v_school is null or v_student is null or v_assessment is null or v_issued is null
     or coalesce(v_env->>'evidenceVersion', '') !~ '^[0-9a-f]{32}$' then
    raise exception 'invalid analysis envelope' using errcode = '22023';
  end if;
  if v_teacher is distinct from auth.uid() then
    raise exception 'analysis signed for another teacher' using errcode = '42501';
  end if;
  if v_issued < now() - interval '10 minutes' or v_issued > now() + interval '2 minutes' then
    raise exception 'analysis envelope expired' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('focus.evidence:' || v_assessment, 0));
  if focus_private.evidence_version(v_assessment, v_student) is distinct from v_env->>'evidenceVersion' then
    raise exception 'evidence changed since the analysis read it' using errcode = '40001';
  end if;

  if v_kind = 'analysis' then
    return public.focus_persist_pedagogical_analysis(
      v_school, v_student, v_assessment, v_env->>'model', v_env->>'inputHash',
      coalesce(v_env->'errors', '[]'::jsonb), coalesce(v_env->'recommendations', '[]'::jsonb));
  end if;
  return public.focus_persist_no_evidence(
    v_school, v_student, v_assessment, v_env->>'model', v_env->>'inputHash', v_env->>'reason');
end;
$$;
revoke all on function public.focus_record_engine_analysis(text, text) from public, anon;
grant execute on function public.focus_record_engine_analysis(text, text) to authenticated;

alter table public.ai_analysis_runs drop column question_outcomes;

drop trigger focus_student_responses_updated on public.student_responses;
create trigger focus_student_responses_updated
  after update on public.student_responses
  for each row
  when (old.response_text is distinct from new.response_text
        or old.awarded_points is distinct from new.awarded_points
        or old.teacher_annotation is distinct from new.teacher_annotation
        or old.question_id is distinct from new.question_id
        or old.student_id is distinct from new.student_id)
  execute function public.focus_evidence_changed();

create or replace function focus_private.evidence_version(p_assessment_id uuid, p_student_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select md5(jsonb_build_array(
    (select jsonb_build_array(a.id, a.school_id, a.class_id, a.subject_id)
       from public.assessments a where a.id = p_assessment_id),
    (select jsonb_build_array(m.context_text, m.instructions_text)
       from public.assessment_materials m where m.assessment_id = p_assessment_id),
    (select jsonb_agg(jsonb_build_array(q.id, q.position, q.prompt, q.correction_text, q.rubric, q.max_points) order by q.id)
       from public.assessment_questions q where q.assessment_id = p_assessment_id),
    (select jsonb_agg(jsonb_build_array(n.question_id, n.curriculum_node_id, n.relation)
                      order by n.question_id, n.curriculum_node_id, n.relation)
       from public.question_curriculum_nodes n
       join public.assessment_questions q on q.id = n.question_id
      where q.assessment_id = p_assessment_id),
    (select jsonb_agg(jsonb_build_array(r.question_id, r.response_text, r.awarded_points, r.teacher_annotation) order by r.question_id)
       from public.student_responses r
      where r.assessment_id = p_assessment_id and r.student_id = p_student_id)
  )::text)
$$;
revoke all on function focus_private.evidence_version(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function public.focus_save_student_responses(
  p_assessment_id uuid,
  p_student_id uuid,
  p_responses jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_assessment public.assessments%rowtype;
  v_item jsonb;
  v_index integer;
  v_question public.assessment_questions%rowtype;
  v_seen uuid[] := '{}';
  v_text text;
  v_annotation text;
  v_points numeric;
  v_changed boolean := false;
  v_rows integer;
  v_active_before integer;
  v_active_after integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select * into v_assessment from public.assessments where id = p_assessment_id;
  if not found or not (v_assessment.teacher_id = auth.uid() or public.is_school_admin(v_assessment.school_id)) then
    raise exception 'assessment not writable' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.student_enrollments se
    join public.classes c on c.id = se.class_id
    where se.student_id = p_student_id and se.class_id = v_assessment.class_id
      and se.academic_year_id = c.academic_year_id
  ) then
    raise exception 'student not enrolled in assessment class' using errcode = '42501';
  end if;
  if jsonb_typeof(p_responses) is distinct from 'array' or jsonb_array_length(p_responses) > 40 then
    raise exception 'responses must be an array of at most 40 items' using errcode = '22023';
  end if;

  select count(*) into v_active_before from public.ai_analysis_runs
  where assessment_id = p_assessment_id and student_id = p_student_id and superseded_at is null;

  for v_item, v_index in select value, ordinality from jsonb_array_elements(p_responses) with ordinality loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'response % must be an object', v_index using errcode = '22023';
    end if;
    begin
      select * into v_question from public.assessment_questions
      where id = (v_item->>'questionId')::uuid and assessment_id = p_assessment_id;
    exception when others then
      raise exception 'response % has an invalid question id', v_index using errcode = '22023';
    end;
    if v_question.id is null then
      raise exception 'response % refers to a question of another assessment', v_index using errcode = '22023';
    end if;
    if v_question.id = any(v_seen) then
      raise exception 'response % is duplicated', v_index using errcode = '22023';
    end if;
    v_seen := v_seen || v_question.id;
    v_text := btrim(coalesce(v_item->>'responseText', ''));
    v_annotation := nullif(btrim(coalesce(v_item->>'teacherAnnotation', '')), '');
    if char_length(v_text) > 20000 then
      raise exception 'response % is longer than 20000 characters', v_index using errcode = '22023';
    end if;
    if char_length(coalesce(v_annotation, '')) > 5000 then
      raise exception 'annotation % is longer than 5000 characters', v_index using errcode = '22023';
    end if;
    begin
      v_points := nullif(btrim(coalesce(v_item->>'awardedPoints', '')), '')::numeric;
    exception when others then
      raise exception 'response % has invalid points', v_index using errcode = '22023';
    end;
    if v_points is not null and (v_points < 0 or v_points > coalesce(v_question.max_points, 1000)) then
      raise exception 'response % points must be between 0 and the question maximum', v_index using errcode = '22023';
    end if;

    if v_text = '' and v_points is null and v_annotation is null then
      delete from public.student_responses where question_id = v_question.id and student_id = p_student_id;
    else
      insert into public.student_responses (assessment_id, question_id, student_id, response_text, awarded_points, teacher_annotation)
      values (p_assessment_id, v_question.id, p_student_id, v_text, v_points, v_annotation)
      on conflict (question_id, student_id) do update set
        response_text = excluded.response_text, awarded_points = excluded.awarded_points,
        teacher_annotation = excluded.teacher_annotation, updated_at = now()
      where student_responses.response_text is distinct from excluded.response_text
         or student_responses.awarded_points is distinct from excluded.awarded_points
         or student_responses.teacher_annotation is distinct from excluded.teacher_annotation;
    end if;
    get diagnostics v_rows = row_count;
    v_changed := v_changed or v_rows > 0;
  end loop;

  select count(*) into v_active_after from public.ai_analysis_runs
  where assessment_id = p_assessment_id and student_id = p_student_id and superseded_at is null;

  return jsonb_build_object('changed', v_changed, 'supersededAnalyses', v_active_before - v_active_after);
end;
$$;
revoke all on function public.focus_save_student_responses(uuid, uuid, jsonb) from public, anon;
grant execute on function public.focus_save_student_responses(uuid, uuid, jsonb) to authenticated;

alter table public.student_responses
  drop column transcription_verified,
  drop column legibility,
  drop column source;
