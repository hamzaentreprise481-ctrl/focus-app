create or replace function public.focus_save_assessment(
  p_assessment_id uuid,
  p_title text,
  p_date date,
  p_class_id uuid,
  p_subject_id uuid,
  p_competency_ids uuid[] default '{}'::uuid[],
  p_results jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_school_id uuid;
  v_academic_year_id uuid;
  v_existing_teacher_id uuid;
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

  if p_title is null or btrim(p_title) = '' or length(btrim(p_title)) > 200 then
    raise exception 'invalid assessment title' using errcode = '22023';
  end if;

  if p_date is null then
    raise exception 'assessment date is required' using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_results, '[]'::jsonb)) <> 'array' then
    raise exception 'results must be an array' using errcode = '22023';
  end if;

  select c.school_id, c.academic_year_id
    into v_school_id, v_academic_year_id
  from public.classes c
  where c.id = p_class_id;

  if v_school_id is null then
    raise exception 'class not found or inaccessible' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.subjects s
    where s.id = p_subject_id
      and s.school_id = v_school_id
  ) then
    raise exception 'subject does not belong to class school' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.teacher_assignments ta
    where ta.teacher_id = auth.uid()
      and ta.school_id = v_school_id
      and ta.class_id = p_class_id
      and ta.subject_id = p_subject_id
  ) then
    raise exception 'teacher is not assigned to this class and subject' using errcode = '42501';
  end if;

  if exists (
    select 1
    from unnest(coalesce(p_competency_ids, '{}'::uuid[])) as requested(id)
    left join public.competencies c on c.id = requested.id
    where c.id is null
       or c.school_id <> v_school_id
       or c.subject_id <> p_subject_id
  ) then
    raise exception 'invalid competency for this subject' using errcode = '22023';
  end if;

  select a.teacher_id
    into v_existing_teacher_id
  from public.assessments a
  where a.id = p_assessment_id;

  if found then
    if v_existing_teacher_id <> auth.uid() then
      raise exception 'assessment is owned by another teacher' using errcode = '42501';
    end if;

    update public.assessments
    set title = btrim(p_title),
        date = p_date,
        class_id = p_class_id,
        subject_id = p_subject_id,
        school_id = v_school_id,
        updated_at = now()
    where id = p_assessment_id;
  else
    insert into public.assessments (
      id, school_id, class_id, subject_id, teacher_id, title, date, coefficient
    )
    values (
      p_assessment_id, v_school_id, p_class_id, p_subject_id, auth.uid(), btrim(p_title), p_date, 1
    );
  end if;

  delete from public.assessment_competencies
  where assessment_id = p_assessment_id;

  insert into public.assessment_competencies (assessment_id, competency_id)
  select p_assessment_id, requested.id
  from (
    select distinct unnest(coalesce(p_competency_ids, '{}'::uuid[])) as id
  ) requested;

  delete from public.assessment_results
  where assessment_id = p_assessment_id;

  for v_result in
    select value from jsonb_array_elements(coalesce(p_results, '[]'::jsonb))
  loop
    begin
      v_student_id := (v_result->>'studentId')::uuid;
    exception when others then
      raise exception 'invalid student id' using errcode = '22023';
    end;

    if not exists (
      select 1
      from public.student_enrollments se
      where se.student_id = v_student_id
        and se.class_id = p_class_id
        and se.school_id = v_school_id
        and se.academic_year_id = v_academic_year_id
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

    insert into public.assessment_results (
      assessment_id, student_id, score, absent
    )
    values (
      p_assessment_id, v_student_id, v_score, v_absent
    )
    returning id into v_result_id;

    v_levels := coalesce(v_result->'skillLevels', '{}'::jsonb);
    if jsonb_typeof(v_levels) <> 'object' then
      raise exception 'skillLevels must be an object' using errcode = '22023';
    end if;

    for v_level in
      select key, value
      from jsonb_each_text(v_levels)
    loop
      if not ((v_level.key)::uuid = any(coalesce(p_competency_ids, '{}'::uuid[]))) then
        raise exception 'result contains an unselected competency' using errcode = '22023';
      end if;

      insert into public.competency_results (
        assessment_result_id, competency_id, mastery_level
      )
      values (
        v_result_id,
        (v_level.key)::uuid,
        (v_level.value)::public.mastery_level
      );
    end loop;
  end loop;

  return p_assessment_id;
end;
$$;

revoke all on function public.focus_save_assessment(uuid, text, date, uuid, uuid, uuid[], jsonb) from public;
revoke all on function public.focus_save_assessment(uuid, text, date, uuid, uuid, uuid[], jsonb) from anon;
grant execute on function public.focus_save_assessment(uuid, text, date, uuid, uuid, uuid[], jsonb) to authenticated;
