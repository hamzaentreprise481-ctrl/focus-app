-- FOCUS — STAGING ONLY. Run on the staging database right after the live
-- backup has been restored into it (supabase/staging/RUNBOOK.md, step 4).
--
-- The live project holds 35 Auth accounts with real-looking addresses and
-- password hashes. Staging keeps every account and every UUID (so every
-- membership, enrollment, assignment and assessment still points to the same
-- person) but no address, no password, no phone, no session and no audit
-- trail of the live project:
--   * email          -> compte-<user id>@staging.focus.invalid (unique)
--   * password, phone, every pending token -> cleared
--   * identities     -> the same new address in identity_data
--   * sessions, refresh tokens, one-time tokens, MFA, audit log -> deleted
-- Names in raw_user_meta_data and public.profiles are kept: the live data is
-- fictitious (FOCUS_PRODUCT.md, "Data/privacy truth").
--
-- Safety: it refuses to run unless focus_private.environment says 'staging'
-- (created by RUNBOOK.md step 4 on the staging database, never on live). It
-- is one transaction: either everything is anonymised or nothing changes.

begin;

do $$
begin
  if to_regclass('focus_private.environment') is null then
    raise exception 'not a FOCUS staging database (focus_private.environment): nothing changed';
  end if;
  if not exists (select 1 from focus_private.environment where name = 'staging') then
    raise exception 'not a FOCUS staging database (focus_private.environment): nothing changed';
  end if;
end
$$;

update auth.users set
  email = 'compte-' || id::text || '@staging.focus.invalid',
  encrypted_password = null,
  phone = null,
  phone_change = '',
  phone_change_token = '',
  email_change = '',
  email_change_token_new = '',
  email_change_token_current = '',
  confirmation_token = '',
  recovery_token = '',
  reauthentication_token = '';

update auth.identities i set
  identity_data = i.identity_data || jsonb_build_object('email', u.email, 'email_verified', true)
from auth.users u
where u.id = i.user_id and i.provider = 'email';

delete from auth.sessions;
delete from auth.refresh_tokens;
delete from auth.one_time_tokens;
delete from auth.mfa_amr_claims;
delete from auth.mfa_challenges;
delete from auth.mfa_factors;
delete from auth.flow_state;
delete from auth.audit_log_entries;

-- Nothing of the live address book may remain.
do $$
begin
  if exists (select 1 from auth.users where email not like '%@staging.focus.invalid' or encrypted_password is not null) then
    raise exception 'anonymisation incomplete: rolled back';
  end if;
end
$$;

commit;
