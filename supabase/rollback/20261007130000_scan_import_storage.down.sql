drop function if exists public.focus_import_scanned_copy(uuid, uuid, jsonb, numeric);

do $storage$
begin
  if to_regclass('storage.objects') is null
     or to_regclass('storage.buckets') is null then
    return;
  end if;
  execute 'drop policy if exists focus_scan_imports_insert on storage.objects';
  execute 'drop policy if exists focus_scan_imports_select on storage.objects';
  execute 'drop policy if exists focus_scan_imports_delete on storage.objects';
  delete from storage.objects where bucket_id = 'focus-scan-imports';
  delete from storage.buckets where id = 'focus-scan-imports';
end
$storage$;
