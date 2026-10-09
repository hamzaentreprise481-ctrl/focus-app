-- FOCUS — what was read, how reliably, and what was concluded per question.
--
-- 1. Provenance of an answer. A scanned or photographed copy is read by a
--    model; until now its transcription was stored exactly like an answer the
--    teacher typed, so the analysis treated a machine reading as the
--    student's exact words. student_responses now records:
--      source                 'manual' (typed by the teacher) or 'scan';
--      legibility             for a scan: lisible, partielle (contains
--                             [illisible] or an uncertain [?…] reading),
--                             illisible, vide, absente (zone not on the image);
--      transcription_verified false for a scan the teacher has not checked.
--    A typed answer is verified by construction. focus_save_student_responses
--    accepts an optional "transcription" object per answer (only the scan
--    import sends it); a change of text, points or annotation without it makes
--    the answer the teacher's own (manual, verified). The new
--    focus_verify_transcription lets the teacher confirm a reading as is.
--    Provenance is part of the evidence: changing it supersedes the analysis
--    (trigger and evidence version), like any other change of the copy.
--
-- 2. Evidence quality bounds confidence. A finding may not rest on an answer
--    read as illegible nor quote an [illisible]/[?…] passage. Its confidence,
--    still computed from the student's history, is capped by the reading it
--    rests on: 'limitee' for a partially legible answer, 'moderee' for an
--    unverified scan.
--
-- 3. Outcome per question. Each analysis run stores question_outcomes: one
--    entry per question (error, no_error_observed, incomplete, no_answer,
--    illegible, insufficient_evidence), an optional literal excerpt and a
--    short factual note. The database checks coverage, literalness, that
--    'error' exactly matches the questions holding a validated finding, and
--    the outcomes the evidence alone decides (nothing written, illegible,
--    absent from the image).

-- ---------------------------------------------------------------------------
-- 1. Provenance columns
-- ---------------------------------------------------------------------------

alter table public.student_responses
  add column source text not null default 'manual',
  add column legibility text,
  add column transcription_verified boolean not null default true;

alter table public.student_responses
  add constraint student_responses_source_check check (source in ('manual', 'scan')),
  add constraint student_responses_legibility_check
    check (legibility is null or legibility in ('lisible', 'partielle', 'illisible', 'vide', 'absente')),
  add constraint student_responses_provenance_check
    check (source = 'scan' or (legibility is null and transcription_verified));

-- ---------------------------------------------------------------------------
-- 2. Saving answers with their provenance
-- ---------------------------------------------------------------------------

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
  v_source text;
  v_legibility text;
  v_verified boolean;
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

    -- Provenance: only a scan import sends "transcription"; anything else is
    -- the teacher's own entry.
    if v_item ? 'transcription' and jsonb_typeof(v_item->'transcription') = 'object' then
      v_source := coalesce(v_item->'transcription'->>'source', '');
      v_legibility := v_item->'transcription'->>'legibility';
      begin
        v_verified := coalesce((v_item->'transcription'->>'verified')::boolean, false);
      exception when others then
        raise exception 'response % has an invalid transcription', v_index using errcode = '22023';
      end;
      if v_source <> 'scan' or v_legibility is null
         or v_legibility not in ('lisible', 'partielle', 'illisible', 'vide', 'absente') then
        raise exception 'response % has an invalid transcription', v_index using errcode = '22023';
      end if;
      -- An unreadable passage is never stored as an empty (unanswered) answer.
      if v_legibility = 'illisible' and v_text = '' then
        v_text := '[illisible]';
      end if;
      if v_legibility in ('vide', 'absente') and v_text <> '' then
        raise exception 'response % has text but is marked %', v_index, v_legibility using errcode = '22023';
      end if;
    elsif v_item ? 'transcription' and jsonb_typeof(v_item->'transcription') <> 'null' then
      raise exception 'response % has an invalid transcription', v_index using errcode = '22023';
    else
      v_source := 'manual';
      v_legibility := null;
      v_verified := true;
    end if;

    if v_text = '' and v_points is null and v_annotation is null
       and not (v_source = 'scan' and v_legibility = 'absente') then
      delete from public.student_responses where question_id = v_question.id and student_id = p_student_id;
    elsif v_source = 'manual' then
      -- A teacher's entry: unchanged rows keep their provenance (the editor
      -- resends every answer); a changed row becomes the teacher's own.
      insert into public.student_responses (assessment_id, question_id, student_id, response_text, awarded_points, teacher_annotation)
      values (p_assessment_id, v_question.id, p_student_id, v_text, v_points, v_annotation)
      on conflict (question_id, student_id) do update set
        response_text = excluded.response_text, awarded_points = excluded.awarded_points,
        teacher_annotation = excluded.teacher_annotation,
        source = 'manual', legibility = null, transcription_verified = true, updated_at = now()
      where student_responses.response_text is distinct from excluded.response_text
         or student_responses.awarded_points is distinct from excluded.awarded_points
         or student_responses.teacher_annotation is distinct from excluded.teacher_annotation;
    else
      insert into public.student_responses (
        assessment_id, question_id, student_id, response_text, awarded_points, teacher_annotation,
        source, legibility, transcription_verified
      )
      values (p_assessment_id, v_question.id, p_student_id, v_text, v_points, v_annotation, 'scan', v_legibility, v_verified)
      on conflict (question_id, student_id) do update set
        response_text = excluded.response_text, awarded_points = excluded.awarded_points,
        teacher_annotation = excluded.teacher_annotation, source = excluded.source,
        legibility = excluded.legibility, transcription_verified = excluded.transcription_verified, updated_at = now()
      where student_responses.response_text is distinct from excluded.response_text
         or student_responses.awarded_points is distinct from excluded.awarded_points
         or student_responses.teacher_annotation is distinct from excluded.teacher_annotation
         or student_responses.source is distinct from excluded.source
         or student_responses.legibility is distinct from excluded.legibility
         or student_responses.transcription_verified is distinct from excluded.transcription_verified;
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

