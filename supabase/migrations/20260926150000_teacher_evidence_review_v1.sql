-- FOCUS Teacher V1 — evidence, analysis lifecycle and teacher review.
--
-- 1. An assessment's definition (subject, questions, correction, rubric,
--    points, assessed notions) is saved separately from each student's
--    evidence (answer, awarded points, annotation). Changing the definition
--    supersedes the analyses of every student of the assessment; changing a
--    student's evidence supersedes that student's analyses. Supersession is
--    done by triggers, so it applies whatever the write path.
-- 2. AI output (runs, error observations, recommendations) is written only by
--    audited SECURITY DEFINER functions: direct table writes are revoked, so
--    evidence can no longer be fabricated or confidence raised by hand.
--    Confidence is computed here from the evidence history, never taken from
--    the caller: one observation → limitee; repeated in the assessment or seen
--    in another assessment → moderee; plus a teacher-validated earlier
--    observation → forte. Dismissed or superseded observations never count.
-- 3. Teacher decisions (validated / dismissed, optional note) are explicit,
--    reversible, and kept as a history. A superseded recommendation can no
--    longer be decided.
-- 4. The "séquence charnière" flag used by the analysis is persisted.

-- ---------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------

alter table public.assessments
  add column if not exists important boolean not null default false;

-- A response always belongs to a question of the same assessment.
alter table public.assessment_questions
  add constraint assessment_questions_id_assessment_key unique (id, assessment_id);
alter table public.student_responses
  add constraint student_responses_question_assessment_fkey
  foreign key (question_id, assessment_id)
  references public.assessment_questions(id, assessment_id) on delete cascade;

alter table public.assessment_questions
  add constraint assessment_questions_max_points_range
  check (max_points is null or max_points <= 1000);
alter table public.student_responses
  add constraint student_responses_awarded_points_range
  check (awarded_points is null or awarded_points <= 1000);

alter table public.pedagogical_recommendations
  add column if not exists superseded_at timestamptz,
  add column if not exists teacher_decision text,
  add column if not exists teacher_decided_at timestamptz,
  add column if not exists teacher_decided_by uuid references auth.users(id) on delete set null,
  add column if not exists teacher_note text;
alter table public.pedagogical_recommendations
  add constraint pedagogical_recommendations_teacher_decision_check
    check (teacher_decision is null or teacher_decision in ('validated', 'dismissed')),
  add constraint pedagogical_recommendations_decision_complete
    check ((teacher_decision is null) = (teacher_decided_at is null)),
  add constraint pedagogical_recommendations_note_length
    check (teacher_note is null or char_length(teacher_note) <= 1000);

alter table public.error_observations
  add column if not exists teacher_decision text;
alter table public.error_observations
  add constraint error_observations_teacher_decision_check
    check (teacher_decision is null or teacher_decision in ('validated', 'dismissed'));

-- The V1 columns remain for compatibility and are kept in sync by the
-- functions below: teacher_validated ⇔ decision validated; dismissed_at is
-- set when a recommendation is dismissed or superseded; verified_by_teacher
-- ⇔ observation decision validated. Backfill (the live project had no rows
-- on 2026-09-26).
update public.pedagogical_recommendations r
set teacher_decision = 'validated', teacher_decided_at = r.created_at
where r.teacher_validated and r.teacher_decision is null;
update public.pedagogical_recommendations r
set superseded_at = r.dismissed_at
where r.dismissed_at is not null and r.teacher_decision is null
  and exists (select 1 from public.ai_analysis_runs a where a.id = r.analysis_run_id and a.superseded_at is not null);
update public.pedagogical_recommendations r
set teacher_decision = 'dismissed', teacher_decided_at = r.dismissed_at
where r.dismissed_at is not null and r.superseded_at is null and r.teacher_decision is null;
update public.error_observations
set teacher_decision = 'validated'
where verified_by_teacher and teacher_decision is null;

