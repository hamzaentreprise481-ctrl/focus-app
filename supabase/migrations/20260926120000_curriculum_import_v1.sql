-- FOCUS curriculum knowledge base — import pipeline v1.
--
-- Prepares the curriculum graph to ingest complete official programmes from
-- structured packages (see curriculum/README.md):
--   1. database-level guards on nodes and relationships;
--   2. relationship ownership (which source declared an edge);
--   3. an audit table of committed imports;
--   4. public.focus_import_curriculum — validated, idempotent, dry-run by
--      default, service_role only;
--   5. public.focus_export_curriculum — canonical package of a source;
--   6. public.focus_curriculum_graph — deterministic, uncapped, level-scoped
--      graph read used by the pedagogical AI.
--
-- The package stores short FOCUS-written labels and source locators only,
-- never programme or textbook text.

-- 1. Node guards -------------------------------------------------------------

alter table public.curriculum_nodes
  drop constraint if exists curriculum_nodes_code_format,
  add constraint curriculum_nodes_code_format check (
    char_length(code) <= 120
    and code ~ '^[A-Z][A-Z0-9]*(\.[A-Z0-9][A-Z0-9_]*)+$'
  ),
  drop constraint if exists curriculum_nodes_text_lengths,
  add constraint curriculum_nodes_text_lengths check (
    char_length(btrim(title)) between 1 and 160
    and (description is null or char_length(description) <= 300)
    and char_length(btrim(source_locator)) between 1 and 200
  );

-- 2. Relationship ownership and uniqueness -----------------------------------

alter table public.curriculum_edges
  add column if not exists source_id uuid
    references public.curriculum_sources(id) on delete cascade;

-- Existing edges were all declared by the source of their origin node.
update public.curriculum_edges e
set source_id = n.source_id
from public.curriculum_nodes n
where n.id = e.from_node_id
  and e.source_id is null;

-- Keeps legacy insert paths (seed migrations) valid.
create or replace function public.focus_curriculum_edge_default_source()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.source_id is null then
    select n.source_id into new.source_id
    from public.curriculum_nodes n
    where n.id = new.from_node_id;
  end if;
  return new;
end;
$$;

revoke all on function public.focus_curriculum_edge_default_source() from public;
revoke all on function public.focus_curriculum_edge_default_source() from anon;
revoke all on function public.focus_curriculum_edge_default_source() from authenticated;

drop trigger if exists curriculum_edges_default_source on public.curriculum_edges;
create trigger curriculum_edges_default_source
  before insert on public.curriculum_edges
  for each row execute function public.focus_curriculum_edge_default_source();

alter table public.curriculum_edges alter column source_id set not null;

create index if not exists idx_curriculum_edges_source
  on public.curriculum_edges(source_id, relation);

-- At most one relationship between two nodes, whatever its direction: a pair
-- cannot be both "prerequisite_of" and "part_of", nor point both ways.
create unique index if not exists uq_curriculum_edges_node_pair
  on public.curriculum_edges (
    least(from_node_id, to_node_id),
    greatest(from_node_id, to_node_id)
  );

-- 3. Import audit -------------------------------------------------------------

create table if not exists public.curriculum_import_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.curriculum_sources(id) on delete cascade,
  package_hash text not null,
  format_version integer not null,
  report jsonb not null,
  imported_by text not null default current_user,
  imported_at timestamptz not null default now()
);

create index if not exists idx_curriculum_import_runs_source
  on public.curriculum_import_runs(source_id, imported_at desc);

-- No policy: invisible to anon and authenticated clients.
alter table public.curriculum_import_runs enable row level security;
revoke all on public.curriculum_import_runs from anon;
revoke all on public.curriculum_import_runs from authenticated;

-- 4. Import -------------------------------------------------------------------