-- The teacher confirms that the scanned reading of a copy is right, as it is
-- (markers left in the text keep it partial).
create or replace function public.focus_verify_transcription(
  p_assessment_id uuid,
  p_student_id uuid
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_assessment public.assessments%rowtype;
  v_rows integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select * into v_assessment from public.assessments where id = p_assessment_id;
  if not found or not (v_assessment.teacher_id = auth.uid() or public.is_school_admin(v_assessment.school_id)) then
    raise exception 'assessment not writable' using errcode = '42501';
  end if;
  update public.student_responses
  set transcription_verified = true, updated_at = now()
  where assessment_id = p_assessment_id and student_id = p_student_id
    and source = 'scan' and not transcription_verified;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;
revoke all on function public.focus_verify_transcription(uuid, uuid) from public, anon;
grant execute on function public.focus_verify_transcription(uuid, uuid) to authenticated;

-- Provenance changes supersede the analysis like any other change.
drop trigger focus_student_responses_updated on public.student_responses;
create trigger focus_student_responses_updated
  after update on public.student_responses
  for each row
  when (old.response_text is distinct from new.response_text
        or old.awarded_points is distinct from new.awarded_points
        or old.teacher_annotation is distinct from new.teacher_annotation
        or old.question_id is distinct from new.question_id
        or old.student_id is distinct from new.student_id
        or old.source is distinct from new.source
        or old.legibility is distinct from new.legibility
        or old.transcription_verified is distinct from new.transcription_verified)
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
    (select jsonb_agg(jsonb_build_array(r.question_id, r.response_text, r.awarded_points, r.teacher_annotation,
                                        r.source, r.legibility, r.transcription_verified) order by r.question_id)
       from public.student_responses r
      where r.assessment_id = p_assessment_id and r.student_id = p_student_id)
  )::text)
