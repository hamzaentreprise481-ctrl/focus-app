-- Rollback of 20261002120000_access_integrity_hardening.
--
-- Restores, object for object, the schema of 20260927100000 (checked by
-- tests/migration-rollback.test.ts: the schema fingerprint after this script
-- equals the fingerprint before the migration). Run it in one transaction,
-- then mark the version reverted:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f supabase/rollback/20261002120000_access_integrity_hardening.down.sql
--   supabase migration repair --status reverted 20261002120000
-- It re-opens what the migration closed (students reading AI hypotheses,
-- direct writes without the focus_* checks): use it only to undo a faulty
-- deployment, never as a fix.

-- 6. Recording a finding, as defined by 20260926150000 -----------------------

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
    select sr.response_text into v_response_text
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
drop function if exists public.focus_normalize_math_text(text);

-- 5. Privileges --------------------------------------------------------------

alter default privileges for role postgres in schema public grant truncate, trigger, references on tables to authenticated;
grant insert, update, delete on
  public.homework,
  public.homework_resources,
  public.homework_views,
  public.lessons,
  public.lesson_competencies,
  public.lesson_absences,
  public.learning_paths,
  public.learning_activities,
  public.student_progress
to authenticated;
grant truncate, trigger, references on
  public.academic_years, public.assessment_competencies, public.assessment_materials, public.assessment_questions,
  public.assessment_results, public.assessments, public.classes, public.competencies, public.competency_results,
  public.curriculum_edges, public.curriculum_nodes, public.curriculum_sources, public.homework, public.homework_resources,
  public.homework_views, public.learning_activities, public.learning_paths, public.lesson_absences,
  public.lesson_competencies, public.lessons, public.profiles, public.question_curriculum_nodes,
  public.school_memberships, public.schools, public.student_enrollments, public.student_progress,
  public.student_responses, public.subjects, public.teacher_assignments
to authenticated;
grant trigger, references on
  public.ai_analysis_runs, public.ai_usage_events, public.curriculum_edge_declarations, public.curriculum_objectives,
  public.curriculum_remediation_targets, public.curriculum_remediations, public.curriculum_typical_errors,
  public.error_observations, public.pedagogical_recommendations, public.pedagogical_review_events
to authenticated;

-- 4. Write paths ---------------------------------------------------------------

drop trigger if exists focus_question_curriculum_nodes_notion on public.question_curriculum_nodes;
drop function if exists public.focus_check_question_notion();
drop trigger if exists focus_assessment_questions_maximum on public.assessment_questions;
drop function if exists public.focus_check_question_maximum();
drop trigger if exists focus_assessments_scope on public.assessments;
drop function if exists public.focus_assessment_scope_guard();

drop policy if exists assessments_write on public.assessments;
create policy assessments_write on public.assessments for insert
  with check (
    teacher_id = (select auth.uid())
    and exists (
      select 1 from public.teacher_assignments ta
      where ta.teacher_id = (select auth.uid())
        and ta.class_id = assessments.class_id
        and ta.subject_id = assessments.subject_id
    )
  );
drop policy if exists assessments_update on public.assessments;
create policy assessments_update on public.assessments for update
  using (teacher_id = (select auth.uid()) or public.is_school_admin(school_id))
  with check (teacher_id = (select auth.uid()) or public.is_school_admin(school_id));

drop policy if exists assessment_results_write on public.assessment_results;
create policy assessment_results_write on public.assessment_results for insert
  with check (exists (
    select 1 from public.assessments a
    where a.id = assessment_results.assessment_id and a.teacher_id = (select auth.uid())
  ));
drop policy if exists assessment_results_update on public.assessment_results;
create policy assessment_results_update on public.assessment_results for update
  using (exists (
    select 1 from public.assessments a
    where a.id = assessment_results.assessment_id
      and (a.teacher_id = (select auth.uid()) or public.is_school_admin(a.school_id))
  ))
  with check (exists (
    select 1 from public.assessments a
    where a.id = assessment_results.assessment_id
      and (a.teacher_id = (select auth.uid()) or public.is_school_admin(a.school_id))
  ));

drop policy if exists competency_results_write on public.competency_results;
create policy competency_results_write on public.competency_results for insert
  with check (exists (
    select 1 from public.assessment_results ar
    join public.assessments a on a.id = ar.assessment_id
    where ar.id = competency_results.assessment_result_id and a.teacher_id = (select auth.uid())
  ));
drop policy if exists competency_results_update on public.competency_results;
create policy competency_results_update on public.competency_results for update
  using (exists (
    select 1 from public.assessment_results ar
    join public.assessments a on a.id = ar.assessment_id
    where ar.id = competency_results.assessment_result_id
      and (a.teacher_id = (select auth.uid()) or public.is_school_admin(a.school_id))
  ))
  with check (exists (
    select 1 from public.assessment_results ar
    join public.assessments a on a.id = ar.assessment_id
    where ar.id = competency_results.assessment_result_id
      and (a.teacher_id = (select auth.uid()) or public.is_school_admin(a.school_id))
  ));

