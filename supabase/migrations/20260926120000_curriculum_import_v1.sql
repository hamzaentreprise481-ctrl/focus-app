-- FOCUS curriculum knowledge base — import pipeline v1.
--
-- Prepares the curriculum graph to ingest complete official programmes from
-- structured packages (see curriculum/README.md):
--   1. database-level guards on nodes and relationships;
--   2. relationship declarations (which sources declare each edge);
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

-- 2. Relationship declarations and uniqueness ------------------------------
--
-- A relationship stays in the graph as long as at least one source declares
-- it. An import replaces only its own declarations; an edge row is deleted
-- only when its last declaring source stops declaring it.

create table if not exists public.curriculum_edge_declarations (
  from_node_id uuid not null,
  to_node_id uuid not null,
  relation text not null,
  source_id uuid not null references public.curriculum_sources(id) on delete cascade,
  declared_at timestamptz not null default now(),
  primary key (from_node_id, to_node_id, relation, source_id),
  foreign key (from_node_id, to_node_id, relation)
    references public.curriculum_edges(from_node_id, to_node_id, relation)
    on delete cascade
);

create index if not exists idx_curriculum_edge_declarations_source
  on public.curriculum_edge_declarations(source_id, relation);

-- Existing edges were all declared by the source of their origin node.
insert into public.curriculum_edge_declarations(from_node_id, to_node_id, relation, source_id)
select e.from_node_id, e.to_node_id, e.relation, n.source_id
from public.curriculum_edges e
join public.curriculum_nodes n on n.id = e.from_node_id
on conflict do nothing;

alter table public.curriculum_edge_declarations enable row level security;
drop policy if exists curriculum_edge_declarations_select on public.curriculum_edge_declarations;
create policy curriculum_edge_declarations_select on public.curriculum_edge_declarations
  for select to authenticated using (true);
revoke all on public.curriculum_edge_declarations from anon;
revoke insert, update, delete, truncate on public.curriculum_edge_declarations from authenticated;
grant select on public.curriculum_edge_declarations to authenticated;

-- Invariant checked at commit: an edge exists only while a source declares it
-- (covers direct inserts outside the importer and removed declarations).
create or replace function public.focus_curriculum_edge_declared()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_from uuid;
  v_to uuid;
  v_relation text;
begin
  if tg_table_name = 'curriculum_edges' then
    v_from := new.from_node_id;
    v_to := new.to_node_id;
    v_relation := new.relation;
  else
    v_from := old.from_node_id;
    v_to := old.to_node_id;
    v_relation := old.relation;
  end if;
  if exists (
       select 1 from public.curriculum_edges e
       where e.from_node_id = v_from and e.to_node_id = v_to and e.relation = v_relation
     )
     and not exists (
       select 1 from public.curriculum_edge_declarations d
       where d.from_node_id = v_from and d.to_node_id = v_to and d.relation = v_relation
     ) then
    raise exception 'curriculum edge has no declaring source' using errcode = '23514';
  end if;
  return null;
end;
$$;

revoke all on function public.focus_curriculum_edge_declared() from public;
revoke all on function public.focus_curriculum_edge_declared() from anon;
revoke all on function public.focus_curriculum_edge_declared() from authenticated;

drop trigger if exists curriculum_edges_declared on public.curriculum_edges;
create constraint trigger curriculum_edges_declared
  after insert on public.curriculum_edges
  deferrable initially deferred
  for each row execute function public.focus_curriculum_edge_declared();

drop trigger if exists curriculum_edge_declarations_remaining on public.curriculum_edge_declarations;
create constraint trigger curriculum_edge_declarations_remaining
  after delete on public.curriculum_edge_declarations
  deferrable initially deferred
  for each row execute function public.focus_curriculum_edge_declared();

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

-- Text rules shared with the TypeScript validator (lib/curriculum/package.ts):
-- the length and emptiness limits apply to the normalized form (NFC, runs of
-- JavaScript whitespace collapsed to one space, trimmed), and the same control
-- characters are refused. Anything the database accepts therefore validates
-- again when exported.
create or replace function public.focus_curriculum_text(p_value text)
returns text
language sql
immutable
set search_path = public
as $$
  select btrim(
    regexp_replace(
      normalize(p_value, NFC),
      '[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+',
      ' ',
      'g'
    ),
    ' '
  )
$$;

