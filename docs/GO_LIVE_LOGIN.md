# Real teacher login on the deployed V1 — state and remaining steps

State measured on 27 September 2026 on Supabase project `wznqeofsvbutbvbyxfab`
and Vercel project `focus-app-nhkt` (read-only unless stated).

## What is already true

- **Supabase Auth**: one account carries `app_metadata.role = "teacher"`
  (the owner's address). It is confirmed, not banned, has a bcrypt password
  and one identity, and has never signed in. The former demo address
  `prof@focus.fr` has no account: `/token` answers `invalid_credentials`,
  which the login page reports as « Connexion impossible ».
- **Linkage**: that account has a profile, a `teacher` school membership and
  one class/subject assignment. Simulated under RLS on the live database
  (rolled back): 1 class, 31 enrolments, 5 assessments visible; anonymous: 0.
- **Vercel**: `focus-app-nhkt` is the canonical project (production domain
  `focus-app-nhkt.vercel.app`, Supabase URL and publishable key set for every
  environment). The duplicate `focus-app` project has no variables; its
  automatic builds are now skipped (ignored build step, reversible in
  Project Settings → Git).
- **App**: no browser Supabase client; login, session refresh (proxy), role
  check (`getUser()` + `app_metadata`), pages and logout run server-side with
  HttpOnly, SameSite=Lax, Secure cookies. Tested end to end against the
  Supabase stand-in (`tests/integration/deployed-login-check.test.ts`).

## Migration status: applied to the live project on 27 September 2026

Applied with the owner's explicit approval, in order, after the rehearsal
below. For each file the migration history stores the exact file text:
`md5(statements[1])` equals the repository file's md5 for all nine versions,
recorded under their repository versions (the MCP tool assigns its own
timestamps; they were repaired to the repository versions right after each
apply, like `supabase migration repair`).

- `20260926120000`: the MCP transport decoded the `\uXXXX` escapes of one
  regular expression in `focus_curriculum_text` into the literal characters
  (same behaviour); the function was recreated with the escaped source and
  the stored text corrected, so both now match the file byte for byte.
- `20260926170000` (181 KB): staged in seven chunks in a temporary private
  schema, each chunk and the reassembled file checked by md5 against the
  repository, executed and recorded in one transaction, schema dropped.
- Import reports: graph package hash `69e7d220…` (the file header), 55 nodes
  inserted, 44 updated, 0 deactivated, 99 active, 330 relationships;
  catalogue 272 objectives, 99 typical errors, 99 remediations, 99 links,
  0 deactivated.
- After: every pre-existing table has the same row count; `focus_schema_version()`
  = `20260927100000`; `supabase/staging/verify.sql` passes on live; the
  teacher (simulated session, rolled back) reads 1 profile, 1 class,
  31 enrolments, 5 assessments, a 5-item work queue and the 99-node graph;
  anonymous is refused before RLS. Advisors: only the documented,
  intentional findings (authenticated-callable definer functions, the
  anon-callable `focus_schema_version`, two audit tables without policies)
  and leaked-password protection (an Auth dashboard setting).

## Remaining before a real login

Nobody knows the teacher account's password; only its owner may choose it.

## The migrations were safe to apply (evidence gathered before)

- Additive only on existing data: new tables, functions, policies, nullable
  or defaulted columns. The only new constraints on non-empty tables are on
  `curriculum_nodes`; all 44 live rows satisfied them (checked on live).
- `tests/live-head-upgrade.test.ts`: a replica whose curriculum is the live
  one UUID for UUID and edge for edge (fingerprints measured on live) is
  upgraded through the nine migrations with no row lost, the 44 live nodes
  kept active, `supabase/staging/verify.sql` passing, and the teacher still
  reading class, students and assessments under RLS.
- Recovery: the migrations delete no application row; restore from the
  daily backup if ever needed.

## Final check

From a machine that can reach Supabase and the deployment:

```bash
FOCUS_CHECK_EMAIL=<teacher e-mail> FOCUS_CHECK_PASSWORD=<password> \
FOCUS_CHECK_SUPABASE_URL=https://wznqeofsvbutbvbyxfab.supabase.co \
FOCUS_CHECK_SUPABASE_KEY=<publishable key> \
FOCUS_CHECK_APP_URL=https://<focus-app-nhkt deployment> \
VERCEL_AUTOMATION_BYPASS_SECRET=<if the deployment is protected> \
npm run check:login -- --project-ref wznqeofsvbutbvbyxfab
```

Every line must read PASS: Supabase login, verified session, teacher role,
profile, membership, assignments, RLS reads, schema version, refresh, logout,
anonymous denial; then on the deployment: login form, HttpOnly cookie, teacher
home, reload, class/students/assessments pages, logout, anonymous redirect.