-- focus_save_assessment as defined by 20260926150000.
create or replace function public.focus_save_assessment(
  p_assessment_id uuid,
  p_title text,
  p_date date,
  p_class_id uuid,
  p_subject_id uuid,
  p_competency_ids uuid[] default '{}'::uuid[],
  p_results jsonb default '[]'::jsonb,
  p_important boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_school_id uuid;
  v_academic_year_id uuid;
  v_existing public.assessments%rowtype;
  v_result jsonb;
  v_result_id uuid;
  v_student_id uuid;
  v_score numeric;
  v_absent boolean;
  v_levels jsonb;
  v_level record;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_assessment_id is null then
    raise exception 'assessment id is required' using errcode = '22023';
  end if;
  if p_title is null or btrim(p_title) = '' or char_length(btrim(p_title)) > 200 then
    raise exception 'invalid assessment title' using errcode = '22023';
  end if;
  if p_date is null or p_date < date '2000-01-01' or p_date > date '2100-12-31' then
    raise exception 'invalid assessment date' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_results, '[]'::jsonb)) <> 'array' then
    raise exception 'results must be an array' using errcode = '22023';
  end if;

  select c.school_id, c.academic_year_id into v_school_id, v_academic_year_id
  from public.classes c where c.id = p_class_id;
  if v_school_id is null then
    raise exception 'class not found or inaccessible' using errcode = '42501';
  end if;
  if not exists (select 1 from public.subjects s where s.id = p_subject_id and s.school_id = v_school_id) then
    raise exception 'subject does not belong to class school' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.teacher_assignments ta
    where ta.teacher_id = auth.uid() and ta.school_id = v_school_id
      and ta.class_id = p_class_id and ta.subject_id = p_subject_id
  ) then
    raise exception 'teacher is not assigned to this class and subject' using errcode = '42501';
  end if;
  if exists (
    select 1
    from unnest(coalesce(p_competency_ids, '{}'::uuid[])) as requested(id)
    left join public.competencies c on c.id = requested.id
    where c.id is null or c.school_id is distinct from v_school_id or c.subject_id <> p_subject_id
  ) then
    raise exception 'invalid competency for this subject' using errcode = '22023';
  end if;

  select * into v_existing from public.assessments a where a.id = p_assessment_id;
  if found then
    if v_existing.teacher_id <> auth.uid() then
      raise exception 'assessment is owned by another teacher' using errcode = '42501';
    end if;
    -- Questions and student answers belong to the class they were written
    -- for: an assessment with detailed evidence cannot move.
    if (v_existing.class_id <> p_class_id or v_existing.subject_id <> p_subject_id)
       and exists (select 1 from public.assessment_questions q where q.assessment_id = p_assessment_id) then
      raise exception 'an assessment with questions cannot change class or subject' using errcode = '55000';
    end if;
    update public.assessments
    set title = btrim(p_title), date = p_date, class_id = p_class_id, subject_id = p_subject_id,
        school_id = v_school_id, important = coalesce(p_important, false), updated_at = now()
    where id = p_assessment_id;
  else
    insert into public.assessments (id, school_id, class_id, subject_id, teacher_id, title, date, coefficient, important)
    values (p_assessment_id, v_school_id, p_class_id, p_subject_id, auth.uid(), btrim(p_title), p_date, 1, coalesce(p_important, false));
  end if;

  delete from public.assessment_competencies where assessment_id = p_assessment_id;
  insert into public.assessment_competencies (assessment_id, competency_id)
  select p_assessment_id, requested.id
  from (select distinct unnest(coalesce(p_competency_ids, '{}'::uuid[])) as id) requested;

  delete from public.assessment_results where assessment_id = p_assessment_id;
  for v_result in select value from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) loop
    begin
      v_student_id := (v_result->>'studentId')::uuid;
    exception when others then
      raise exception 'invalid student id' using errcode = '22023';
    end;
    if not exists (
      select 1 from public.student_enrollments se
      where se.student_id = v_student_id and se.class_id = p_class_id
        and se.school_id = v_school_id and se.academic_year_id = v_academic_year_id
    ) then
      raise exception 'student is not enrolled in this class' using errcode = '42501';
    end if;
    v_absent := coalesce((v_result->>'absent')::boolean, false);
    v_score := nullif(v_result->>'score', '')::numeric;
    if v_absent and v_score is not null then
      raise exception 'absent result cannot have a score' using errcode = '22023';
    end if;
    if v_score is not null and (v_score < 0 or v_score > 20) then
      raise exception 'score must be between 0 and 20' using errcode = '22023';
    end if;
    insert into public.assessment_results (assessment_id, student_id, score, absent)
    values (p_assessment_id, v_student_id, v_score, v_absent)
    returning id into v_result_id;

    v_levels := coalesce(v_result->'skillLevels', '{}'::jsonb);
    if jsonb_typeof(v_levels) <> 'object' then
      raise exception 'skillLevels must be an object' using errcode = '22023';
    end if;
    if v_absent and v_levels <> '{}'::jsonb then
      raise exception 'absent result cannot have competency levels' using errcode = '22023';
    end if;
    for v_level in select key, value from jsonb_each_text(v_levels) loop
      if not ((v_level.key)::uuid = any(coalesce(p_competency_ids, '{}'::uuid[]))) then
        raise exception 'result contains an unselected competency' using errcode = '22023';
      end if;
      insert into public.competency_results (assessment_result_id, competency_id, mastery_level)
      values (v_result_id, (v_level.key)::uuid, (v_level.value)::public.mastery_level);
    end loop;
  end loop;

  return p_assessment_id;