create or replace function public.focus_curriculum_text_ok(
  p_value text,
  p_max integer,
  p_required boolean
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when p_value is null then not p_required
    when p_value ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]' then false
    when public.focus_curriculum_text(p_value) = '' then not p_required
    else char_length(public.focus_curriculum_text(p_value)) <= p_max
  end
$$;

revoke all on function public.focus_curriculum_text(text) from public;
revoke all on function public.focus_curriculum_text(text) from anon;
revoke all on function public.focus_curriculum_text(text) from authenticated;
revoke all on function public.focus_curriculum_text_ok(text, integer, boolean) from public;
revoke all on function public.focus_curriculum_text_ok(text, integer, boolean) from anon;
revoke all on function public.focus_curriculum_text_ok(text, integer, boolean) from authenticated;

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
  v_edges_inserted integer := 0;
  v_edges_deleted integer := 0;
  v_edges_unchanged integer := 0;
  v_edges_adopted integer := 0;
  v_edges_released integer := 0;
  v_released_from uuid[];
  v_released_to uuid[];
  v_released_relations text[];
  v_changed boolean := false;
  v_report jsonb;
begin
  -- Serialize curriculum imports: ownership, pair and cycle checks must see a
  -- stable graph.
  perform pg_advisory_xact_lock(hashtextextended('focus.curriculum_import', 0));

  -- The safety flags must be explicit: NULL would skip the dry-run rollback or
  -- the mass-deactivation guard.
  if p_dry_run is null or p_allow_mass_deactivation is null then
    raise exception 'curriculum import: p_dry_run and p_allow_mass_deactivation must not be null'
      using errcode = '22004';
  end if;

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
  -- Canonical form only: the inline JSON form (partOf, prerequisites,
  -- competencies on nodes) is expanded by the validator. Dropping those keys
  -- here would silently release every relationship they express.
  select string_agg(distinct k, ', ' order by k)
  into v_bad
  from (
    select k from jsonb_object_keys(p_package) k
    where k not in ('formatVersion', 'source', 'nodes', 'edges')
    union all
    select k from jsonb_object_keys(v_source) k
    where k not in ('subjectCode', 'levelCode', 'schoolYear', 'title', 'publisher',
                    'officialReference', 'sourceUrl', 'publishedOn')
    union all
    select k from jsonb_array_elements(v_nodes) x, jsonb_object_keys(x) k
    where k not in ('code', 'type', 'title', 'description', 'sourceLocator')
    union all
    select k from jsonb_array_elements(v_edges) x, jsonb_object_keys(x) k
    where k not in ('from', 'to', 'relation')
  ) u;
  if v_bad is not null then
    raise exception 'curriculum import: only the canonical package is accepted (validate it with scripts/curriculum.ts); unexpected keys: %',
      left(v_bad, 2000)
      using errcode = '22023';
  end if;

  -- Text rules on the values as received: control characters are refused
  -- before normalization, lengths are measured after it (validator rules).
  if not (
       public.focus_curriculum_text_ok(v_source->>'subjectCode', 300, true)
       and public.focus_curriculum_text_ok(v_source->>'levelCode', 300, true)
       and public.focus_curriculum_text_ok(v_source->>'schoolYear', 300, true)
       and public.focus_curriculum_text_ok(v_source->>'title', 300, true)
       and public.focus_curriculum_text_ok(v_source->>'publisher', 300, true)
       and public.focus_curriculum_text_ok(v_source->>'officialReference', 300, true)
       and public.focus_curriculum_text_ok(v_source->>'sourceUrl', 300, true)
     ) then
    raise exception 'curriculum import: source fields are required, 300 characters max, without control characters'
      using errcode = '22023';
  end if;
  if v_source ? 'publishedOn'
     and jsonb_typeof(v_source->'publishedOn') not in ('string', 'null') then
    raise exception 'curriculum import: publishedOn must be YYYY-MM-DD or null' using errcode = '22023';
  end if;

  select string_agg(coalesce(n.code, '(missing code)'), ', ' order by n.code)
  into v_bad
  from jsonb_to_recordset(v_nodes)
    as n(code text, title text, description text, "sourceLocator" text)
  where not public.focus_curriculum_text_ok(n.title, 160, true)
     or not public.focus_curriculum_text_ok(n.description, 300, false)
     or not public.focus_curriculum_text_ok(n."sourceLocator", 200, true);
  if v_bad is not null then
    raise exception 'curriculum import: invalid nodes: %', left(v_bad, 2000)
      using errcode = '22023';
  end if;

  -- Normalize once, like the validator's canonical package: identity (source
  -- URL, codes), every check below, the hash and the stored values all use
  -- the normalized form, so an export always round-trips.
  v_source := jsonb_build_object(
    'subjectCode', public.focus_curriculum_text(v_source->>'subjectCode'),
    'levelCode', public.focus_curriculum_text(v_source->>'levelCode'),
    'schoolYear', public.focus_curriculum_text(v_source->>'schoolYear'),
    'title', public.focus_curriculum_text(v_source->>'title'),
    'publisher', public.focus_curriculum_text(v_source->>'publisher'),
    'officialReference', public.focus_curriculum_text(v_source->>'officialReference'),
    'sourceUrl', public.focus_curriculum_text(v_source->>'sourceUrl'),
    'publishedOn', coalesce(v_source->'publishedOn', 'null'::jsonb)
  );
  v_nodes := (
    select jsonb_agg(
      jsonb_build_object(
        'code', public.focus_curriculum_text(x->>'code'),
        'type', x->>'type',
        'title', public.focus_curriculum_text(x->>'title'),
        'description', nullif(public.focus_curriculum_text(x->>'description'), ''),
        'sourceLocator', public.focus_curriculum_text(x->>'sourceLocator')
      )
      order by i
    )
    from jsonb_array_elements(v_nodes) with ordinality as t(x, i)
  );
  v_edges := coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'from', public.focus_curriculum_text(x->>'from'),
        'to', public.focus_curriculum_text(x->>'to'),
        'relation', public.focus_curriculum_text(x->>'relation')
      )
      order by i
    )
    from jsonb_array_elements(v_edges) with ordinality as t(x, i)
  ), '[]'::jsonb);

  -- Source --------------------------------------------------------------------
  v_subject := v_source->>'subjectCode';
  v_level := v_source->>'levelCode';
  v_url := v_source->>'sourceUrl';
  if coalesce(v_subject, '') !~ c_scope_re or coalesce(v_level, '') !~ c_scope_re then
    raise exception 'curriculum import: invalid subjectCode or levelCode' using errcode = '22023';
  end if;
  -- Same invariant as the offline validator: two consecutive years.
  if coalesce(v_source->>'schoolYear', '') !~ '^\d{4}-\d{4}$'
     or split_part(v_source->>'schoolYear', '-', 2)::integer
        <> split_part(v_source->>'schoolYear', '-', 1)::integer + 1 then
    raise exception 'curriculum import: invalid schoolYear (expected two consecutive years, e.g. 2026-2027)'
      using errcode = '22023';
  end if;
  if coalesce(v_url, '') !~* c_official_url_re then
    raise exception 'curriculum import: sourceUrl must be an https URL on an official domain'
      using errcode = '22023';
  end if;
  if jsonb_typeof(v_source->'publishedOn') = 'string'
     and (v_source->>'publishedOn') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'curriculum import: publishedOn must be YYYY-MM-DD' using errcode = '22023';
  end if;

  -- Nodes ---------------------------------------------------------------------
  select string_agg(coalesce(n.code, '(missing code)'), ', ' order by n.code)
  into v_bad
  from jsonb_to_recordset(v_nodes) as n(code text, type text)
  where n.code is null
     or char_length(n.code) > 120
     or n.code !~ c_code_re
     or split_part(n.code, '.', 1) <> v_subject
     or n.type is null
     or n.type not in ('domain', 'notion', 'competency', 'prerequisite');
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

  -- Hash of the canonical serialization, byte-identical to the validator's
  -- JSON.stringify of the canonical package (fixed key order, nodes sorted by
  -- code, edges by from/to/relation, in code-unit order like the validator's
  -- compareCodes): the audit row matches the CLI fingerprint, the "-- Package
  -- hash" of a generated migration and the export, whatever the input order.
  v_hash := encode(sha256(convert_to(
    '{"formatVersion":1,"source":{'
      || '"subjectCode":' || to_json(v_source->>'subjectCode')::text
      || ',"levelCode":' || to_json(v_source->>'levelCode')::text
      || ',"schoolYear":' || to_json(v_source->>'schoolYear')::text
      || ',"title":' || to_json(v_source->>'title')::text
      || ',"publisher":' || to_json(v_source->>'publisher')::text
      || ',"officialReference":' || to_json(v_source->>'officialReference')::text
      || ',"sourceUrl":' || to_json(v_source->>'sourceUrl')::text
      || ',"publishedOn":' || coalesce(to_json(v_source->>'publishedOn')::text, 'null')
      || '},"nodes":['
      || coalesce((
        select string_agg(
          '{"code":' || to_json(x->>'code')::text
            || ',"type":' || to_json(x->>'type')::text
            || ',"title":' || to_json(x->>'title')::text
            || ',"description":' || coalesce(to_json(x->>'description')::text, 'null')
            || ',"sourceLocator":' || to_json(x->>'sourceLocator')::text
            || '}',
          ',' order by x->>'code' collate "C")
        from jsonb_array_elements(v_nodes) as t(x)
      ), '')
      || '],"edges":['
      || coalesce((
        select string_agg(
          '{"from":' || to_json(x->>'from')::text
            || ',"to":' || to_json(x->>'to')::text
            || ',"relation":' || to_json(x->>'relation')::text
            || '}',
          ',' order by x->>'from' collate "C", x->>'to' collate "C", x->>'relation' collate "C")
        from jsonb_array_elements(v_edges) as t(x)
      ), '')
      || ']}',
    'UTF8')), 'hex');

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

    -- A truncated or wrong file must not silently empty a programme: more
    -- than 20 percent of its active nodes, whatever its size, needs an
    -- explicit override. Integer arithmetic: deactivated / active > 1 / 5.
    if v_nodes_deactivated > 0
       and v_nodes_deactivated * 5 > v_active_before
       and not p_allow_mass_deactivation then
      raise exception 'curriculum import: % of % active nodes would be deactivated, above the 20 percent limit; allow mass deactivation explicitly if intended',
        v_nodes_deactivated, v_active_before
        using errcode = '22023';
    end if;

    -- A node still used by relationships that OTHER sources declare cannot be
    -- deactivated: those sources could no longer re-import their package and
    -- their relationships would silently disappear from graph reads.
    select string_agg(distinct format('%s (%s)', c.code, s.source_url), ', ')
    into v_bad
    from public.curriculum_nodes c
    join public.curriculum_edge_declarations d
      on (d.from_node_id = c.id or d.to_node_id = c.id)
     and d.source_id <> v_source_id
    join public.curriculum_sources s on s.id = d.source_id
    where c.source_id = v_source_id
      and c.active
      and not (c.code = any(v_codes));
    if v_bad is not null then
      raise exception 'curriculum import: cannot deactivate nodes still used by relationships declared by other sources: %',
        left(v_bad, 2000)
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

    -- Release the declarations this package no longer contains, then delete
    -- only the edges that no other source still declares.
    with released as (
      delete from public.curriculum_edge_declarations d
      where d.source_id = v_source_id
        and not exists (
          select 1
          from unnest(v_from_ids, v_to_ids, v_relations) as p(from_id, to_id, relation)
          where p.from_id = d.from_node_id
            and p.to_id = d.to_node_id
            and p.relation = d.relation
        )
      returning d.from_node_id, d.to_node_id, d.relation
    )
    select
      coalesce(array_agg(released.from_node_id), '{}'),
      coalesce(array_agg(released.to_node_id), '{}'),
      coalesce(array_agg(released.relation), '{}')
    into v_released_from, v_released_to, v_released_relations
    from released;

    delete from public.curriculum_edges ce
    using unnest(v_released_from, v_released_to, v_released_relations) as r(from_id, to_id, relation)
    where ce.from_node_id = r.from_id
      and ce.to_node_id = r.to_id
      and ce.relation = r.relation
      and not exists (
        select 1 from public.curriculum_edge_declarations d
        where d.from_node_id = ce.from_node_id
          and d.to_node_id = ce.to_node_id
          and d.relation = ce.relation
      );
    get diagnostics v_edges_deleted = row_count;
    v_edges_released := cardinality(v_released_from) - v_edges_deleted;

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

    -- Existing edges: already declared by this source (unchanged) or declared
    -- only by other sources so far (adopted: this source now co-declares it).
    select
      count(*) filter (where d.source_id is not null),
      count(*) filter (where d.source_id is null)
    into v_edges_unchanged, v_edges_adopted
    from unnest(v_from_ids, v_to_ids, v_relations) as p(from_id, to_id, relation)
    join public.curriculum_edges ce
      on ce.from_node_id = p.from_id
     and ce.to_node_id = p.to_id
     and ce.relation = p.relation
    left join public.curriculum_edge_declarations d
      on d.from_node_id = p.from_id
     and d.to_node_id = p.to_id
     and d.relation = p.relation
     and d.source_id = v_source_id;

    insert into public.curriculum_edges(from_node_id, to_node_id, relation)
    select p.from_id, p.to_id, p.relation
    from unnest(v_from_ids, v_to_ids, v_relations) as p(from_id, to_id, relation)
    where not exists (
      select 1
      from public.curriculum_edges ce
      where ce.from_node_id = p.from_id
        and ce.to_node_id = p.to_id
        and ce.relation = p.relation
    );
    get diagnostics v_edges_inserted = row_count;

    insert into public.curriculum_edge_declarations(from_node_id, to_node_id, relation, source_id)
    select p.from_id, p.to_id, p.relation, v_source_id
    from unnest(v_from_ids, v_to_ids, v_relations) as p(from_id, to_id, relation)
    on conflict do nothing;

    -- Final state: every relationship touching this source's nodes — whoever
    -- declares it — must still satisfy the type rules (a retyped node must not
    -- leave another source's relationship invalid) and join active nodes.
    select string_agg(
      format('%s (%s) -%s-> %s (%s)', f.code, f.node_type, e.relation, t.code, t.node_type),
      ', '
    )
    into v_bad
    from public.curriculum_edges e
    join public.curriculum_nodes f on f.id = e.from_node_id
    join public.curriculum_nodes t on t.id = e.to_node_id
    where (f.source_id = v_source_id or t.source_id = v_source_id)
      and (
        not f.active
        or not t.active
        or not (
          (e.relation = 'prerequisite_of'
            and (f.node_type, t.node_type) in (('notion', 'notion'), ('prerequisite', 'notion')))
          or (e.relation = 'supports'
            and (f.node_type, t.node_type) in (
              ('notion', 'competency'), ('notion', 'notion'), ('prerequisite', 'competency')))
          or (e.relation = 'part_of'
            and (f.node_type, t.node_type) in (
              ('notion', 'notion'), ('notion', 'domain'), ('domain', 'domain'),
              ('competency', 'competency')))
        )
      );
    if v_bad is not null then
      raise exception 'curriculum import: the resulting graph would contain invalid relationships (type rules or inactive endpoints): %',
        left(v_bad, 2000)
        using errcode = '22023';
    end if;

    -- The graph had no cycle before this import, so any new cycle goes through
    -- an edge declared by this source: reachability from those edges suffices.
    with recursive reach(relation, start_id, node_id) as (
      select d.relation, d.from_node_id, d.to_node_id
      from public.curriculum_edge_declarations d
      where d.source_id = v_source_id
        and d.relation in ('prerequisite_of', 'part_of')
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
      or v_edges_adopted > 0
      or v_edges_released > 0
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
        'adopted', v_edges_adopted,
        'unchanged', v_edges_unchanged,
        'released', v_edges_released,
        'deleted', v_edges_deleted
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
  with src as (
    select * from public.curriculum_sources where source_url = p_source_url
  ),
  declared as (
    select f.code as from_code, t.code as to_code, e.relation,
           f.source_id as from_source, t.source_id as to_source,
           f.node_type as from_type, t.node_type as to_type
    from public.curriculum_edge_declarations e
    join src on src.id = e.source_id
    join public.curriculum_nodes f on f.id = e.from_node_id and f.active
    join public.curriculum_nodes t on t.id = e.to_node_id and t.active
  )
  -- { package, externalNodes }: the package is exactly what this source
  -- declares; externalNodes gives the type of every endpoint owned by another
  -- source so the export can be validated without extra context.
  select jsonb_build_object(
    'package', jsonb_build_object(
      'formatVersion', 1,
      'source', jsonb_build_object(
        'subjectCode', src.subject_code,
        'levelCode', src.level_code,
        'schoolYear', src.school_year,
        'title', src.title,
        'publisher', src.publisher,
        'officialReference', src.official_reference,
        'sourceUrl', src.source_url,
        'publishedOn', src.published_on
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
        where n.source_id = src.id and n.active
      ), '[]'::jsonb),
      'edges', coalesce((
        select jsonb_agg(
          jsonb_build_object('from', d.from_code, 'to', d.to_code, 'relation', d.relation)
          order by d.from_code collate "C", d.to_code collate "C", d.relation collate "C"
        )
        from declared d
      ), '[]'::jsonb)
    ),
    'externalNodes', coalesce((
      select jsonb_agg(jsonb_build_object('code', x.code, 'type', x.type) order by x.code collate "C")
      from (
        select from_code as code, from_type as type from declared, src where from_source <> src.id
        union
        select to_code, to_type from declared, src where to_source <> src.id
      ) x
    ), '[]'::jsonb)
  )
  from src;
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
