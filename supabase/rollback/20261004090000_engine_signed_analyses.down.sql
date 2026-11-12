-- Rollback of 20261004090000_engine_signed_analyses.
--
-- Restores, object for object, the schema of 20261002120000 (checked by
-- tests/migration-rollback.test.ts). Run it in one transaction, then mark the
-- version reverted:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f supabase/rollback/20261004090000_engine_signed_analyses.down.sql
--   supabase migration repair --status reverted 20261004090000
-- It re-opens what the migration closed (any assigned teacher can record an
-- "analysis" they wrote; an analysed assessment can be deleted through the
-- API): use it only to undo a faulty deployment, and deploy the previous
-- application version with it (this code records through the signed entry
-- point only).

-- 4. History
drop trigger if exists focus_assessments_keep_analysed on public.assessments;
drop function if exists public.focus_assessment_delete_guard();

-- 3. Entry point
-- Same grants in the same order as before (postgres, authenticated, service_role).
revoke execute on function public.focus_persist_pedagogical_analysis(uuid, uuid, uuid, text, text, jsonb, jsonb) from service_role;
revoke execute on function public.focus_persist_no_evidence(uuid, uuid, uuid, text, text, text) from service_role;
grant execute on function public.focus_persist_pedagogical_analysis(uuid, uuid, uuid, text, text, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.focus_persist_no_evidence(uuid, uuid, uuid, text, text, text) to authenticated, service_role;
drop function if exists public.focus_record_engine_analysis(text, text);

-- 2. Evidence version; supersession as defined by 20260926150000
drop function if exists public.focus_analysis_evidence_versions(uuid, uuid[]);
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

-- 1. Engine key (the key is dropped with the schema)
drop schema if exists focus_private cascade;
