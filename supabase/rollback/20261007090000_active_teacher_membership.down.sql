-- Rollback of 20261007090000_active_teacher_membership: the definitions of
-- 20261004090000, verbatim (an assignment counts whatever the membership's
-- status). Checked by tests/migration-rollback.test.ts.

CREATE OR REPLACE FUNCTION public.focus_assert_analysis_context(p_school_id uuid, p_student_id uuid, p_assessment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.focus_record_ai_usage(p_assessment_id uuid, p_analysis_run_id uuid, p_model text, p_reasoning_effort text, p_outcome text, p_model_called boolean, p_latency_ms integer, p_input_tokens integer, p_output_tokens integer, p_reasoning_tokens integer, p_total_tokens integer, p_rejected_candidates integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_assessment public.assessments%rowtype;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select * into v_assessment from public.assessments where id = p_assessment_id;
  if not found or not (
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
  if p_analysis_run_id is not null and not exists (
    select 1 from public.ai_analysis_runs r
    where r.id = p_analysis_run_id and r.assessment_id = p_assessment_id and r.teacher_id = auth.uid()
  ) then
    raise exception 'analysis run not accessible' using errcode = '42501';
  end if;

  insert into public.ai_usage_events (
    school_id, teacher_id, assessment_id, analysis_run_id, model, reasoning_effort, outcome, model_called,
    latency_ms, input_tokens, output_tokens, reasoning_tokens, total_tokens, rejected_candidates
  )
  values (
    v_assessment.school_id, auth.uid(), p_assessment_id, p_analysis_run_id, p_model, p_reasoning_effort, p_outcome,
    coalesce(p_model_called, false), p_latency_ms, p_input_tokens, p_output_tokens, p_reasoning_tokens, p_total_tokens,
    coalesce(p_rejected_candidates, 0)
  )
  returning id into v_id;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.focus_save_assessment(p_assessment_id uuid, p_title text, p_date date, p_class_id uuid, p_subject_id uuid, p_competency_ids uuid[] DEFAULT '{}'::uuid[], p_results jsonb DEFAULT '[]'::jsonb, p_important boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
    delete from public.assessment_results where assessment_id = p_assessment_id;
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
$function$;

CREATE OR REPLACE FUNCTION public.focus_teacher_work_queue()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.shares_class_with(other_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from teacher_assignments ta
    join student_enrollments se on se.class_id = ta.class_id
    where (ta.teacher_id = auth.uid() and se.student_id = other_user_id)
       or (ta.teacher_id = other_user_id and se.student_id = auth.uid())
  );
$function$;

CREATE OR REPLACE FUNCTION public.teaches_class_subject(target_class_id uuid, target_subject_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.teacher_assignments
    where teacher_id = auth.uid()
      and class_id = target_class_id
      and subject_id = target_subject_id
  );
$function$;

CREATE OR REPLACE FUNCTION public.teaches_class(target_class_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from teacher_assignments
    where teacher_id = auth.uid()
      and class_id = target_class_id
  );
$function$;

drop policy if exists assessments_update on public.assessments;
create policy assessments_update on public.assessments
  as permissive for update to public
  using (((teacher_id = ( SELECT auth.uid() AS uid)) OR is_school_admin(school_id)))
  with check ((((teacher_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM teacher_assignments ta
  WHERE ((ta.teacher_id = ( SELECT auth.uid() AS uid)) AND (ta.school_id = assessments.school_id) AND (ta.class_id = assessments.class_id) AND (ta.subject_id = assessments.subject_id))))) OR is_school_admin(school_id)));

drop policy if exists assessments_write on public.assessments;
create policy assessments_write on public.assessments
  as permissive for insert to public
  with check (((teacher_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM teacher_assignments ta
  WHERE ((ta.teacher_id = ( SELECT auth.uid() AS uid)) AND (ta.school_id = assessments.school_id) AND (ta.class_id = assessments.class_id) AND (ta.subject_id = assessments.subject_id))))));

drop policy if exists homework_write on public.homework;
create policy homework_write on public.homework
  as permissive for insert to public
  with check (((teacher_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM teacher_assignments ta
  WHERE ((ta.teacher_id = ( SELECT auth.uid() AS uid)) AND (ta.class_id = homework.class_id) AND (ta.subject_id = homework.subject_id))))));

drop policy if exists lessons_write on public.lessons;
create policy lessons_write on public.lessons
  as permissive for insert to public
  with check (((teacher_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM teacher_assignments ta
  WHERE ((ta.teacher_id = ( SELECT auth.uid() AS uid)) AND (ta.class_id = lessons.class_id) AND (ta.subject_id = lessons.subject_id))))));