$$;
revoke all on function focus_private.evidence_version(uuid, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Outcome per question
-- ---------------------------------------------------------------------------

alter table public.ai_analysis_runs
  add column question_outcomes jsonb not null default '[]'::jsonb,
  add constraint ai_analysis_runs_question_outcomes_check check (jsonb_typeof(question_outcomes) = 'array');

-- Checks and normalises the outcomes of one analysis (internal).
create or replace function focus_private.checked_question_outcomes(
  p_assessment_id uuid,
  p_student_id uuid,
  p_outcomes jsonb,
  p_error_questions uuid[]
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_question uuid;
  v_outcome text;
  v_excerpt text;
  v_note text;
  v_text text;
  v_legibility text;
  v_seen uuid[] := '{}';
  v_result jsonb := '[]'::jsonb;
  v_count integer;
begin
  if p_outcomes is null or jsonb_typeof(p_outcomes) = 'null' then
    return '[]'::jsonb;
  end if;
  if jsonb_typeof(p_outcomes) <> 'array' or jsonb_array_length(p_outcomes) > 40 then
    raise exception 'question outcomes must be an array of at most 40 items' using errcode = '22023';
  end if;
  if jsonb_array_length(p_outcomes) = 0 then
    if coalesce(array_length(p_error_questions, 1), 0) > 0 then
      raise exception 'question outcomes are missing' using errcode = '22023';
    end if;
    return '[]'::jsonb;
  end if;
  for v_item in select value from jsonb_array_elements(p_outcomes) loop
    begin
      v_question := (v_item->>'questionId')::uuid;
    exception when others then
      raise exception 'invalid question outcome' using errcode = '22023';
    end;
    v_outcome := v_item->>'outcome';
    v_excerpt := coalesce(v_item->>'excerpt', '');
    v_note := btrim(coalesce(v_item->>'note', ''));
    if v_question is null or v_question = any(v_seen)
       or not exists (select 1 from public.assessment_questions q where q.id = v_question and q.assessment_id = p_assessment_id)
       or v_outcome is null
       or v_outcome not in ('error', 'no_error_observed', 'incomplete', 'no_answer', 'illegible', 'insufficient_evidence')
       or char_length(v_excerpt) > 300 or char_length(v_note) > 300 then
      raise exception 'invalid question outcome' using errcode = '22023';
    end if;
    v_seen := v_seen || v_question;
    select r.response_text, r.legibility into v_text, v_legibility
    from public.student_responses r
    where r.question_id = v_question and r.student_id = p_student_id and r.assessment_id = p_assessment_id;
    -- 'error' exactly where a validated finding is recorded.
    if (v_outcome = 'error') is distinct from (v_question = any(coalesce(p_error_questions, '{}'))) then
      raise exception 'question outcome does not match the findings' using errcode = '22023';
    end if;
    -- What the evidence alone decides.
    if v_legibility = 'illisible' and v_outcome <> 'illegible' then
      raise exception 'an illegible answer has no other outcome' using errcode = '22023';
    end if;
    if v_legibility = 'absente' and v_outcome <> 'insufficient_evidence' then
      raise exception 'an answer absent from the image cannot be concluded on' using errcode = '22023';
    end if;
    if coalesce(btrim(v_text), '') = '' and coalesce(v_legibility, '') <> 'absente' and v_outcome <> 'no_answer' then
      raise exception 'an unanswered question has no other outcome' using errcode = '22023';
    end if;
    if v_outcome = 'no_answer' and coalesce(btrim(v_text), '') <> '' then
      raise exception 'an answered question is not unanswered' using errcode = '22023';
    end if;
    if v_excerpt <> '' and (v_text is null or position(v_excerpt in v_text) = 0
                            or v_excerpt like '%[illisible%' or v_excerpt like '%[?%') then
      raise exception 'question outcome excerpt is not in the answer' using errcode = '22023';
    end if;
    v_result := v_result || jsonb_build_object('questionId', v_question, 'outcome', v_outcome, 'excerpt', v_excerpt, 'note', v_note);
  end loop;
  select count(*) into v_count from public.assessment_questions q where q.assessment_id = p_assessment_id;
  if cardinality(v_seen) <> v_count then
    raise exception 'question outcomes must cover every question' using errcode = '22023';
  end if;
  return v_result;
end;
$$;
revoke all on function focus_private.checked_question_outcomes(uuid, uuid, jsonb, uuid[]) from public, anon, authenticated, service_role;

-- Confidence bounded by the reading a finding rests on (internal).
create or replace function focus_private.capped_confidence(p_confidence text, p_response_ids uuid[])
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when exists (select 1 from public.student_responses r where r.id = any(p_response_ids) and r.legibility = 'partielle')
      then 'limitee'
    when exists (select 1 from public.student_responses r where r.id = any(p_response_ids) and r.source = 'scan' and not r.transcription_verified)
         and p_confidence = 'forte'
      then 'moderee'
    else p_confidence
  end
$$;
revoke all on function focus_private.capped_confidence(text, uuid[]) from public, anon, authenticated, service_role;

drop function public.focus_persist_pedagogical_analysis(uuid, uuid, uuid, text, text, jsonb, jsonb);
create function public.focus_persist_pedagogical_analysis(
  p_school_id uuid,
  p_student_id uuid,
  p_assessment_id uuid,
  p_model text,
  p_input_hash text,
  p_errors jsonb,
  p_recommendations jsonb,
  p_question_outcomes jsonb
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
  v_legibility text;
  v_excerpt text;
  v_awarded_points numeric;
  v_max_points numeric;
  v_correction_text text;
  v_catalogue_id uuid;
  v_outcomes jsonb;
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
    v_response_text := null;
    select sr.response_text, sr.awarded_points, q.max_points, q.correction_text, sr.legibility
    into v_response_text, v_awarded_points, v_max_points, v_correction_text, v_legibility
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
    -- Never a finding on what was not read: an illegible answer, or a quote
    -- of an [illisible] / uncertain [?…] passage.
    if v_legibility = 'illisible' or v_excerpt like '%[illisible%' or v_excerpt like '%[?%' then
      raise exception 'evidence rests on an unread passage' using errcode = '22023';
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

  v_outcomes := focus_private.checked_question_outcomes(
    p_assessment_id, p_student_id, p_question_outcomes,
    (select coalesce(array_agg(distinct v.question_id), '{}') from focus_validated_errors v));

  -- The new analysis of the current evidence replaces the earlier ones.
  perform public.focus_supersede_analyses(p_assessment_id, p_student_id);

  insert into public.ai_analysis_runs (school_id, teacher_id, student_id, assessment_id, model, input_hash, status, completed_at, question_outcomes)
  values (p_school_id, auth.uid(), p_student_id, p_assessment_id, p_model, p_input_hash, 'completed', now(), v_outcomes)
  returning id into v_run_id;

  insert into public.error_observations (
    analysis_run_id, school_id, student_id, assessment_id, question_id, student_response_id,
    curriculum_node_id, error_type, evidence_excerpt, explanation, confidence, source, created_by, catalogue_error_id
  )
  select v_run_id, p_school_id, p_student_id, p_assessment_id, (e.value->>'questionId')::uuid,
         (e.value->>'responseId')::uuid, (e.value->>'nodeId')::uuid, e.value->>'errorType',
         e.value->>'evidenceExcerpt', btrim(e.value->>'explanation'),
         focus_private.capped_confidence(
           public.focus_confidence_for(p_student_id, p_assessment_id, (e.value->>'nodeId')::uuid,
             (select count(*)::integer from focus_validated_errors v where v.node_id = (e.value->>'nodeId')::uuid)),
           array[(e.value->>'responseId')::uuid]),
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
      focus_private.capped_confidence(
        public.focus_confidence_for(p_student_id, p_assessment_id, v_node_id,
          (select count(*)::integer from focus_validated_errors v where v.node_id = v_node_id)),
        (select array_agg(v.response_id) from focus_validated_errors v where v.node_id = v_node_id)),
      btrim(v_rec->>'explanation'), btrim(v_rec->>'recommendedAction'), auth.uid(),
      (select v.catalogue_error_id from focus_validated_errors v
        where v.node_id = v_node_id and v.catalogue_error_id is not null limit 1)
    );
  end loop;

  return v_run_id;
end;
$$;
revoke all on function public.focus_persist_pedagogical_analysis(uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb) from public, anon, authenticated;

drop function public.focus_persist_no_evidence(uuid, uuid, uuid, text, text, text);
create function public.focus_persist_no_evidence(
  p_school_id uuid,
  p_student_id uuid,
  p_assessment_id uuid,
  p_model text,
  p_input_hash text,
  p_reason text,
  p_question_outcomes jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
  v_outcomes jsonb;
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

  -- No finding: no question may be an 'error'.
  v_outcomes := focus_private.checked_question_outcomes(p_assessment_id, p_student_id, p_question_outcomes, '{}');

  perform public.focus_supersede_analyses(p_assessment_id, p_student_id);

  insert into public.ai_analysis_runs (school_id, teacher_id, student_id, assessment_id, model, input_hash, status, failure_reason, completed_at, question_outcomes)
  values (p_school_id, auth.uid(), p_student_id, p_assessment_id, p_model, p_input_hash, 'no_evidence', left(btrim(p_reason), 1000), now(), v_outcomes)
  returning id into v_run_id;
  return v_run_id;
end;
$$;
revoke all on function public.focus_persist_no_evidence(uuid, uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;

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

  -- questionOutcomes: an envelope that carries the key is checked strictly
  -- (coverage, 'error' exactly where a finding is, what the evidence alone
  -- decides). An envelope WITHOUT the key was signed by a FOCUS server older
  -- than this migration (still deployed while the new code is promoted): it
  -- is recorded as before, without per-question outcomes. Every other check
  -- (excerpt, notion, unread passages, evidence version) still applies.
  if v_kind = 'analysis' then
    return public.focus_persist_pedagogical_analysis(
      v_school, v_student, v_assessment, v_env->>'model', v_env->>'inputHash',
      coalesce(v_env->'errors', '[]'::jsonb), coalesce(v_env->'recommendations', '[]'::jsonb),
      v_env->'questionOutcomes');
  end if;
  return public.focus_persist_no_evidence(
    v_school, v_student, v_assessment, v_env->>'model', v_env->>'inputHash', v_env->>'reason',
    v_env->'questionOutcomes');
end;
$$;
revoke all on function public.focus_record_engine_analysis(text, text) from public, anon;
grant execute on function public.focus_record_engine_analysis(text, text) to authenticated;
