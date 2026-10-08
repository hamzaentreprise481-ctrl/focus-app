-- Trigger-only functions must not be callable through the REST RPC API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
alter function public.set_updated_at() set search_path = public, pg_temp;
