-- FOCUS curriculum catalogue V1: the parts of the rich curriculum documents
-- that teachers and the pedagogical AI actually use — typical errors,
-- remediations (with a short check exercise), objectives, and their
-- provenance. Short FOCUS-written texts and source locators only, never
-- programme or textbook text. Every entry keeps its editorial status
-- (provenance, teacher_validated): nothing here is presented as official or
-- as a measured frequency.
--
-- Written only by public.focus_import_curriculum_catalogue (service_role,
-- dry run by default, idempotent, never deletes: missing entries are
-- deactivated so that analyses referencing them stay readable).

create table public.curriculum_objectives (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  node_id uuid not null references public.curriculum_nodes(id) on delete restrict,
  position integer not null check (position > 0),
  text text not null check (char_length(text) between 1 and 300),
  provenance text not null check (char_length(provenance) between 1 and 80),
  source_locator text check (source_locator is null or char_length(source_locator) <= 200),
  teacher_validated boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.curriculum_typical_errors (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  node_id uuid not null references public.curriculum_nodes(id) on delete restrict,
  position integer not null check (position > 0),
  description text not null check (char_length(description) between 1 and 300),
  evidence_required text check (evidence_required is null or char_length(evidence_required) <= 600),
  alternative_explanations text[] not null default '{}' check (cardinality(alternative_explanations) <= 8),
  frequency_status text check (frequency_status is null or char_length(frequency_status) <= 80),
  provenance text not null check (char_length(provenance) between 1 and 80),
  teacher_validated boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.curriculum_remediations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  node_id uuid not null references public.curriculum_nodes(id) on delete restrict,
  position integer not null check (position > 0),
  title text not null default '' check (char_length(title) <= 160),
  steps text[] not null check (cardinality(steps) between 1 and 8),
  duration_minutes integer check (duration_minutes is null or duration_minutes between 1 and 240),
  duration_is_official boolean not null default false,
  check_prompt text check (check_prompt is null or char_length(check_prompt) <= 600),
  check_expected_answer text check (check_expected_answer is null or char_length(check_expected_answer) <= 600),
  check_success_criterion text check (check_success_criterion is null or char_length(check_success_criterion) <= 600),
  provenance text not null check (char_length(provenance) between 1 and 80),
  source_locator text check (source_locator is null or char_length(source_locator) <= 200),
  teacher_validated boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.curriculum_remediation_targets (
  remediation_id uuid not null references public.curriculum_remediations(id) on delete cascade,
  error_id uuid not null references public.curriculum_typical_errors(id) on delete cascade,
  primary key (remediation_id, error_id)
);

create table public.curriculum_catalogue_imports (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.curriculum_sources(id) on delete cascade,
  package_hash text not null,
  report jsonb not null,
  imported_at timestamptz not null default now()
);

create index idx_curriculum_objectives_node on public.curriculum_objectives(node_id, position);
create index idx_curriculum_typical_errors_node on public.curriculum_typical_errors(node_id, position);
create index idx_curriculum_remediations_node on public.curriculum_remediations(node_id, position);
create index idx_curriculum_remediation_targets_error on public.curriculum_remediation_targets(error_id);
create index idx_curriculum_catalogue_imports_source on public.curriculum_catalogue_imports(source_id);

-- Analyses may cite the catalogue error they matched.
alter table public.error_observations
  add column if not exists catalogue_error_id uuid references public.curriculum_typical_errors(id) on delete set null;
alter table public.pedagogical_recommendations
  add column if not exists catalogue_error_id uuid references public.curriculum_typical_errors(id) on delete set null;
create index if not exists idx_error_observations_catalogue on public.error_observations(catalogue_error_id);
create index if not exists idx_pedagogical_recommendations_catalogue on public.pedagogical_recommendations(catalogue_error_id);

alter table public.curriculum_objectives enable row level security;
alter table public.curriculum_typical_errors enable row level security;
alter table public.curriculum_remediations enable row level security;
alter table public.curriculum_remediation_targets enable row level security;
alter table public.curriculum_catalogue_imports enable row level security;
create policy curriculum_objectives_select on public.curriculum_objectives for select to authenticated using (true);
create policy curriculum_typical_errors_select on public.curriculum_typical_errors for select to authenticated using (true);
create policy curriculum_remediations_select on public.curriculum_remediations for select to authenticated using (true);
create policy curriculum_remediation_targets_select on public.curriculum_remediation_targets for select to authenticated using (true);
revoke all on public.curriculum_objectives, public.curriculum_typical_errors, public.curriculum_remediations,
  public.curriculum_remediation_targets, public.curriculum_catalogue_imports from anon;
revoke insert, update, delete, truncate on public.curriculum_objectives, public.curriculum_typical_errors,
  public.curriculum_remediations, public.curriculum_remediation_targets from authenticated;
revoke all on public.curriculum_catalogue_imports from authenticated;
grant select on public.curriculum_objectives, public.curriculum_typical_errors, public.curriculum_remediations,
  public.curriculum_remediation_targets to authenticated;

-- ---------------------------------------------------------------------------
-- Import
-- ---------------------------------------------------------------------------

create or replace function public.focus_import_curriculum_catalogue(
  p_catalogue jsonb,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  c_node_re constant text := '^[A-Z][A-Z0-9]*(\.[A-Z0-9][A-Z0-9_]*)+$';
  v_source_id uuid;
  v_node jsonb;
  v_node_id uuid;
  v_code text;
  v_item jsonb;
  v_index integer;
  v_bad text;
  v_codes text[] := '{}';
  v_counts jsonb := '{}';
  v_hash text;
  v_report jsonb;
  v_changed integer := 0;
  v_rows integer;
  v_deactivated integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('focus.curriculum_import', 0));
  if p_dry_run is null then
    raise exception 'catalogue import: p_dry_run must not be null' using errcode = '22004';
  end if;
  if jsonb_typeof(p_catalogue) is distinct from 'object'
     or jsonb_typeof(p_catalogue->'sourceUrl') is distinct from 'string'
     or jsonb_typeof(p_catalogue->'nodes') is distinct from 'array'
     or jsonb_array_length(p_catalogue->'nodes') > 5000 then
    raise exception 'catalogue import: expected {sourceUrl, nodes[]}' using errcode = '22023';
  end if;
  select id into v_source_id from public.curriculum_sources where source_url = public.focus_curriculum_text(p_catalogue->>'sourceUrl');
  if v_source_id is null then
    raise exception 'catalogue import: unknown curriculum source %', p_catalogue->>'sourceUrl' using errcode = '22023';
  end if;

  -- Structural validation of every entry before any write.
  for v_node, v_index in select value, ordinality from jsonb_array_elements(p_catalogue->'nodes') with ordinality loop
    v_code := v_node->>'code';
    select id into v_node_id from public.curriculum_nodes
    where code = v_code and source_id = v_source_id and active;
    if v_node_id is null then
      raise exception 'catalogue import: % is not an active node of this source', coalesce(v_code, '(missing code)') using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_object_keys(v_node) k where k not in ('code', 'objectives', 'errors', 'remediations')
    ) then
      raise exception 'catalogue import: unexpected keys on %', v_code using errcode = '22023';
    end if;
    select string_agg(e.value->>'code', ', ') into v_bad
    from (
      select value from jsonb_array_elements(coalesce(v_node->'objectives', '[]'))
      union all select value from jsonb_array_elements(coalesce(v_node->'errors', '[]'))
      union all select value from jsonb_array_elements(coalesce(v_node->'remediations', '[]'))
    ) e
    where jsonb_typeof(e.value) <> 'object'
       or coalesce(e.value->>'code', '') !~ c_node_re
       or not starts_with(e.value->>'code', v_code || '.')
       or not public.focus_curriculum_text_ok(e.value->>'provenance', 80, true);
    if v_bad is not null or exists (
      select 1 from jsonb_array_elements(coalesce(v_node->'objectives', '[]')) o
      where not public.focus_curriculum_text_ok(o.value->>'text', 300, true)
         or not public.focus_curriculum_text_ok(o.value->>'sourceLocator', 200, false)
    ) or exists (
      select 1 from jsonb_array_elements(coalesce(v_node->'errors', '[]')) e
      where not public.focus_curriculum_text_ok(e.value->>'description', 300, true)
         or not public.focus_curriculum_text_ok(e.value->>'evidenceRequired', 600, false)
         or not public.focus_curriculum_text_ok(e.value->>'frequencyStatus', 80, false)
         or jsonb_typeof(coalesce(e.value->'alternativeExplanations', '[]')) <> 'array'
         or jsonb_array_length(coalesce(e.value->'alternativeExplanations', '[]')) > 8
         or exists (select 1 from jsonb_array_elements_text(coalesce(e.value->'alternativeExplanations', '[]')) a where not public.focus_curriculum_text_ok(a, 200, true))
    ) or exists (
      select 1 from jsonb_array_elements(coalesce(v_node->'remediations', '[]')) r
      where jsonb_typeof(r.value->'steps') is distinct from 'array'
         or jsonb_array_length(r.value->'steps') not between 1 and 8
         or exists (select 1 from jsonb_array_elements_text(r.value->'steps') s where not public.focus_curriculum_text_ok(s, 300, true))
         or not public.focus_curriculum_text_ok(r.value->>'title', 160, false)
         or not public.focus_curriculum_text_ok(r.value->'check'->>'prompt', 600, false)
         or not public.focus_curriculum_text_ok(r.value->'check'->>'expectedAnswer', 600, false)
         or not public.focus_curriculum_text_ok(r.value->'check'->>'successCriterion', 600, false)
         or not public.focus_curriculum_text_ok(r.value->>'sourceLocator', 200, false)
         or (r.value ? 'durationMinutes' and jsonb_typeof(r.value->'durationMinutes') <> 'null'
             and (jsonb_typeof(r.value->'durationMinutes') <> 'number' or (r.value->>'durationMinutes') !~ '^[0-9]+$'
                  or (r.value->>'durationMinutes')::numeric not between 1 and 240))
         or exists (
           select 1 from jsonb_array_elements_text(coalesce(r.value->'targetErrorCodes', '[]')) t
           where not exists (select 1 from jsonb_array_elements(coalesce(v_node->'errors', '[]')) e where e.value->>'code' = t)
         )
    ) then
      raise exception 'catalogue import: invalid entry for % %', v_code, coalesce(v_bad, '') using errcode = '22023';
    end if;
    v_codes := v_codes || array(
      select value->>'code' from jsonb_array_elements(coalesce(v_node->'objectives', '[]'))
      union all select value->>'code' from jsonb_array_elements(coalesce(v_node->'errors', '[]'))
      union all select value->>'code' from jsonb_array_elements(coalesce(v_node->'remediations', '[]'))
    );
  end loop;
  if cardinality(v_codes) <> (select count(distinct c) from unnest(v_codes) c) then
    raise exception 'catalogue import: duplicate entry codes' using errcode = '22023';
  end if;

  v_hash := encode(sha256(convert_to(p_catalogue::text, 'UTF8')), 'hex');

  begin
    for v_node in select value from jsonb_array_elements(p_catalogue->'nodes') loop
      select id into v_node_id from public.curriculum_nodes where code = v_node->>'code' and source_id = v_source_id;

      insert into public.curriculum_objectives as t (code, node_id, position, text, provenance, source_locator)
      select o.value->>'code', v_node_id, o.ordinality, public.focus_curriculum_text(o.value->>'text'),
             public.focus_curriculum_text(o.value->>'provenance'), nullif(public.focus_curriculum_text(o.value->>'sourceLocator'), '')
      from jsonb_array_elements(coalesce(v_node->'objectives', '[]')) with ordinality o
      on conflict (code) do update set
        node_id = excluded.node_id, position = excluded.position, text = excluded.text, provenance = excluded.provenance,
        source_locator = excluded.source_locator, active = true, updated_at = now()
      where (t.node_id, t.position, t.text, t.provenance, t.source_locator, t.active)
            is distinct from (excluded.node_id, excluded.position, excluded.text, excluded.provenance, excluded.source_locator, true);
      get diagnostics v_rows = row_count;
      v_changed := v_changed + v_rows;

      insert into public.curriculum_typical_errors as t (code, node_id, position, description, evidence_required, alternative_explanations, frequency_status, provenance)
      select e.value->>'code', v_node_id, e.ordinality, public.focus_curriculum_text(e.value->>'description'),
             nullif(public.focus_curriculum_text(e.value->>'evidenceRequired'), ''),
             array(select public.focus_curriculum_text(a) from jsonb_array_elements_text(coalesce(e.value->'alternativeExplanations', '[]')) a),
             nullif(public.focus_curriculum_text(e.value->>'frequencyStatus'), ''),
             public.focus_curriculum_text(e.value->>'provenance')
      from jsonb_array_elements(coalesce(v_node->'errors', '[]')) with ordinality e
      on conflict (code) do update set
        node_id = excluded.node_id, position = excluded.position, description = excluded.description,
        evidence_required = excluded.evidence_required, alternative_explanations = excluded.alternative_explanations,
        frequency_status = excluded.frequency_status, provenance = excluded.provenance, active = true, updated_at = now()
      where (t.node_id, t.position, t.description, t.evidence_required, t.alternative_explanations, t.frequency_status, t.provenance, t.active)
            is distinct from (excluded.node_id, excluded.position, excluded.description, excluded.evidence_required,
                              excluded.alternative_explanations, excluded.frequency_status, excluded.provenance, true);
      get diagnostics v_rows = row_count;
      v_changed := v_changed + v_rows;

      insert into public.curriculum_remediations as t (
        code, node_id, position, title, steps, duration_minutes, duration_is_official, check_prompt,
        check_expected_answer, check_success_criterion, provenance, source_locator
      )
      select r.value->>'code', v_node_id, r.ordinality, coalesce(public.focus_curriculum_text(r.value->>'title'), ''),
             array(select public.focus_curriculum_text(s) from jsonb_array_elements_text(r.value->'steps') s),
             (r.value->>'durationMinutes')::integer, coalesce((r.value->>'durationIsOfficial')::boolean, false),
             nullif(public.focus_curriculum_text(r.value->'check'->>'prompt'), ''),
             nullif(public.focus_curriculum_text(r.value->'check'->>'expectedAnswer'), ''),
             nullif(public.focus_curriculum_text(r.value->'check'->>'successCriterion'), ''),
             public.focus_curriculum_text(r.value->>'provenance'), nullif(public.focus_curriculum_text(r.value->>'sourceLocator'), '')
      from jsonb_array_elements(coalesce(v_node->'remediations', '[]')) with ordinality r
      on conflict (code) do update set
        node_id = excluded.node_id, position = excluded.position, title = excluded.title, steps = excluded.steps,
        duration_minutes = excluded.duration_minutes, duration_is_official = excluded.duration_is_official,
        check_prompt = excluded.check_prompt, check_expected_answer = excluded.check_expected_answer,
        check_success_criterion = excluded.check_success_criterion, provenance = excluded.provenance,
        source_locator = excluded.source_locator, active = true, updated_at = now()
      where (t.node_id, t.position, t.title, t.steps, t.duration_minutes, t.duration_is_official, t.check_prompt,
             t.check_expected_answer, t.check_success_criterion, t.provenance, t.source_locator, t.active)
            is distinct from (excluded.node_id, excluded.position, excluded.title, excluded.steps, excluded.duration_minutes,
                              excluded.duration_is_official, excluded.check_prompt, excluded.check_expected_answer,
                              excluded.check_success_criterion, excluded.provenance, excluded.source_locator, true);
      get diagnostics v_rows = row_count;
      v_changed := v_changed + v_rows;

      -- Remediation → error links, replaced per remediation.
      delete from public.curriculum_remediation_targets rt
      using public.curriculum_remediations r
      where rt.remediation_id = r.id and r.node_id = v_node_id
        and not exists (
          select 1
          from jsonb_array_elements(coalesce(v_node->'remediations', '[]')) rr,
               jsonb_array_elements_text(coalesce(rr.value->'targetErrorCodes', '[]')) target
          join public.curriculum_typical_errors e on e.code = target
          where rr.value->>'code' = r.code and e.id = rt.error_id
        );
      get diagnostics v_rows = row_count;
      v_changed := v_changed + v_rows;
      insert into public.curriculum_remediation_targets (remediation_id, error_id)
      select r.id, e.id
      from jsonb_array_elements(coalesce(v_node->'remediations', '[]')) rr
      cross join jsonb_array_elements_text(coalesce(rr.value->'targetErrorCodes', '[]')) target
      join public.curriculum_remediations r on r.code = rr.value->>'code'
      join public.curriculum_typical_errors e on e.code = target
      on conflict do nothing;
      get diagnostics v_rows = row_count;
      v_changed := v_changed + v_rows;
    end loop;

    -- Entries of this source's nodes that the catalogue no longer lists.
    update public.curriculum_objectives t set active = false, updated_at = now()
    from public.curriculum_nodes n
    where t.node_id = n.id and n.source_id = v_source_id and t.active and not (t.code = any(v_codes));
    get diagnostics v_rows = row_count;
    v_deactivated := v_deactivated + v_rows;
    update public.curriculum_typical_errors t set active = false, updated_at = now()
    from public.curriculum_nodes n
    where t.node_id = n.id and n.source_id = v_source_id and t.active and not (t.code = any(v_codes));
    get diagnostics v_rows = row_count;
    v_deactivated := v_deactivated + v_rows;
    update public.curriculum_remediations t set active = false, updated_at = now()
    from public.curriculum_nodes n
    where t.node_id = n.id and n.source_id = v_source_id and t.active and not (t.code = any(v_codes));
    get diagnostics v_rows = row_count;
    v_deactivated := v_deactivated + v_rows;

    select jsonb_build_object(
      'objectives', (select count(*) from public.curriculum_objectives t join public.curriculum_nodes n on n.id = t.node_id where n.source_id = v_source_id and t.active),
      'typicalErrors', (select count(*) from public.curriculum_typical_errors t join public.curriculum_nodes n on n.id = t.node_id where n.source_id = v_source_id and t.active),
      'remediations', (select count(*) from public.curriculum_remediations t join public.curriculum_nodes n on n.id = t.node_id where n.source_id = v_source_id and t.active),
      'links', (select count(*) from public.curriculum_remediation_targets rt join public.curriculum_remediations r on r.id = rt.remediation_id join public.curriculum_nodes n on n.id = r.node_id where n.source_id = v_source_id)
    ) into v_counts;
    v_report := jsonb_build_object(
      'dryRun', p_dry_run,
      'changed', v_changed + v_deactivated > 0,
      'rowsWritten', v_changed,
      'deactivated', v_deactivated,
      'active', v_counts,
      'packageHash', v_hash
    );
    if not p_dry_run and v_changed + v_deactivated > 0 then
      insert into public.curriculum_catalogue_imports (source_id, package_hash, report) values (v_source_id, v_hash, v_report);
    end if;
    if p_dry_run then
      raise exception using errcode = 'P0001', message = 'focus_catalogue_dry_run', detail = v_report::text;
    end if;
  exception
    when raise_exception then
      if sqlerrm = 'focus_catalogue_dry_run' then
        return v_report;
      end if;
      raise;
  end;
  return v_report;
end;
$$;
revoke all on function public.focus_import_curriculum_catalogue(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.focus_import_curriculum_catalogue(jsonb, boolean) to service_role;
