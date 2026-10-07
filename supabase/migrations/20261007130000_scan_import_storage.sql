-- FOCUS Scan V1 — whole-class scanned PDF import.
--
-- 1. A private temporary Storage bucket receives the PDF directly from the
--    browser with a signed upload token (so the file does not cross a Vercel
--    request-body limit). The object path is namespaced by auth.uid().
-- 2. One atomic RPC records the recognised student responses and the final
--    score. If either side fails, the transaction rolls back: no partial scan
--    import can be presented as pending while silently changing evidence.

-- Local PGlite test schemas do not include Supabase Storage. Production and
-- Supabase staging do. Keep the application migration testable without
-- fabricating a fake storage schema.
do $storage$
begin
  if to_regclass('storage.buckets') is null
     or to_regclass('storage.objects') is null then
    raise notice 'FOCUS Scan: storage schema absent; bucket policies skipped';
    return;
  end if;

  insert into storage.buckets (
    id, name, public, file_size_limit, allowed_mime_types
  )
  values (
    'focus-scan-imports',
    'focus-scan-imports',
    false,
    52428800,
    array['application/pdf']::text[]
  )
  on conflict (id) do update set
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

  execute 'drop policy if exists focus_scan_imports_insert on storage.objects';
  execute $policy$
    create policy focus_scan_imports_insert on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'focus-scan-imports'
        and split_part(name, '/', 1) = auth.uid()::text
      )
  $policy$;

  execute 'drop policy if exists focus_scan_imports_select on storage.objects';
  execute $policy$
    create policy focus_scan_imports_select on storage.objects
      for select to authenticated
      using (
        bucket_id = 'focus-scan-imports'
        and split_part(name, '/', 1) = auth.uid()::text
      )
  $policy$;

  execute 'drop policy if exists focus_scan_imports_delete on storage.objects';
  execute $policy$
    create policy focus_scan_imports_delete on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'focus-scan-imports'
        and split_part(name, '/', 1) = auth.uid()::text
      )
  $policy$;
end
$storage$;

create or replace function public.focus_import_scanned_copy(
  p_assessment_id uuid,
  p_student_id uuid,
  p_responses jsonb,
  p_score numeric default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_assessment public.assessments%rowtype;
  v_response_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into v_assessment
  from public.assessments
  where id = p_assessment_id;

  if not found
     or not (
       v_assessment.teacher_id = auth.uid()
       or public.is_school_admin(v_assessment.school_id)
     ) then
    raise exception 'assessment not writable' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.student_enrollments se
    join public.classes c on c.id = se.class_id
    where se.student_id = p_student_id
      and se.class_id = v_assessment.class_id
      and se.school_id = v_assessment.school_id
      and se.academic_year_id = c.academic_year_id
  ) then
    raise exception 'student not enrolled in assessment class'
      using errcode = '42501';
  end if;

  if p_score is not null and (p_score < 0 or p_score > 20) then
    raise exception 'score must be between 0 and 20' using errcode = '22023';
  end if;

  -- Existing audited evidence writer performs every question/points/length
  -- validation and supersedes stale analyses. This call is in the same
  -- transaction as the score write below.
  v_response_result := public.focus_save_student_responses(
    p_assessment_id,
    p_student_id,
    p_responses
  );

  if p_score is not null then
    insert into public.assessment_results (
      assessment_id,
      student_id,
      score,
      absent,
      updated_at
    )
    values (
      p_assessment_id,
      p_student_id,
      p_score,
      false,
      now()
    )
    on conflict (assessment_id, student_id) do update set
      score = excluded.score,
      absent = false,
      updated_at = now();
  end if;

  return jsonb_build_object(
    'responses', v_response_result,
    'scoreSaved', p_score is not null
  );
end;
$$;

revoke all on function public.focus_import_scanned_copy(uuid, uuid, jsonb, numeric)
  from public, anon;
grant execute on function public.focus_import_scanned_copy(uuid, uuid, jsonb, numeric)
  to authenticated;