create or replace function public.focus_import_curriculum(
  p_package jsonb,
  p_dry_run boolean default true,
  p_allow_mass_deactivation boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  c_code_re constant text := '^[A-Z][A-Z0-9]*(\.[A-Z0-9][A-Z0-9_]*)+$';
  c_scope_re constant text := '^[A-Z][A-Z0-9_]*$';
  c_official_url_re constant text := '^https://([a-z0-9-]+\.)*(gouv|education)\.fr([/?#]|$)';
  v_source jsonb;
  v_nodes jsonb;
  v_edges jsonb;
  v_subject text;
  v_level text;
  v_url text;
  v_hash text;
  v_bad text;
  v_codes text[];
  v_from_ids uuid[];
  v_to_ids uuid[];
  v_relations text[];
  v_existing public.curriculum_sources%rowtype;
  v_source_id uuid;
  v_source_created boolean := false;
  v_source_updated boolean := false;
  v_active_before integer := 0;
  v_nodes_inserted integer := 0;
  v_nodes_updated integer := 0;
  v_nodes_reactivated integer := 0;
  v_nodes_unchanged integer := 0;
  v_nodes_deactivated integer := 0;
  v_nodes_deactivated_referenced integer := 0;
  v_deactivation_limit integer;
  v_edges_inserted integer := 0;
  v_edges_deleted integer := 0;
  v_edges_unchanged integer := 0;
  v_edges_shared integer := 0;
  v_changed boolean := false;
  v_report jsonb;
begin
  -- Serialize curriculum imports: ownership, pair and cycle checks must see a
  -- stable graph.
  perform pg_advisory_xact_lock(hashtextextended('focus.curriculum_import', 0));

  -- Shape ---------------------------------------------------------------------
  if p_package is null or jsonb_typeof(p_package) <> 'object' then
    raise exception 'curriculum import: the package must be a JSON object'
      using errcode = '22023';
  end if;
  if p_package->'formatVersion' is distinct from '1'::jsonb then
    raise exception 'curriculum import: unsupported formatVersion %',
      coalesce(p_package->>'formatVersion', '(missing)')
      using errcode = '22023';
  end if;

  v_source := p_package->'source';
  v_nodes := p_package->'nodes';
  v_edges := coalesce(p_package->'edges', '[]'::jsonb);

  if jsonb_typeof(v_source) is distinct from 'object' then
    raise exception 'curriculum import: source must be an object' using errcode = '22023';
  end if;
  if jsonb_typeof(v_nodes) is distinct from 'array'
     or jsonb_array_length(v_nodes) = 0
     or jsonb_array_length(v_nodes) > 5000 then
    raise exception 'curriculum import: nodes must be a non-empty array of at most 5000 items'
      using errcode = '22023';
  end if;
  if jsonb_typeof(v_edges) <> 'array' or jsonb_array_length(v_edges) > 25000 then
    raise exception 'curriculum import: edges must be an array of at most 25000 items'
      using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(v_nodes) x where jsonb_typeof(x) <> 'object')
     or exists (select 1 from jsonb_array_elements(v_edges) x where jsonb_typeof(x) <> 'object') then
    raise exception 'curriculum import: nodes and edges must be objects' using errcode = '22023';
  end if;

  -- Source --------------------------------------------------------------------
  v_subject := v_source->>'subjectCode';
  v_level := v_source->>'levelCode';
  v_url := v_source->>'sourceUrl';
  if coalesce(v_subject, '') !~ c_scope_re or coalesce(v_level, '') !~ c_scope_re then
    raise exception 'curriculum import: invalid subjectCode or levelCode' using errcode = '22023';
  end if;
  if coalesce(v_source->>'schoolYear', '') !~ '^\d{4}-\d{4}$' then
    raise exception 'curriculum import: invalid schoolYear' using errcode = '22023';
  end if;
  if coalesce(v_url, '') !~* c_official_url_re then
    raise exception 'curriculum import: sourceUrl must be an https URL on an official domain'
      using errcode = '22023';
  end if;
  if coalesce(btrim(v_source->>'title'), '') = ''
     or coalesce(btrim(v_source->>'publisher'), '') = ''
     or coalesce(btrim(v_source->>'officialReference'), '') = ''
     or char_length(v_source->>'title') > 300
     or char_length(v_source->>'publisher') > 300
     or char_length(v_source->>'officialReference') > 300 then
    raise exception 'curriculum import: source title, publisher and officialReference are required (300 characters max)'
      using errcode = '22023';
  end if;
  if jsonb_typeof(v_source->'publishedOn') = 'string'
     and (v_source->>'publishedOn') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'curriculum import: publishedOn must be YYYY-MM-DD' using errcode = '22023';
  end if;

  -- Nodes ---------------------------------------------------------------------
  select string_agg(coalesce(n.code, '(missing code)'), ', ' order by n.code)
  into v_bad
  from jsonb_to_recordset(v_nodes)
    as n(code text, type text, title text, description text, "sourceLocator" text)
  where n.code is null
     or char_length(n.code) > 120
     or n.code !~ c_code_re
     or split_part(n.code, '.', 1) <> v_subject
     or n.type is null
     or n.type not in ('domain', 'notion', 'competency', 'prerequisite')
     or coalesce(btrim(n.title), '') = ''
     or char_length(n.title) > 160
     or char_length(coalesce(n.description, '')) > 300
     or coalesce(btrim(n."sourceLocator"), '') = ''
     or char_length(n."sourceLocator") > 200;
  if v_bad is not null then
    raise exception 'curriculum import: invalid nodes: %', left(v_bad, 2000)
      using errcode = '22023';
  end if;

  select string_agg(d.code, ', ' order by d.code)
  into v_bad
  from (
    select n.code
    from jsonb_to_recordset(v_nodes) as n(code text)
    group by n.code
    having count(*) > 1
  ) d;
  if v_bad is not null then
    raise exception 'curriculum import: duplicate node codes: %', left(v_bad, 2000)
      using errcode = '22023';
  end if;

  select array_agg(n.code) into v_codes
  from jsonb_to_recordset(v_nodes) as n(code text);

  -- Edges (shape) -------------------------------------------------------------
  select string_agg(format('%s -%s-> %s', e."from", e.relation, e."to"), ', ')
  into v_bad
  from jsonb_to_recordset(v_edges) as e("from" text, "to" text, relation text)
  where e."from" is null
     or e."to" is null
     or e."from" = e."to"
     or e.relation is null
     or e.relation not in ('prerequisite_of', 'supports', 'part_of');
  if v_bad is not null then
    raise exception 'curriculum import: invalid edges: %', left(v_bad, 2000)
      using errcode = '22023';
  end if;

  select string_agg(format('%s -%s-> %s', d."from", d.relation, d."to"), ', ')
  into v_bad
  from (
    select e."from", e."to", e.relation
    from jsonb_to_recordset(v_edges) as e("from" text, "to" text, relation text)
    group by 1, 2, 3
    having count(*) > 1
  ) d;
  if v_bad is not null then
    raise exception 'curriculum import: duplicate edges: %', left(v_bad, 2000)
      using errcode = '22023';
  end if;

  select string_agg(format('%s / %s', d.a, d.b), ', ')
  into v_bad
  from (
    select least(e."from", e."to") as a, greatest(e."from", e."to") as b
    from jsonb_to_recordset(v_edges) as e("from" text, "to" text)
    group by 1, 2
    having count(*) > 1
  ) d;
  if v_bad is not null then
    raise exception 'curriculum import: several relationships declared for the same node pair: %',
      left(v_bad, 2000)
      using errcode = '22023';
  end if;

  v_hash := encode(sha256(convert_to(p_package::text, 'UTF8')), 'hex');

  -- Writes: everything below runs in a subtransaction so that a dry run can
  -- compute the exact report and then roll back.
  begin
    select * into v_existing
    from public.curriculum_sources
    where source_url = v_url
    for update;

    if found then
      if v_existing.subject_code <> v_subject or v_existing.level_code <> v_level then
        raise exception 'curriculum import: % is already registered for %/%',
          v_url, v_existing.subject_code, v_existing.level_code
          using errcode = '22023';
      end if;
      v_source_id := v_existing.id;
      update public.curriculum_sources s
      set school_year = v_source->>'schoolYear',
          title = v_source->>'title',
          publisher = v_source->>'publisher',
          official_reference = v_source->>'officialReference',
          published_on = (v_source->>'publishedOn')::date
      where s.id = v_source_id
        and (s.school_year, s.title, s.publisher, s.official_reference, s.published_on)
          is distinct from (
            v_source->>'schoolYear',
            v_source->>'title',
            v_source->>'publisher',
            v_source->>'officialReference',
            (v_source->>'publishedOn')::date
          );
      v_source_updated := found;
    else
      insert into public.curriculum_sources(
        subject_code, level_code, school_year, title, publisher,
        official_reference, source_url, published_on
      ) values (
        v_subject, v_level, v_source->>'schoolYear', v_source->>'title',
        v_source->>'publisher', v_source->>'officialReference', v_url,
        (v_source->>'publishedOn')::date
      )
      returning id into v_source_id;
      v_source_created := true;
    end if;

    -- A package may never take over nodes declared by another source.
    select string_agg(c.code, ', ' order by c.code)
    into v_bad
    from public.curriculum_nodes c
    where c.code = any(v_codes)
      and c.source_id <> v_source_id;
    if v_bad is not null then
      raise exception 'curriculum import: nodes already owned by another source: %',
        left(v_bad, 2000)
        using errcode = '22023';
    end if;

    -- Observations and recommendations require notion nodes: never retype a
    -- node that teacher-facing data already references.
    select string_agg(c.code, ', ' order by c.code)
    into v_bad
    from public.curriculum_nodes c
    join jsonb_to_recordset(v_nodes) as n(code text, type text) on n.code = c.code
    where c.source_id = v_source_id
      and c.node_type <> n.type
      and (
        exists (select 1 from public.error_observations o where o.curriculum_node_id = c.id)
        or exists (select 1 from public.pedagogical_recommendations r where r.curriculum_node_id = c.id)
        or exists (select 1 from public.question_curriculum_nodes q where q.curriculum_node_id = c.id)
      );
    if v_bad is not null then
      raise exception 'curriculum import: cannot change the type of referenced nodes: %',
        left(v_bad, 2000)
        using errcode = '22023';
    end if;

    select count(*) filter (where c.active)
    into v_active_before
    from public.curriculum_nodes c
    where c.source_id = v_source_id;

    select
      count(*) filter (where not c.active),
      count(*) filter (
        where c.active
          and (c.node_type, c.title, c.description, c.source_locator)
            is distinct from (n.type, n.title, nullif(btrim(n.description), ''), n."sourceLocator")
      ),
      count(*) filter (
        where c.active
          and (c.node_type, c.title, c.description, c.source_locator)
            is not distinct from (n.type, n.title, nullif(btrim(n.description), ''), n."sourceLocator")
      )
    into v_nodes_reactivated, v_nodes_updated, v_nodes_unchanged
    from public.curriculum_nodes c
    join jsonb_to_recordset(v_nodes)
      as n(code text, type text, title text, description text, "sourceLocator" text)
      on n.code = c.code
    where c.source_id = v_source_id;

    insert into public.curriculum_nodes(
      source_id, code, node_type, title, description, source_locator
    )
    select v_source_id, n.code, n.type, n.title,
           nullif(btrim(n.description), ''), n."sourceLocator"
    from jsonb_to_recordset(v_nodes)
      as n(code text, type text, title text, description text, "sourceLocator" text)
    where not exists (select 1 from public.curriculum_nodes c where c.code = n.code);
    get diagnostics v_nodes_inserted = row_count;

    update public.curriculum_nodes c
    set node_type = n.type,
        title = n.title,
        description = nullif(btrim(n.description), ''),
        source_locator = n."sourceLocator",
        active = true
    from jsonb_to_recordset(v_nodes)
      as n(code text, type text, title text, description text, "sourceLocator" text)
    where c.code = n.code
      and c.source_id = v_source_id
      and (c.node_type, c.title, c.description, c.source_locator, c.active)
        is distinct from (n.type, n.title, nullif(btrim(n.description), ''), n."sourceLocator", true);

    -- Nodes absent from the package are deactivated, never deleted: past
    -- observations and recommendations keep their reference.
    select
      count(*),
      count(*) filter (
        where exists (select 1 from public.error_observations o where o.curriculum_node_id = c.id)
           or exists (select 1 from public.pedagogical_recommendations r where r.curriculum_node_id = c.id)
           or exists (select 1 from public.question_curriculum_nodes q where q.curriculum_node_id = c.id)
      )
    into v_nodes_deactivated, v_nodes_deactivated_referenced
    from public.curriculum_nodes c
    where c.source_id = v_source_id
      and c.active
      and not (c.code = any(v_codes));

    -- A truncated or wrong file must not silently empty a programme.
    v_deactivation_limit := greatest(2, floor(v_active_before * 0.2)::integer);
    if v_nodes_deactivated > v_deactivation_limit and not p_allow_mass_deactivation then
      raise exception 'curriculum import: % of % active nodes would be deactivated (limit %); allow mass deactivation explicitly if intended',
        v_nodes_deactivated, v_active_before, v_deactivation_limit
        using errcode = '22023';
    end if;

    update public.curriculum_nodes c
    set active = false
    where c.source_id = v_source_id
      and c.active
      and not (c.code = any(v_codes));

    -- Edges (resolution and semantics) -----------------------------------------
    select string_agg(distinct x.code, ', ')
    into v_bad
    from (
      select e."from" as code from jsonb_to_recordset(v_edges) as e("from" text)
      union
      select e."to" from jsonb_to_recordset(v_edges) as e("to" text)
    ) x
    left join public.curriculum_nodes c on c.code = x.code
    where c.id is null or not c.active;
    if v_bad is not null then
      raise exception 'curriculum import: edges reference unknown or inactive nodes: %',
        left(v_bad, 2000)
        using errcode = '22023';
    end if;

    select string_agg(format('%s -%s-> %s', e."from", e.relation, e."to"), ', ')
    into v_bad
    from jsonb_to_recordset(v_edges) as e("from" text, "to" text, relation text)
    join public.curriculum_nodes f on f.code = e."from"
    join public.curriculum_nodes t on t.code = e."to"
    where f.source_id <> v_source_id and t.source_id <> v_source_id;
    if v_bad is not null then
      raise exception 'curriculum import: edges must touch at least one node of the imported source: %',
        left(v_bad, 2000)
        using errcode = '22023';
    end if;

    select string_agg(
      format('%s (%s) -%s-> %s (%s)', e."from", f.node_type, e.relation, e."to", t.node_type),
      ', '
    )
    into v_bad
    from jsonb_to_recordset(v_edges) as e("from" text, "to" text, relation text)
    join public.curriculum_nodes f on f.code = e."from"
    join public.curriculum_nodes t on t.code = e."to"
    where not (
      (e.relation = 'prerequisite_of'
        and (f.node_type, t.node_type) in (('notion', 'notion'), ('prerequisite', 'notion')))
      or (e.relation = 'supports'
        and (f.node_type, t.node_type) in (
          ('notion', 'competency'), ('notion', 'notion'), ('prerequisite', 'competency')))
      or (e.relation = 'part_of'
        and (f.node_type, t.node_type) in (
          ('notion', 'notion'), ('notion', 'domain'), ('domain', 'domain'),
          ('competency', 'competency')))
    );
    if v_bad is not null then
      raise exception 'curriculum import: relationship not allowed between these node types: %',
        left(v_bad, 2000)
        using errcode = '22023';
    end if;

    select
      coalesce(array_agg(f.id), '{}'),
      coalesce(array_agg(t.id), '{}'),
      coalesce(array_agg(e.relation), '{}')
    into v_from_ids, v_to_ids, v_relations
    from jsonb_to_recordset(v_edges) as e("from" text, "to" text, relation text)
    join public.curriculum_nodes f on f.code = e."from"
    join public.curriculum_nodes t on t.code = e."to";

    delete from public.curriculum_edges ce
    where ce.source_id = v_source_id
      and not exists (
        select 1
        from unnest(v_from_ids, v_to_ids, v_relations) as p(from_id, to_id, relation)
        where p.from_id = ce.from_node_id
          and p.to_id = ce.to_node_id
          and p.relation = ce.relation
      );
    get diagnostics v_edges_deleted = row_count;

    select string_agg(
      format('%s -%s-> %s conflicts with %s -%s-> %s',
        pf.code, p.relation, pt.code, cf.code, ce.relation, ct.code),
      ', '
    )
    into v_bad
    from unnest(v_from_ids, v_to_ids, v_relations) as p(from_id, to_id, relation)
    join public.curriculum_edges ce
      on least(ce.from_node_id, ce.to_node_id) = least(p.from_id, p.to_id)
     and greatest(ce.from_node_id, ce.to_node_id) = greatest(p.from_id, p.to_id)
    join public.curriculum_nodes pf on pf.id = p.from_id
    join public.curriculum_nodes pt on pt.id = p.to_id
    join public.curriculum_nodes cf on cf.id = ce.from_node_id
    join public.curriculum_nodes ct on ct.id = ce.to_node_id
    where not (
      ce.from_node_id = p.from_id
      and ce.to_node_id = p.to_id
      and ce.relation = p.relation
    );
    if v_bad is not null then
      raise exception 'curriculum import: relationship conflicts with the existing graph: %',
        left(v_bad, 2000)
        using errcode = '22023';
    end if;

    select
      count(*) filter (where ce.source_id = v_source_id),
      count(*) filter (where ce.source_id <> v_source_id)
    into v_edges_unchanged, v_edges_shared
    from unnest(v_from_ids, v_to_ids, v_relations) as p(from_id, to_id, relation)
    join public.curriculum_edges ce
      on ce.from_node_id = p.from_id
     and ce.to_node_id = p.to_id
     and ce.relation = p.relation;

    insert into public.curriculum_edges(from_node_id, to_node_id, relation, source_id)
    select p.from_id, p.to_id, p.relation, v_source_id
    from unnest(v_from_ids, v_to_ids, v_relations) as p(from_id, to_id, relation)
    where not exists (
      select 1
      from public.curriculum_edges ce
      where ce.from_node_id = p.from_id
        and ce.to_node_id = p.to_id
        and ce.relation = p.relation
    );
    get diagnostics v_edges_inserted = row_count;

    -- The graph had no cycle before this import, so any new cycle goes through
    -- an edge declared by this source: reachability from those edges suffices.
    with recursive reach(relation, start_id, node_id) as (
      select ce.relation, ce.from_node_id, ce.to_node_id
      from public.curriculum_edges ce
      where ce.source_id = v_source_id
        and ce.relation in ('prerequisite_of', 'part_of')
      union
      select r.relation, r.start_id, ce.to_node_id
      from reach r
      join public.curriculum_edges ce
        on ce.from_node_id = r.node_id
       and ce.relation = r.relation
    )
    select string_agg(distinct format('%s (%s)', n.code, r.relation), ', ')
    into v_bad
    from reach r
    join public.curriculum_nodes n on n.id = r.start_id
    where r.start_id = r.node_id;
    if v_bad is not null then
      raise exception 'curriculum import: cycle detected through: %', left(v_bad, 2000)
        using errcode = '22023';
    end if;

    v_changed := v_source_created
      or v_source_updated
      or v_nodes_inserted > 0
      or v_nodes_updated > 0
      or v_nodes_reactivated > 0
      or v_nodes_deactivated > 0
      or v_edges_inserted > 0
      or v_edges_deleted > 0;

    v_report := jsonb_build_object(
      'dryRun', p_dry_run,
      'changed', v_changed,
      'packageHash', v_hash,
      'sourceId', v_source_id,
      'sourceUrl', v_url,
      'source', jsonb_build_object(
        'created', v_source_created,
        'updated', v_source_updated
      ),
      'nodes', jsonb_build_object(
        'inserted', v_nodes_inserted,
        'updated', v_nodes_updated,
        'reactivated', v_nodes_reactivated,
        'unchanged', v_nodes_unchanged,
        'deactivated', v_nodes_deactivated,
        'deactivatedStillReferenced', v_nodes_deactivated_referenced
      ),
      'edges', jsonb_build_object(
        'inserted', v_edges_inserted,
        'deleted', v_edges_deleted,
        'unchanged', v_edges_unchanged,
        'sharedWithOtherSources', v_edges_shared
      )
    );

    -- A re-import of an identical package leaves the database byte-for-byte
    -- unchanged, including this audit table.
    if v_changed and not p_dry_run then
      insert into public.curriculum_import_runs(source_id, package_hash, format_version, report)
      values (v_source_id, v_hash, 1, v_report);
    end if;

    if p_dry_run then
      raise exception using errcode = 'FCDRY', message = 'focus curriculum dry run';
    end if;
  exception
    when sqlstate 'FCDRY' then
      null; -- every write of the block is rolled back; v_report is kept.
  end;

  return v_report;
