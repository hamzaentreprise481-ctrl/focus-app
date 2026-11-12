-- Which migration a database has reached, so a Preview can prove that its
-- database carries the schema its code needs (/api/health, Preview only).
--
-- SECURITY DEFINER to read supabase_migrations, which API roles cannot read.
-- It returns one version string and nothing else; it is the only definer
-- function anon may execute (allow-listed in tests/security-lint.test.ts).

create or replace function public.focus_schema_version()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_version text;
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    return null;
  end if;
  execute 'select max(version)::text from supabase_migrations.schema_migrations' into v_version;
  return v_version;
end;
$$;

revoke all on function public.focus_schema_version() from public;
grant execute on function public.focus_schema_version() to anon, authenticated, service_role;
