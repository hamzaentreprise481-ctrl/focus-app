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

## Why the deployed V1 is not usable yet

1. Nobody knows the teacher account's password (only its owner may choose it).
2. The live database stops at `20260925214642`. The V1 code needs the nine
   migrations `20260926120000` … `20260927100000`. Without them a teacher
   can sign in, but the pages say « La base de données n’est pas à jour ».

## The migrations are safe to apply (evidence)

- Additive only on existing data: new tables, functions, policies, nullable
  or defaulted columns. The only new constraints on non-empty tables are on
  `curriculum_nodes`; all 44 live rows satisfy them (checked on live).
- `tests/live-head-upgrade.test.ts`: a replica whose curriculum is the live
  one UUID for UUID and edge for edge (fingerprints measured on live) is
  upgraded through the nine migrations with no row lost, the 44 live nodes
  kept active, `supabase/staging/verify.sql` passing, and the teacher still
  reading class, students and assessments under RLS.
- Recovery: the migrations delete no application row. The Supabase CLI applies
  each file in its own transaction, so a failing file changes nothing; restore from the daily
  backup only if a later manual step went wrong.

Apply, in order, only with the owner's approval (`supabase db push` from a
linked checkout, or one `apply_migration` per file), then run
`supabase/staging/verify.sql` in the SQL editor and the Supabase advisors.

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