end;
$$;

revoke all on function public.focus_import_curriculum(jsonb, boolean, boolean) from public;
revoke all on function public.focus_import_curriculum(jsonb, boolean, boolean) from anon;
revoke all on function public.focus_import_curriculum(jsonb, boolean, boolean) from authenticated;
grant execute on function public.focus_import_curriculum(jsonb, boolean, boolean) to service_role;

-- 5. Export -------------------------------------------------------------------

create or replace function public.focus_export_curriculum(p_source_url text)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'formatVersion', 1,
    'source', jsonb_build_object(
      'subjectCode', s.subject_code,
      'levelCode', s.level_code,
      'schoolYear', s.school_year,
      'title', s.title,
      'publisher', s.publisher,
      'officialReference', s.official_reference,
      'sourceUrl', s.source_url,
      'publishedOn', s.published_on
    ),
    'nodes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'code', n.code,
          'type', n.node_type,
          'title', n.title,
          'description', n.description,
          'sourceLocator', n.source_locator
        )
        order by n.code collate "C"
      )
      from public.curriculum_nodes n
      where n.source_id = s.id and n.active
    ), '[]'::jsonb),
    'edges', coalesce((
      select jsonb_agg(
        jsonb_build_object('from', f.code, 'to', t.code, 'relation', e.relation)
        order by f.code collate "C", t.code collate "C", e.relation collate "C"
      )
      from public.curriculum_edges e
      join public.curriculum_nodes f on f.id = e.from_node_id and f.active
      join public.curriculum_nodes t on t.id = e.to_node_id and t.active
      where e.source_id = s.id
    ), '[]'::jsonb)
  )
  from public.curriculum_sources s
  where s.source_url = p_source_url;
