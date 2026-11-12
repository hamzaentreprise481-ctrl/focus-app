-- AI usage and cost observability: one row per analysis request, whether the
-- model was called or a current result was reused. No student identifier
-- and no content: model, latency, token counts, outcome, counts only.
--
-- Written only by focus_record_ai_usage (checks the caller teaches that
-- assessment's class and subject); teachers read their own rows, school
-- admins their school's.

create table public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  teacher_id uuid not null references auth.users(id) on delete cascade,
  assessment_id uuid references public.assessments(id) on delete set null,
  analysis_run_id uuid references public.ai_analysis_runs(id) on delete set null,
  model text not null check (char_length(model) between 1 and 120),
  reasoning_effort text check (reasoning_effort in ('low', 'medium', 'high')),
  outcome text not null check (outcome in (
    'errors_found', 'no_error_observed', 'insufficient_evidence', 'reused',
    'model_error', 'timeout', 'invalid_output', 'persistence_error'
  )),
  model_called boolean not null,
  latency_ms integer check (latency_ms between 0 and 600000),
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  reasoning_tokens integer check (reasoning_tokens >= 0),
  total_tokens integer check (total_tokens >= 0),
  rejected_candidates integer not null default 0 check (rejected_candidates between 0 and 100),
  created_at timestamptz not null default now(),
  check (model_called or (input_tokens is null and output_tokens is null and total_tokens is null))
);

create index idx_ai_usage_events_teacher_time on public.ai_usage_events(teacher_id, created_at desc);
create index idx_ai_usage_events_school_time on public.ai_usage_events(school_id, created_at desc);
create index idx_ai_usage_events_assessment on public.ai_usage_events(assessment_id);
create index idx_ai_usage_events_run on public.ai_usage_events(analysis_run_id);

alter table public.ai_usage_events enable row level security;
create policy ai_usage_events_select on public.ai_usage_events
  for select to authenticated
  using (teacher_id = (select auth.uid()) or public.is_school_admin(school_id));
revoke all on public.ai_usage_events from anon;
revoke insert, update, delete, truncate on public.ai_usage_events from authenticated;
grant select on public.ai_usage_events to authenticated;

create or replace function public.focus_record_ai_usage(
  p_assessment_id uuid,
  p_analysis_run_id uuid,
  p_model text,
  p_reasoning_effort text,
  p_outcome text,
  p_model_called boolean,
  p_latency_ms integer,
  p_input_tokens integer,
  p_output_tokens integer,
  p_reasoning_tokens integer,
  p_total_tokens integer,
  p_rejected_candidates integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke all on function public.focus_record_ai_usage(uuid, uuid, text, text, text, boolean, integer, integer, integer, integer, integer, integer) from public, anon;
grant execute on function public.focus_record_ai_usage(uuid, uuid, text, text, text, boolean, integer, integer, integer, integer, integer, integer) to authenticated;