create table if not exists public.pedagogical_review_events (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null references public.pedagogical_recommendations(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  decision text not null check (decision in ('validated', 'dismissed')),
  note text check (note is null or char_length(note) <= 1000),
  decided_by uuid not null references auth.users(id) on delete restrict,
  decided_at timestamptz not null default now()
);
create index if not exists idx_pedagogical_review_events_recommendation
  on public.pedagogical_review_events(recommendation_id, decided_at desc);
create index if not exists idx_pedagogical_review_events_student
  on public.pedagogical_review_events(student_id, decided_at desc);
create index if not exists idx_pedagogical_review_events_school
  on public.pedagogical_review_events(school_id);
create index if not exists idx_pedagogical_review_events_decided_by
  on public.pedagogical_review_events(decided_by);
create index if not exists idx_pedagogical_recommendations_decided_by
  on public.pedagogical_recommendations(teacher_decided_by);
create index if not exists idx_pedagogical_recommendations_active
  on public.pedagogical_recommendations(student_id, created_at desc)
  where superseded_at is null;

alter table public.pedagogical_review_events enable row level security;
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

-- AI output is written only through the functions below.
drop policy if exists ai_analysis_runs_write on public.ai_analysis_runs;
drop policy if exists ai_analysis_runs_insert on public.ai_analysis_runs;
drop policy if exists ai_analysis_runs_update on public.ai_analysis_runs;
drop policy if exists ai_analysis_runs_delete on public.ai_analysis_runs;
drop policy if exists error_observations_write on public.error_observations;
drop policy if exists error_observations_insert on public.error_observations;
drop policy if exists error_observations_update on public.error_observations;
drop policy if exists error_observations_delete on public.error_observations;
drop policy if exists pedagogical_recommendations_write on public.pedagogical_recommendations;
drop policy if exists pedagogical_recommendations_insert on public.pedagogical_recommendations;
drop policy if exists pedagogical_recommendations_update on public.pedagogical_recommendations;
drop policy if exists pedagogical_recommendations_delete on public.pedagogical_recommendations;
revoke insert, update, delete, truncate on
  public.ai_analysis_runs,
  public.error_observations,
  public.pedagogical_recommendations,
  public.pedagogical_review_events
from anon, authenticated;
revoke all on public.pedagogical_review_events from anon;
grant select on public.pedagogical_review_events to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Supersession triggers
-- ---------------------------------------------------------------------------

create or replace function public.focus_supersede_analyses(
  p_assessment_id uuid,
  p_student_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.ai_analysis_runs
  set superseded_at = now()
  where assessment_id = p_assessment_id
    and (p_student_id is null or student_id = p_student_id)
    and superseded_at is null;
  get diagnostics v_count = row_count;

  update public.pedagogical_recommendations
  set superseded_at = now(),
      dismissed_at = coalesce(dismissed_at, now())
  where assessment_id = p_assessment_id
    and (p_student_id is null or student_id = p_student_id)
    and superseded_at is null;

  return v_count;
end;
$$;
revoke all on function public.focus_supersede_analyses(uuid, uuid) from public, anon, authenticated;

create or replace function public.focus_evidence_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record := coalesce(new, old);
begin
  if tg_table_name = 'student_responses' then
    perform public.focus_supersede_analyses(v_row.assessment_id, v_row.student_id);
  elsif tg_table_name = 'question_curriculum_nodes' then
    perform public.focus_supersede_analyses(
      (select q.assessment_id from public.assessment_questions q where q.id = v_row.question_id),
      null
    );
  else
    perform public.focus_supersede_analyses(v_row.assessment_id, null);
  end if;
  return null;
end;
$$;
revoke all on function public.focus_evidence_changed() from public, anon, authenticated;

create trigger focus_student_responses_changed
  after insert or delete on public.student_responses
  for each row execute function public.focus_evidence_changed();
create trigger focus_student_responses_updated
  after update on public.student_responses
  for each row
  when (old.response_text is distinct from new.response_text
        or old.awarded_points is distinct from new.awarded_points
        or old.teacher_annotation is distinct from new.teacher_annotation
        or old.question_id is distinct from new.question_id
        or old.student_id is distinct from new.student_id)
  execute function public.focus_evidence_changed();

create trigger focus_assessment_questions_changed
  after insert or delete on public.assessment_questions
  for each row execute function public.focus_evidence_changed();
create trigger focus_assessment_questions_updated
  after update on public.assessment_questions
  for each row
  when (old.prompt is distinct from new.prompt
        or old.correction_text is distinct from new.correction_text
        or old.rubric is distinct from new.rubric
        or old.max_points is distinct from new.max_points
        or old.position is distinct from new.position)
  execute function public.focus_evidence_changed();

create trigger focus_assessment_materials_changed
  after insert or delete on public.assessment_materials
  for each row execute function public.focus_evidence_changed();
create trigger focus_assessment_materials_updated
  after update on public.assessment_materials
  for each row
  when (old.context_text is distinct from new.context_text
        or old.instructions_text is distinct from new.instructions_text)
  execute function public.focus_evidence_changed();

create trigger focus_question_curriculum_nodes_changed
  after insert or delete or update on public.question_curriculum_nodes
  for each row execute function public.focus_evidence_changed();

-- Awarded points never exceed the question's maximum.
create or replace function public.focus_check_awarded_points()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.awarded_points is not null and exists (
    select 1 from public.assessment_questions q
    where q.id = new.question_id
      and q.max_points is not null
      and new.awarded_points > q.max_points
  ) then
    raise exception 'awarded points exceed the question maximum' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.focus_check_awarded_points() from public, anon, authenticated;
create trigger focus_student_responses_points
  before insert or update of awarded_points, question_id on public.student_responses
  for each row execute function public.focus_check_awarded_points();

-- ---------------------------------------------------------------------------
-- 3. Assessment metadata (adds the "séquence charnière" flag)
-- ---------------------------------------------------------------------------

drop function if exists public.focus_save_assessment(uuid, text, date, uuid, uuid, uuid[], jsonb);

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

-- ---------------------------------------------------------------------------
-- 4. Assessment definition: subject, questions, correction, rubric, notions
-- ---------------------------------------------------------------------------

-- The combined per-student editor wrote the shared definition from one
-- student's form and could upsert a question of another assessment by id.
drop function if exists public.focus_save_pedagogical_evidence(uuid, uuid, text, text, jsonb);

create or replace function public.focus_save_assessment_questions(
  p_assessment_id uuid,
  p_context_text text,
  p_instructions_text text,
  p_questions jsonb,
  p_confirm_response_deletion boolean default false
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
  v_id uuid;
  v_ids uuid[] := '{}';
  v_prompt text;
  v_correction text;
  v_rubric text;
  v_max numeric;
  v_codes text[];
  v_node_ids uuid[];
  v_before text;
  v_after text;
  v_active_before integer;
  v_active_after integer;
  v_lost integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select * into v_assessment from public.assessments where id = p_assessment_id;
  if not found or not (v_assessment.teacher_id = auth.uid() or public.is_school_admin(v_assessment.school_id)) then
    raise exception 'assessment not writable' using errcode = '42501';
  end if;
  if char_length(coalesce(p_context_text, '')) > 12000 or char_length(coalesce(p_instructions_text, '')) > 12000 then
    raise exception 'subject text too long' using errcode = '22023';
  end if;
  if jsonb_typeof(p_questions) is distinct from 'array' or jsonb_array_length(p_questions) > 40 then
    raise exception 'questions must be an array of at most 40 items' using errcode = '22023';
  end if;

  -- Validate everything before writing anything.
  create temporary table if not exists focus_question_input (
    ordinal integer primary key, id uuid not null, prompt text not null, correction text not null,
    rubric text not null, max_points numeric, node_ids uuid[] not null
  ) on commit drop;
  truncate focus_question_input;

  for v_item, v_index in select value, ordinality from jsonb_array_elements(p_questions) with ordinality loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'question % must be an object', v_index using errcode = '22023';
    end if;
    begin
      v_id := coalesce(nullif(v_item->>'id', '')::uuid, gen_random_uuid());
    exception when others then
      raise exception 'question % has an invalid id', v_index using errcode = '22023';
    end;
    if v_id = any(v_ids) then
      raise exception 'question % is duplicated', v_index using errcode = '22023';
    end if;
    if exists (select 1 from public.assessment_questions q where q.id = v_id and q.assessment_id <> p_assessment_id) then
      raise exception 'question % belongs to another assessment', v_index using errcode = '42501';
    end if;
    v_ids := v_ids || v_id;
    v_prompt := btrim(coalesce(v_item->>'prompt', ''));
    v_correction := btrim(coalesce(v_item->>'correctionText', ''));
    v_rubric := btrim(coalesce(v_item->>'rubricText', ''));
    if v_prompt = '' or char_length(v_prompt) > 12000 then
      raise exception 'question % needs a prompt of at most 12000 characters', v_index using errcode = '22023';
    end if;
    if v_correction = '' or char_length(v_correction) > 12000 then
      raise exception 'question % needs a correction of at most 12000 characters', v_index using errcode = '22023';
    end if;
    if char_length(v_rubric) > 8000 then
      raise exception 'question % has a rubric longer than 8000 characters', v_index using errcode = '22023';
    end if;
    begin
      v_max := nullif(btrim(coalesce(v_item->>'maxPoints', '')), '')::numeric;
    exception when others then
      raise exception 'question % has invalid maximum points', v_index using errcode = '22023';
    end;
    if v_max is not null and (v_max <= 0 or v_max > 1000) then
      raise exception 'question % maximum points must be in (0, 1000]', v_index using errcode = '22023';
    end if;
    if v_item ? 'nodeCodes' and jsonb_typeof(v_item->'nodeCodes') <> 'array' then
      raise exception 'question % nodeCodes must be an array', v_index using errcode = '22023';
    end if;
    select coalesce(array_agg(distinct value), '{}') into v_codes
    from jsonb_array_elements_text(coalesce(v_item->'nodeCodes', '[]'::jsonb));
    if cardinality(v_codes) > 6 then
      raise exception 'question % assesses more than 6 notions', v_index using errcode = '22023';
    end if;
    select coalesce(array_agg(n.id order by n.code), '{}') into v_node_ids
    from public.curriculum_nodes n
    where n.code = any(v_codes) and n.active and n.node_type = 'notion';
    if cardinality(v_node_ids) <> cardinality(v_codes) then
      raise exception 'question % references an unknown or inactive notion', v_index using errcode = '22023';
    end if;
    if v_max is not null and exists (
      select 1 from public.student_responses r where r.question_id = v_id and r.awarded_points > v_max
    ) then
      raise exception 'question % maximum is below points already awarded', v_index using errcode = '23514';
    end if;
    insert into focus_question_input values (v_index, v_id, v_prompt, v_correction, v_rubric, trim_scale(v_max), v_node_ids);
  end loop;

  select count(*) into v_lost
  from public.student_responses r
  join public.assessment_questions q on q.id = r.question_id
  where q.assessment_id = p_assessment_id and not (q.id = any(v_ids));
  if v_lost > 0 and not coalesce(p_confirm_response_deletion, false) then
    raise exception 'removing these questions deletes % student answers', v_lost using errcode = '55000';
  end if;

  -- Identical content: nothing is written and no analysis is superseded.
  select md5(concat_ws('|', coalesce(m.context_text, ''), coalesce(m.instructions_text, ''),
           (select string_agg(concat_ws('~', q.id, q.position, q.prompt, q.correction_text, coalesce(q.rubric->>'text', ''),
                     coalesce(trim_scale(q.max_points)::text, ''),
                     (select coalesce(string_agg(qn.curriculum_node_id::text, ',' order by qn.curriculum_node_id), '')
                        from public.question_curriculum_nodes qn where qn.question_id = q.id and qn.relation = 'assesses')),
                     '^' order by q.position)
              from public.assessment_questions q where q.assessment_id = p_assessment_id)))
  into v_before
  from (select 1) one
  left join public.assessment_materials m on m.assessment_id = p_assessment_id;

  select md5(concat_ws('|', coalesce(nullif(btrim(coalesce(p_context_text, '')), ''), ''), coalesce(nullif(btrim(coalesce(p_instructions_text, '')), ''), ''),
           (select string_agg(concat_ws('~', i.id, i.ordinal, i.prompt, i.correction, i.rubric, coalesce(trim_scale(i.max_points)::text, ''),
                     (select coalesce(string_agg(n::text, ',' order by n), '') from unnest(i.node_ids) n)),
                     '^' order by i.ordinal)
              from focus_question_input i)))
  into v_after;

  select count(*) into v_active_before from public.ai_analysis_runs
  where assessment_id = p_assessment_id and superseded_at is null;

  if v_before is distinct from v_after then
    insert into public.assessment_materials (assessment_id, context_text, instructions_text, updated_by)
    values (p_assessment_id, nullif(btrim(coalesce(p_context_text, '')), ''), nullif(btrim(coalesce(p_instructions_text, '')), ''), auth.uid())
    on conflict (assessment_id) do update set
      context_text = excluded.context_text, instructions_text = excluded.instructions_text,
      updated_by = excluded.updated_by, updated_at = now()
    where assessment_materials.context_text is distinct from excluded.context_text
       or assessment_materials.instructions_text is distinct from excluded.instructions_text;

    delete from public.assessment_questions q
    where q.assessment_id = p_assessment_id and not (q.id = any(v_ids));

    -- Move kept questions out of the way so that reordering never collides
    -- with the (assessment_id, position) unique constraint.
    update public.assessment_questions q set position = q.position + 10000
    where q.assessment_id = p_assessment_id
      and exists (select 1 from focus_question_input i where i.id = q.id and i.ordinal <> q.position);

    insert into public.assessment_questions (id, assessment_id, position, prompt, correction_text, rubric, max_points)
    select i.id, p_assessment_id, i.ordinal, i.prompt, i.correction, jsonb_build_object('text', i.rubric), i.max_points
    from focus_question_input i
    on conflict (id) do update set
      position = excluded.position, prompt = excluded.prompt, correction_text = excluded.correction_text,
      rubric = excluded.rubric, max_points = excluded.max_points, updated_at = now()
    where assessment_questions.position is distinct from excluded.position
       or assessment_questions.prompt is distinct from excluded.prompt
       or assessment_questions.correction_text is distinct from excluded.correction_text
       or assessment_questions.rubric is distinct from excluded.rubric
       or assessment_questions.max_points is distinct from excluded.max_points;

    delete from public.question_curriculum_nodes qn
    using focus_question_input i
    where qn.question_id = i.id and qn.relation = 'assesses' and not (qn.curriculum_node_id = any(i.node_ids));
    insert into public.question_curriculum_nodes (question_id, curriculum_node_id, relation)
    select i.id, n, 'assesses' from focus_question_input i, unnest(i.node_ids) n
    on conflict do nothing;
  end if;

  select count(*) into v_active_after from public.ai_analysis_runs
  where assessment_id = p_assessment_id and superseded_at is null;

  return jsonb_build_object(
    'changed', v_before is distinct from v_after,
    'questionIds', to_jsonb(v_ids),
    'supersededAnalyses', v_active_before - v_active_after,
    'deletedAnswers', case when v_before is distinct from v_after then v_lost else 0 end
  );
end;
$$;
revoke all on function public.focus_save_assessment_questions(uuid, text, text, jsonb, boolean) from public, anon;
grant execute on function public.focus_save_assessment_questions(uuid, text, text, jsonb, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. One student's evidence: answers, awarded points, teacher annotations
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

-- ---------------------------------------------------------------------------
-- 6. Analysis persistence (SECURITY DEFINER: the only write path)
-- ---------------------------------------------------------------------------

-- A diagnosed notion must relate to what the question assesses when the
-- teacher tagged it: the tagged notion itself, a notion above or below it
-- (part_of) or one of its prerequisites, within three steps.
-- SECURITY INVOKER: a direct caller only sees the tags RLS lets them read;
-- inside the analysis write function it runs with that function's rights.
create or replace function public.focus_notion_related_to_question(p_node_id uuid, p_question_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  with recursive tags as (
    select qn.curriculum_node_id as id
    from public.question_curriculum_nodes qn
    where qn.question_id = p_question_id and qn.relation = 'assesses'
  ),
  related(id, depth) as (
    select id, 0 from tags
    union
    select case when e.to_node_id = r.id then e.from_node_id else e.to_node_id end, r.depth + 1
    from related r
    join public.curriculum_edges e
      on (e.relation = 'part_of' and (e.from_node_id = r.id or e.to_node_id = r.id))
      or (e.relation = 'prerequisite_of' and e.to_node_id = r.id)
    where r.depth < 3
  )
  select not exists (select 1 from tags) or exists (select 1 from related where id = p_node_id);
$$;
revoke all on function public.focus_notion_related_to_question(uuid, uuid) from public, anon;
grant execute on function public.focus_notion_related_to_question(uuid, uuid) to authenticated;

-- Evidence history of one notion for one student, outside one assessment.
create or replace function public.focus_confidence_for(
  p_student_id uuid,
  p_assessment_id uuid,
  p_node_id uuid,
  p_current_occurrences integer
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  with prior as (
    select eo.assessment_id, eo.teacher_decision
    from public.error_observations eo
    join public.ai_analysis_runs r on r.id = eo.analysis_run_id
    where eo.student_id = p_student_id
      and eo.curriculum_node_id = p_node_id
      and eo.assessment_id <> p_assessment_id
      and r.status = 'completed'
      and r.superseded_at is null
      and eo.teacher_decision is distinct from 'dismissed'
  )
  select case
    when (select count(distinct assessment_id) from prior) >= 1
         and exists (select 1 from prior where teacher_decision = 'validated') then 'forte'
    when p_current_occurrences >= 2 or (select count(distinct assessment_id) from prior) >= 1 then 'moderee'
    else 'limitee'
  end;
$$;
revoke all on function public.focus_confidence_for(uuid, uuid, uuid, integer) from public, anon, authenticated;

create or replace function public.focus_assert_analysis_context(
  p_school_id uuid,
  p_student_id uuid,
  p_assessment_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_assessment public.assessments%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select * into v_assessment from public.assessments where id = p_assessment_id;
  -- Teaching the class is not enough: only a teacher of this subject in this
  -- class (or a school admin) may record, and thereby supersede, an analysis.
  if not found or v_assessment.school_id <> p_school_id or not (
    exists (
      select 1 from public.teacher_assignments ta
      where ta.teacher_id = auth.uid()
        and ta.class_id = v_assessment.class_id
        and ta.subject_id = v_assessment.subject_id
    )
    or public.is_school_admin(v_assessment.school_id)
  ) then
    raise exception 'assessment not accessible' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.student_enrollments se
    join public.classes c on c.id = se.class_id
    where se.student_id = p_student_id and se.class_id = v_assessment.class_id and se.school_id = p_school_id
      and se.academic_year_id = c.academic_year_id
  ) then
    raise exception 'student not enrolled' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.focus_assert_analysis_context(uuid, uuid, uuid) from public, anon, authenticated;

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

-- ---------------------------------------------------------------------------
-- 7. Teacher review
-- ---------------------------------------------------------------------------

drop function if exists public.focus_review_pedagogical_recommendation(uuid, text);

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