$$;

revoke all on function public.focus_export_curriculum(text) from public;
revoke all on function public.focus_export_curriculum(text) from anon;
revoke all on function public.focus_export_curriculum(text) from authenticated;
grant execute on function public.focus_export_curriculum(text) to service_role;

-- 6. Graph read for the pedagogical AI ----------------------------------------
--
-- One call, one JSON value: not subject to PostgREST's row cap, ordered by
-- code, restricted to the requested subject/levels plus the prior-level nodes
-- that are direct prerequisites of in-scope nodes (context only).

create or replace function public.focus_curriculum_graph(
  p_subject_code text,
  p_level_codes text[] default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with scope_sources as (
    select s.id
    from public.curriculum_sources s
    where s.subject_code = p_subject_code
      and (p_level_codes is null or s.level_code = any(p_level_codes))
  ),
  scope_nodes as (
    select n.id
    from public.curriculum_nodes n
    where n.active
      and n.source_id in (select id from scope_sources)
  ),
  boundary_nodes as (
    select distinct e.from_node_id as id
    from public.curriculum_edges e
    join public.curriculum_nodes f on f.id = e.from_node_id and f.active
    where e.relation = 'prerequisite_of'
      and e.to_node_id in (select id from scope_nodes)
      and e.from_node_id not in (select id from scope_nodes)
  ),
  graph_nodes as (
    select n.id, n.source_id, n.code, n.node_type, n.title, n.description,
           n.source_locator, true as in_scope
    from public.curriculum_nodes n
    where n.id in (select id from scope_nodes)
    union all
    select n.id, n.source_id, n.code, n.node_type, n.title, n.description,
           n.source_locator, false as in_scope
    from public.curriculum_nodes n
    where n.id in (select id from boundary_nodes)
  ),
  graph_edges as (
    select f.code as from_code, t.code as to_code, e.relation
    from public.curriculum_edges e
    join graph_nodes f on f.id = e.from_node_id
    join graph_nodes t on t.id = e.to_node_id
    where f.in_scope or t.in_scope
  )
  select jsonb_build_object(
    'sources', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'subjectCode', s.subject_code,
          'levelCode', s.level_code,
          'schoolYear', s.school_year,
          'title', s.title,
          'officialReference', s.official_reference,
          'sourceUrl', s.source_url
        )
        order by s.source_url collate "C"
      )
      from public.curriculum_sources s
      where s.id in (select source_id from graph_nodes)
    ), '[]'::jsonb),
    'nodes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', g.id,
          'sourceId', g.source_id,
          'code', g.code,
          'nodeType', g.node_type,
          'title', g.title,
          'description', g.description,
          'sourceLocator', g.source_locator,
          'inScope', g.in_scope
        )
        order by g.code collate "C"
      )
      from graph_nodes g
    ), '[]'::jsonb),
    'edges', coalesce((
      select jsonb_agg(
        jsonb_build_object('from', ge.from_code, 'to', ge.to_code, 'relation', ge.relation)
        order by ge.from_code collate "C", ge.to_code collate "C", ge.relation collate "C"
      )
      from graph_edges ge
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.focus_curriculum_graph(text, text[]) from public;
revoke all on function public.focus_curriculum_graph(text, text[]) from anon;
grant execute on function public.focus_curriculum_graph(text, text[]) to authenticated;
grant execute on function public.focus_curriculum_graph(text, text[]) to service_role;
