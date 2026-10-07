-- FOCUS Scan V1 — private temporary storage for whole-class scanned PDFs.
-- Files are uploaded directly from the browser with a short-lived signed token,
-- processed by the authenticated teacher session, then deleted.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'focus-scan-imports',
  'focus-scan-imports',
  false,
  52428800,
  array['application/pdf']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists focus_scan_imports_insert on storage.objects;
create policy focus_scan_imports_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'focus-scan-imports'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists focus_scan_imports_select on storage.objects;
create policy focus_scan_imports_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'focus-scan-imports'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists focus_scan_imports_delete on storage.objects;
create policy focus_scan_imports_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'focus-scan-imports'
    and split_part(name, '/', 1) = auth.uid()::text
  );
