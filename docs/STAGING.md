# Staging — rehearse the migrations on a real Supabase database

> **2 October 2026.** The nine migrations below are now applied on the live
> project (schema identical to the repository, `tests/schema-live.test.ts`).
> The same procedure applies to the next pending migration,
> `20261002120000_access_integrity_hardening`: dump live, restore, mark every
> version up to `20260927100000` as applied, `supabase db push`, then run
> `supabase/staging/verify.sql` (it now expects `20261002120000`).

The nine migrations after the live head (`20260926120000` → `20260927100000`)
have only run on PostgreSQL in PGlite. Before the live project, they must run
on a **real Supabase database that holds a copy of the live data**, because the
key check — the 44 curriculum UUIDs stay the same — is only meaningful on live
identifiers. Nothing here touches the live project except read-only dumps.

## 0. What the owner decides

- **Where staging lives.** Either a Supabase branch (branching needs a paid
  plan) or a second project in the same organization (free plan allows two
  active projects). Creating either is the owner's decision; nothing is
  created automatically.
- **Who holds the credentials.** The database URL and keys of staging stay in
  the owner's shell or the session's environment secrets, never in git.

## 1. Copy live into staging (read-only on live)

```bash
# Read-only dump of the live project (it holds fictitious data only).
supabase link --project-ref wznqeofsvbutbvbyxfab
supabase db dump -f live-schema.sql                       # public schema
supabase db dump --data-only -f live-data.sql             # public data
supabase db dump --data-only --schema auth -f live-auth.sql   # fictitious users (FK targets)
supabase migration list                                   # must end at 20260925214642

# Restore into staging.
supabase link --project-ref <staging-ref>
psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -f live-schema.sql
psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -f live-auth.sql
psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -f live-data.sql
# Record the live history so `db push` applies only the new migrations.
supabase migration repair --status applied 20260910164313 20260910164329 20260910164413 \
  20260910164423 20260924210828 20260925180351 20260925193842 20260925194056 20260925194125 \
  20260925194715 20260925212527 20260925213001 20260925213931 20260925214407 20260925214642
```

With a paid plan, "Restore to a new project" from a live backup replaces
these steps.

Check the copy before migrating: in the staging SQL editor,
`select count(*) from public.curriculum_nodes` returns 44, and
`select md5(string_agg(code || ':' || id::text, ',' order by code collate "C")) from public.curriculum_nodes`
returns `ce217d6976dbfcbf2f714e3143cea930` (the live fingerprint).

## 2. Apply the migrations, in order

```bash
supabase link --project-ref <staging-ref>
supabase db push --dry-run     # lists exactly the nine new migrations
supabase db push
supabase migration list        # now ends at 20260927100000
```

## 3. Verify

1. **Schema, curriculum, catalogue, grants:** run
   `supabase/staging/verify.sql` in the staging SQL editor (or
   `psql "$STAGING_DB_URL" -f supabase/staging/verify.sql`). It must print
   `FOCUS staging verification: OK`. It checks the schema version, the 44 live
   UUIDs, 99 active nodes, 330 relationships, 272 objectives, 99 typical
   errors, 99 remediations, RLS on every table, nothing granted to anon, the
   one definer function anon may run, no per-row `auth.uid()` policy, and the
   functions the app calls. The same script is tested on a replica
   (`tests/staging-verify.test.ts`), including that it fails when a UUID,
   migration, count or grant is wrong.
2. **Advisors:** Dashboard → Advisors (security and performance). Expected:
   the six RLS helpers are still executable by `authenticated` (required by
   the policies), `focus_schema_version` by `anon` (version string only),
   and — until enabled in Auth settings — leaked-password protection. No
   other security finding; no `auth_rls_initplan` or unindexed-FK finding.
3. **Idempotency:** `supabase db push` again reports nothing to apply. Running
   the two data migrations' SQL again (`…160000…`, `…170000…`) changes
   nothing (their import functions are no-ops on identical content).
4. **Isolation on the real stack:** create `teacher-a@example.test` and
   `teacher-b@example.test` in Authentication (auto-confirm), run
   `supabase/staging/seed-fictitious.sql` in the SQL editor (staging only),
   then:

   ```bash
   FOCUS_CHECK_SUPABASE_URL=https://<staging-ref>.supabase.co \
   FOCUS_CHECK_SUPABASE_KEY=<staging publishable key> \
   FOCUS_CHECK_TEACHER_A_EMAIL=teacher-a@example.test FOCUS_CHECK_TEACHER_A_PASSWORD=… \
   FOCUS_CHECK_TEACHER_B_EMAIL=teacher-b@example.test FOCUS_CHECK_TEACHER_B_PASSWORD=… \
   node --import tsx scripts/staging-rls-check.ts --write
   ```

   Every line must be `PASS` (anon refused, each teacher sees only their
   class, B cannot write A's copies or record an analysis, AI tables not
   writable directly). The script was validated against the local stack.
5. **Preview on staging:** point a Preview's `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` at staging, redeploy, and check the
   "FOCUS Preview verified" status (schema up to date), then walk the teacher
   flow with `teacher-a@example.test`.

## 4. Recovery

The migrations have no down scripts. Before the live project:

- take a backup (Dashboard → Database → Backups, or `supabase db dump` of
  schema, data and auth as in step 1) and keep it until the new version is
  accepted;
- the destructive steps are: `…150000` drops the old
  `focus_save_pedagogical_evidence` RPC and the AI-table write policies, and
  replaces `focus_save_assessment` (new signature); `…190000` revokes anon's
  table grants and rewrites policies to `(select auth.uid())`. Data is only
  added or backfilled (recommendation/observation decision columns, edge
  ownership, 55 nodes, catalogue rows); no row is deleted;
- recovery is a restore of that backup. Rehearse it once on staging:
  restore the step-1 dump into a fresh schema and re-run `verify.sql`
  expecting the pre-migration state to fail at step 1 (schema version).

The application must be deployed **after** the migrations: this code refuses
to run on the old schema (it reports "La base de données n’est pas à jour").
