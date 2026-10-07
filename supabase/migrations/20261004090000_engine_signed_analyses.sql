-- FOCUS — AI output only from the FOCUS engine, and only for the evidence it
-- read.
--
-- 1. Provenance. focus_persist_pedagogical_analysis and
--    focus_persist_no_evidence were executable by every authenticated
--    account: any assigned teacher could call them through PostgREST with a
--    "model output" they wrote (the evidence checks still applied, but the
--    wording, the model name and the very existence of the analysis were the
--    caller's). They are now internal. The only entry point,
--    focus_record_engine_analysis, takes an envelope signed by the FOCUS
--    server (HMAC-SHA256 with a key held by the server and by
--    focus_private.engine_keys, which no API role can read), bound to the
--    signed-in teacher and valid for ten minutes.
--
-- 2. Evidence the analysis read. The server reads an evidence version
--    (focus_analysis_evidence_versions) BEFORE reading the copy, and signs
--    it with the result; the analysis is recorded only if the copy, the
--    subject, the correction, the notions and the materials are still that
--    version. A per-assessment lock serializes recording with evidence
--    changes: an analysis is either recorded before a change (and superseded
--    by it) or refused after it — never recorded as current for evidence the
--    model did not see.
--
-- 3. History. An assessment with analysed copies cannot be deleted through
--    the API: the analyses, hypotheses and the teacher's decisions belong to
--    the students' follow-up. Administrators keep SQL access.

-- ---------------------------------------------------------------------------
-- 1. Engine key (never readable by anon, authenticated or service_role)
-- ---------------------------------------------------------------------------

create schema if not exists focus_private;
revoke all on schema focus_private from public, anon, authenticated, service_role;

create table focus_private.engine_keys (
  id smallint primary key default 1 check (id = 1),
  secret bytea not null check (octet_length(secret) between 32 and 64),
  rotated_at timestamptz not null default now()
);
alter table focus_private.engine_keys enable row level security;
revoke all on table focus_private.engine_keys from public, anon, authenticated, service_role;

-- HMAC-SHA256 (RFC 2104) on the built-in sha256(): no extension needed.
create or replace function focus_private.hmac_sha256(p_key bytea, p_message bytea)
returns bytea
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_key bytea := p_key;
  v_inner bytea;
  v_outer bytea;
begin
  if octet_length(v_key) > 64 then
    v_key := sha256(v_key);
  end if;
  v_key := v_key || decode(repeat('00', 64 - octet_length(v_key)), 'hex');
  v_inner := v_key;
  v_outer := v_key;
  for i in 0..63 loop
    v_inner := set_byte(v_inner, i, get_byte(v_key, i) # 54);  -- 0x36
    v_outer := set_byte(v_outer, i, get_byte(v_key, i) # 92);  -- 0x5c
  end loop;
  return sha256(v_outer || sha256(v_inner || p_message));
end;
$$;
revoke all on function focus_private.hmac_sha256(bytea, bytea) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Evidence version: everything the model reads for one student's copy
-- ---------------------------------------------------------------------------

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

-- The versions the server reads before the evidence, for the assessments the
-- caller may analyse for this student (others are simply absent).
create or replace function public.focus_analysis_evidence_versions(p_student_id uuid, p_assessment_ids uuid[])
returns table (assessment_id uuid, evidence_version text)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, focus_private.evidence_version(a.id, p_student_id)
  from public.assessments a
  where a.id = any(p_assessment_ids)
    and cardinality(p_assessment_ids) <= 200
    and auth.uid() is not null
    and (public.teaches_class_subject(a.class_id, a.subject_id) or public.is_school_admin(a.school_id))
    and exists (
      select 1 from public.student_enrollments se
      join public.classes c on c.id = se.class_id
      where se.student_id = p_student_id and se.class_id = a.class_id and se.school_id = a.school_id
        and se.academic_year_id = c.academic_year_id
    );
$$;
revoke all on function public.focus_analysis_evidence_versions(uuid, uuid[]) from public, anon;
grant execute on function public.focus_analysis_evidence_versions(uuid, uuid[]) to authenticated;

-- Supersession takes the assessment's evidence lock (same body as
-- 20260926150000 otherwise).
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
  -- Serialized with focus_record_engine_analysis (see the header).
  perform pg_advisory_xact_lock(hashtextextended('focus.evidence:' || p_assessment_id, 0));

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

-- ---------------------------------------------------------------------------
-- 3. The only way to record an analysis
-- ---------------------------------------------------------------------------

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

-- The persistence functions keep every evidence check; they are reached only
-- through the signed entry point (or by an administrator).
revoke execute on function public.focus_persist_pedagogical_analysis(uuid, uuid, uuid, text, text, jsonb, jsonb) from authenticated;
revoke execute on function public.focus_persist_no_evidence(uuid, uuid, uuid, text, text, text) from authenticated;

-- ---------------------------------------------------------------------------
-- 4. Analysed assessments stay in the history
-- ---------------------------------------------------------------------------

create or replace function public.focus_assessment_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The role of the API request (PostgREST sets it), not the function owner.
  if coalesce(current_setting('role', true), 'none') in ('authenticated', 'anon')
     and exists (select 1 from public.ai_analysis_runs r where r.assessment_id = old.id) then
    raise exception 'an assessment with analysed copies cannot be deleted' using errcode = '55000';
  end if;
  return old;
end;
$$;
revoke all on function public.focus_assessment_delete_guard() from public, anon, authenticated;

create trigger focus_assessments_keep_analysed
  before delete on public.assessments
  for each row execute function public.focus_assessment_delete_guard();
