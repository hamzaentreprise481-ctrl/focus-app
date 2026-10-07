drop function if exists public.focus_import_scanned_copy(uuid, uuid, jsonb, numeric, boolean);

-- The Storage bucket is an environment resource provisioned through the
-- Storage API, not migration-owned metadata. Rollback only removes the RLS
-- policies introduced by this migration; it never deletes uploaded objects.
do $storage$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;
  execute 'drop policy if exists focus_scan_imports_insert on storage.objects';
  execute 'drop policy if exists focus_scan_imports_select on storage.objects';
  execute 'drop policy if exists focus_scan_imports_delete on storage.objects';
end
$storage$;