end;
$$;
revoke all on function public.focus_save_assessment(uuid, text, date, uuid, uuid, uuid[], jsonb, boolean) from public, anon;
grant execute on function public.focus_save_assessment(uuid, text, date, uuid, uuid, uuid[], jsonb, boolean) to authenticated;

-- 3. Teacher decision, as defined by 20260926150000 -------------------------
create or replace function public.focus_review_pedagogical_recommendation(
  p_recommendation_id uuid,
  p_decision text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec public.pedagogical_recommendations%rowtype;
  v_decision text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  v_decision := case p_decision when 'validate' then 'validated' when 'dismiss' then 'dismissed' end;
  if v_decision is null then
    raise exception 'invalid decision' using errcode = '22023';
  end if;
  if char_length(coalesce(v_note, '')) > 1000 then
    raise exception 'note longer than 1000 characters' using errcode = '22023';
  end if;

  select * into v_rec from public.pedagogical_recommendations where id = p_recommendation_id for update;
  if not found or not (v_rec.created_by = auth.uid() or public.is_school_admin(v_rec.school_id)) then
    raise exception 'recommendation not writable' using errcode = '42501';
  end if;
  if v_rec.superseded_at is not null then
    raise exception 'recommendation superseded by newer evidence' using errcode = '55000';
  end if;

  update public.pedagogical_recommendations
  set teacher_decision = v_decision,
      teacher_decided_at = now(),
      teacher_decided_by = auth.uid(),
      teacher_note = v_note,
      teacher_validated = (v_decision = 'validated'),
      dismissed_at = case when v_decision = 'dismissed' then now() end
  where id = p_recommendation_id;

  update public.error_observations
  set teacher_decision = v_decision,
      verified_by_teacher = (v_decision = 'validated')
  where analysis_run_id = v_rec.analysis_run_id
    and curriculum_node_id = v_rec.curriculum_node_id
    and student_id = v_rec.student_id
    and assessment_id = v_rec.assessment_id;

  insert into public.pedagogical_review_events (recommendation_id, school_id, student_id, decision, note, decided_by)
  values (p_recommendation_id, v_rec.school_id, v_rec.student_id, v_decision, v_note, auth.uid());

  return jsonb_build_object('decision', v_decision, 'studentId', v_rec.student_id, 'assessmentId', v_rec.assessment_id);
end;
$$;
revoke all on function public.focus_review_pedagogical_recommendation(uuid, text, text) from public, anon;
grant execute on function public.focus_review_pedagogical_recommendation(uuid, text, text) to authenticated;

-- 1–2. Reading AI output ------------------------------------------------------

drop policy if exists ai_analysis_runs_select on public.ai_analysis_runs;
create policy ai_analysis_runs_select on public.ai_analysis_runs
  for select to authenticated using (teacher_id = (select auth.uid()) or public.is_school_admin(school_id));

drop policy if exists error_observations_select on public.error_observations;
create policy error_observations_select on public.error_observations
  for select to authenticated using (
    student_id = (select auth.uid())
    or exists (
      select 1 from public.assessments a
      where a.id = error_observations.assessment_id
        and (public.teaches_class(a.class_id) or public.is_school_admin(a.school_id))
    )
  );

drop policy if exists pedagogical_recommendations_select on public.pedagogical_recommendations;
create policy pedagogical_recommendations_select on public.pedagogical_recommendations
  for select to authenticated using (
    student_id = (select auth.uid())
    or exists (
      select 1 from public.assessments a
      where a.id = pedagogical_recommendations.assessment_id
        and (public.teaches_class(a.class_id) or public.is_school_admin(a.school_id))
    )
  );

drop policy if exists pedagogical_review_events_select on public.pedagogical_review_events;
create policy pedagogical_review_events_select on public.pedagogical_review_events
  for select to authenticated using (
    exists (
      select 1
      from public.pedagogical_recommendations r
      join public.assessments a on a.id = r.assessment_id
      where r.id = pedagogical_review_events.recommendation_id
        and (public.teaches_class(a.class_id) or public.is_school_admin(a.school_id))
    )
  );

drop function if exists public.teaches_class_subject(uuid, uuid);
