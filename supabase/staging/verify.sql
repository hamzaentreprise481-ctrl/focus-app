-- FOCUS staging verification — run AFTER applying every migration, on the
-- staging database (SQL editor or psql). Read-only: it only selects, inside
-- one DO block that raises at the first failed check. Success prints
-- "FOCUS staging verification: OK".
--
-- Checks: schema version (20261007130000); the 44 curriculum UUIDs captured from live on
-- 2026-09-26 are unchanged; the Seconde graph (99 active nodes, 330
-- relationships) and its catalogue (272 objectives, 99 typical errors,
-- 99 remediations); RLS on every public table; nothing granted to anon;
-- the only definer function anon may run; no per-row auth.uid() policy;
-- the functions the application calls exist; AI output is recorded only
-- through the signed engine entry point, whose key is installed and
-- unreadable by the API roles.
--
-- Kept in sync with tests/fixtures/live-curriculum-ids.json by
-- tests/staging-verify.test.ts, which also runs it on a replica.

do $$
declare
  v_count integer;
  v_version text;
  v_missing text;
begin
  -- 1. Schema version (Supabase records each migration it applied).
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    select max(version) into v_version from supabase_migrations.schema_migrations;
    if v_version is distinct from '20261007130000' then
      raise exception 'schema version is %, expected 20261007130000', v_version;
    end if;
  end if;

  -- 2. The 44 identifiers that existed on live keep their UUIDs.
  select string_agg(live.code, ', ' order by live.code) into v_missing
  from (values
    ('MATH.ALG.CALCUL_LITTERAL_ELEMENTAIRE', '09ced102-5a95-43d6-863d-a261e4df64f5'::uuid),
    ('MATH.ALG.DISTRIBUTIVITE', 'd2f77844-1249-495a-bc0f-727aa86be55a'::uuid),
    ('MATH.ALG.EQUATIONS', '0266fe2c-c40f-40bc-8e23-47ef6fb483e1'::uuid),
    ('MATH.ALG.EQUATION_PREMIER_DEGRE', 'c3c8b3b7-b085-4791-933d-7aa931f1ab7b'::uuid),
    ('MATH.ALG.EXPRESSIONS', 'c55b9818-1129-4e3a-b345-3128f89c6c86'::uuid),
    ('MATH.ALG.EXPRESSIONS_FRACTIONNAIRES', 'faa8bf12-0eb5-4284-bcd1-9e92eec8d067'::uuid),
    ('MATH.ALG.FACTORISATION_SIMPLE', '1a400fa6-8187-4a3c-9c76-cbd4c337b524'::uuid),
    ('MATH.ALG.FORME_ADAPTEE', '458df1b6-427a-4ff0-bc15-2d13e5f1d143'::uuid),
    ('MATH.ALG.IDENTITES', '2dfc6464-b001-4c24-af2b-b23e7d1a5248'::uuid),
    ('MATH.ALG.INEQUATION_PREMIER_DEGRE', 'edc4a08e-b9d8-426c-8a08-9f63296b3f8a'::uuid),
    ('MATH.ALG.ISOLER_VARIABLE', '74e2c3d7-85b4-469b-b190-f48c4c5e0107'::uuid),
    ('MATH.ALG.MODELISER_EQUATION', 'a3ebde33-6f65-48ef-8493-7f03ea1d78cf'::uuid),
    ('MATH.COMP.CALCULER', '3525caaa-ae90-459c-932e-7a683db41200'::uuid),
    ('MATH.COMP.CHERCHER', 'd1e255ae-5483-4d2f-be66-e7382baf20cc'::uuid),
    ('MATH.COMP.COMMUNIQUER', 'e06d565b-e0cc-40b7-bf72-dce736483051'::uuid),
    ('MATH.COMP.MODELISER', '9bc9a417-7c1a-4391-95dd-3a62a2d2f6b5'::uuid),
    ('MATH.COMP.RAISONNER', '37f209e8-c887-4f3a-848d-09cc4a4a4572'::uuid),
    ('MATH.COMP.REPRESENTER', 'f7e4fb9a-ffd9-4b18-b43b-9fa4f72e19b6'::uuid),
    ('MATH.FONC.AFFINE', '96a77618-3c94-4904-b119-ac3ae6064ba6'::uuid),
    ('MATH.FONC.DOMAINE', '0f2ee854-8680-4d13-b22c-064b8010bc57'::uuid),
    ('MATH.FONC.EQUATIONS_GRAPHIQUES', '49fb9a2f-2df2-43f4-b8ab-95096e6b4044'::uuid),
    ('MATH.FONC.IMAGE_ANTECEDENT', 'd8711fd6-4b28-4304-8003-a7dff544f072'::uuid),
    ('MATH.FONC.NOTION', '9cbd5885-7a1e-44ca-9468-1532f2f4d79e'::uuid),
    ('MATH.FONC.REPRESENTATIONS', 'c053fd32-377e-4e43-aa08-e08db5efc606'::uuid),
    ('MATH.FONC.SIGNES', 'dda9b677-6c1e-4ca6-8795-c2f59c41161d'::uuid),
    ('MATH.FONC.TABLEAU_SIGNES', '33ef2220-7e22-49c1-a2e3-56b1a1d0a82f'::uuid),
    ('MATH.FONC.VARIATIONS', '8d319a1e-5663-4ba9-b2d2-f17bc4e0ceb5'::uuid),
    ('MATH.FONC.VARIATIONS_AFFINE', '75ef973d-c1ba-4a65-8aff-fa5748d602d0'::uuid),
    ('MATH.GEO.DROITES', '146fe6b1-e51d-4116-82e3-e84d326ac8ac'::uuid),
    ('MATH.GEO.VECTEURS', '523a8a21-f88c-4536-a04b-049a2e25fef0'::uuid),
    ('MATH.NUM.ARITHMETIQUE', 'a86155a0-32fa-4b57-990c-4a1727a49030'::uuid),
    ('MATH.NUM.FRACTIONS.IRREDUCTIBLE', '67f75118-74af-44ce-b1e1-9cc1c7df7c1e'::uuid),
    ('MATH.NUM.FRACTIONS.OPERATIONS', '59671f6c-4d13-4fad-b1a0-97ac6a28ec08'::uuid),
    ('MATH.NUM.INTERVALLES', '9990b242-87d9-4f8c-9ccc-db5b6785e5f6'::uuid),
    ('MATH.NUM.VALEUR_ABSOLUE', '5a9181ba-1283-4ce8-9470-09319ffb8fc3'::uuid),
    ('MATH.PREREQ.CYCLE4.DISTRIBUTIVITE', '3a8ad841-f22f-4a99-a1a8-38232be7101b'::uuid),
    ('MATH.PREREQ.CYCLE4.EQUATIONS', 'be8add9f-fbf8-44db-9e5b-350e30c67dc5'::uuid),
    ('MATH.PREREQ.CYCLE4.FONCTIONS', 'b4125a6e-09ea-4ac5-bd82-b7af872815ac'::uuid),
    ('MATH.PREREQ.CYCLE4.FRACTIONS', 'bf5b676f-36d4-4c14-8a9d-131756d34333'::uuid),
    ('MATH.PROBA.ARBRES', '9d6ab485-31a8-440d-a8ae-5ea747c73868'::uuid),
    ('MATH.PROBA.CONDITIONNELLE', '70ab592b-6693-404c-8d86-ed968dd56f1e'::uuid),
    ('MATH.STAT.DESCRIPTIVE', 'fda270af-1f9d-4e65-bcc6-f87c95eb2e7a'::uuid),
    ('MATH.STAT.FREQUENCE_CONDITIONNELLE', '07ca8a72-d863-4da7-9e4c-5540db298f65'::uuid),
    ('MATH.STAT.PROPORTIONS', '7135dcad-d283-4b4c-b7d9-47679ae6128c'::uuid)
  ) as live(code, id)
  left join public.curriculum_nodes n on n.id = live.id and n.code = live.code and n.active
  where n.id is null;
  if v_missing is not null then
    raise exception 'live curriculum identifiers changed or inactive: %', v_missing;
  end if;

  -- 3. The Seconde graph.
  select count(*) into v_count from public.curriculum_nodes n
  join public.curriculum_sources s on s.id = n.source_id
  where s.subject_code = 'MATH' and s.level_code = 'SECONDE_GT' and n.active;
  if v_count <> 99 then raise exception 'expected 99 active Seconde nodes, found %', v_count; end if;
  select count(*) into v_count from public.curriculum_edge_declarations d
  join public.curriculum_sources s on s.id = d.source_id
  where s.subject_code = 'MATH' and s.level_code = 'SECONDE_GT';
  if v_count <> 330 then raise exception 'expected 330 Seconde relationships, found %', v_count; end if;

  -- 4. The catalogue.
  select count(*) into v_count from public.curriculum_objectives where active;
  if v_count <> 272 then raise exception 'expected 272 objectives, found %', v_count; end if;
  select count(*) into v_count from public.curriculum_typical_errors where active;
  if v_count <> 99 then raise exception 'expected 99 typical errors, found %', v_count; end if;
  select count(*) into v_count from public.curriculum_remediations where active;
  if v_count <> 99 then raise exception 'expected 99 remediations, found %', v_count; end if;

  -- 5. RLS everywhere; nothing for anon.
  select string_agg(relname, ', ') into v_missing from pg_class
  where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity;
  if v_missing is not null then raise exception 'tables without RLS: %', v_missing; end if;
  select string_agg(distinct c.relname, ', ') into v_missing
  from pg_class c, unnest(array['select', 'insert', 'update', 'delete']) as privilege
  where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and has_table_privilege('anon', c.oid, privilege);
  if v_missing is not null then raise exception 'anon has privileges on: %', v_missing; end if;
  select string_agg(p.proname, ', ') into v_missing from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname <> 'focus_schema_version'
    and has_function_privilege('anon', p.oid, 'execute')
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');
  if v_missing is not null then raise exception 'definer functions executable by anon: %', v_missing; end if;
  select string_agg(tablename || '.' || policyname, ', ') into v_missing from pg_policies
  where schemaname = 'public' and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ '(?<!SELECT )auth\.uid\(\)';
  if v_missing is not null then raise exception 'policies evaluating auth.uid() per row: %', v_missing; end if;
  -- TRUNCATE ignores RLS: no API role may hold it.
  select string_agg(c.relname, ', ') into v_missing from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and has_table_privilege('authenticated', c.oid, 'truncate');
  if v_missing is not null then raise exception 'authenticated may truncate: %', v_missing; end if;
  -- AI output is read by the teachers of the class and subject, never through a student's own id.
  select string_agg(policyname, ', ') into v_missing from pg_policies
  where schemaname = 'public'
    and tablename in ('ai_analysis_runs', 'error_observations', 'pedagogical_recommendations', 'pedagogical_review_events')
    and cmd = 'SELECT' and (qual ~ 'student_id = \( SELECT auth\.uid\(\)' or qual !~ 'teaches_class_subject');
  if v_missing is not null then raise exception 'AI output readable beyond the class and subject teachers: %', v_missing; end if;

  -- 6. Functions the application calls.
  select string_agg(f, ', ') into v_missing from unnest(array[
    'focus_save_assessment', 'focus_save_assessment_questions', 'focus_save_student_responses',
    'focus_persist_pedagogical_analysis', 'focus_persist_no_evidence', 'focus_review_pedagogical_recommendation',
    'focus_teacher_work_queue', 'focus_curriculum_graph', 'focus_schema_version', 'focus_import_curriculum',
    'focus_import_curriculum_catalogue', 'focus_record_ai_usage', 'teaches_class_subject', 'focus_normalize_math_text',
    'focus_record_engine_analysis', 'focus_analysis_evidence_versions',
    'focus_import_scanned_copy'
  ]) as f
  where not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f);
  if v_missing is not null then raise exception 'missing functions: %', v_missing; end if;
  -- A recorded finding respects the teacher's grading (section 6 of 20261002120000).
  if pg_get_functiondef('public.focus_persist_pedagogical_analysis(uuid, uuid, uuid, text, text, jsonb, jsonb)'::regprocedure)
     !~ 'answer given full marks' then
    raise exception 'focus_persist_pedagogical_analysis does not refuse findings on full marks';
  end if;

  -- 7. Scan Storage: on a real Supabase environment, the admin setup
  -- command must have provisioned a private, PDF-only bucket and the migration
  -- must have installed the three owner/active-teacher policies.
  if to_regclass('storage.buckets') is not null
     and to_regclass('storage.objects') is not null then
    select count(*) into v_count
    from storage.buckets
    where id = 'focus-scan-imports'
      and public = false
      and file_size_limit = 50000000
      and allowed_mime_types = array['application/pdf']::text[];
    if v_count <> 1 then
      raise exception 'FOCUS Scan bucket missing or misconfigured: run npm run setup:scan-storage -- --commit';
    end if;

    select string_agg(required.name, ', ' order by required.name) into v_missing
    from (values
      ('focus_scan_imports_insert'),
      ('focus_scan_imports_select'),
      ('focus_scan_imports_delete')
    ) as required(name)
    where not exists (
      select 1
      from pg_policies p
      where p.schemaname = 'storage'
        and p.tablename = 'objects'
        and p.policyname = required.name
    );
    if v_missing is not null then
      raise exception 'FOCUS Scan storage policies missing: %', v_missing;
    end if;
  end if;

  -- 8. AI output only from the FOCUS engine (20261004090000).
  select string_agg(p.proname, ', ') into v_missing from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in ('focus_persist_pedagogical_analysis', 'focus_persist_no_evidence')
    and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'));
  if v_missing is not null then raise exception 'API roles may record AI output directly: %', v_missing; end if;
  if has_schema_privilege('authenticated', 'focus_private', 'usage') or has_schema_privilege('anon', 'focus_private', 'usage')
     or has_schema_privilege('service_role', 'focus_private', 'usage') then
    raise exception 'an API role can read the engine key schema focus_private';
  end if;
  if not exists (select 1 from focus_private.engine_keys) then
    raise exception 'engine signing key not installed: insert it into focus_private.engine_keys (docs/STAGING.md)';
  end if;

  raise notice 'FOCUS staging verification: OK';
end;
$$;

select 'FOCUS staging verification: OK' as result;
