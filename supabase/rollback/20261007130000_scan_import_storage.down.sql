drop policy if exists focus_scan_imports_insert on storage.objects;
drop policy if exists focus_scan_imports_select on storage.objects;
drop policy if exists focus_scan_imports_delete on storage.objects;

delete from storage.objects where bucket_id = 'focus-scan-imports';
delete from storage.buckets where id = 'focus-scan-imports';
