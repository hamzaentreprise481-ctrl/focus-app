-- Per-object fingerprint of the public schema (plus the auth.users trigger),
-- used to check that the repository migrations reproduce a live project.
-- Read-only. Same output on any PostgreSQL 17 database.
with objects as (
  select 'function ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as object,
         md5(pg_get_functiondef(p.oid) || '|' || coalesce(p.proacl::text, 'default')) as hash
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind in ('f', 'p')
    and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  union all
  select 'table ' || c.relname,
         md5(concat_ws('|',
           c.relrowsecurity, c.relforcerowsecurity, coalesce(c.relacl::text, 'default'),
           (select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull
                              || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), ''), ',' order by a.attnum)
              from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
             where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped),
           (select string_agg(conname || ':' || pg_get_constraintdef(oid), ',' order by conname)
              from pg_constraint where conrelid = c.oid and contype <> 'n'),
           (select string_agg(pg_get_indexdef(indexrelid), ',' order by pg_get_indexdef(indexrelid))
              from pg_index where indrelid = c.oid),
           (select string_agg(tgname || ':' || pg_get_triggerdef(t.oid), ',' order by tgname)
              from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal)))
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')
  union all
  select 'policy ' || tablename || '.' || policyname,
         md5(concat_ws('|', permissive, roles::text, cmd, qual, with_check))
  from pg_policies where schemaname = 'public'
  union all
  select 'type ' || t.typname,
         md5(coalesce((select string_agg(enumlabel, ',' order by enumsortorder) from pg_enum e where e.enumtypid = t.oid), ''))
  from pg_type t join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public' and t.typtype = 'e'
  union all
  select 'auth trigger ' || tgname, md5(pg_get_triggerdef(t.oid))
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'auth' and c.relname = 'users' and not t.tgisinternal
)
select object, hash from objects order by object;
