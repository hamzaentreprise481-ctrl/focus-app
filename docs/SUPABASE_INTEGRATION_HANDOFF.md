# V1 Supabase integration — 25 September 2026

Branch: `codex/focus-live-supabase-20260925`, based on `codex/focus-v1-supabase-20260925`.

## Implemented

- Existing PR #1 authentication is reused unchanged.
- Supabase project `wznqeofsvbutbvbyxfab` is readable again. The verified schema contains the existing school/class/subject/enrollment/assessment/competency tables with RLS.
- Teacher pages now load authorized classes, students, competencies, assessments, results and competency results through the cookie-bound Supabase SSR client. There is no fallback to the fictitious browser dataset when server reads fail.
- `SchoolDataProvider` now mounts a Supabase-backed adapter in the authenticated teacher shell.
- Evaluation creation/editing persists through `public.focus_save_assessment`, migration `20260925180351`. The function is `SECURITY INVOKER`, executable by `authenticated` but not `anon`, and validates teacher assignment, class/subject scope, student enrollment and selected competencies.
- Evaluation writes are transactional: assessment metadata, competency links, per-student score/absence rows and competency results are replaced together.
- Existing demo/localStorage adapter remains only for isolated demo/component use; it is no longer the authenticated app data source.
- Existing PDF export and analysis consume the live dataset without sending academic data to an external export service.

## Verified backend state

- 1 school, 1 class, 31 student enrollments, 4 subjects, 8 competencies and 5 assessments exist.
- The role-authorized teacher account has a teacher membership and a Mathématiques assignment to Seconde 3.
- Seeded assessments currently have no `assessment_results` or `competency_results`; the live app therefore shows the real empty-result state until a teacher records results.
- Existing seeded assessments are owned by another teacher record, so the role-authorized teacher may view them through class RLS but cannot edit them. New assessments created by the signed-in teacher are editable by that teacher.

## Security notes

Supabase Security Advisor still reports pre-existing warnings for six public `SECURITY DEFINER` authorization helper functions and leaked-password protection being disabled. The new save RPC is not one of those functions: it is `SECURITY INVOKER` and its anonymous execute privilege is revoked.

Performance Advisor also reports pre-existing missing FK indexes / RLS init-plan opportunities. They are not required to make the V1 flow correct, but should be addressed before scale testing.

## Remaining gates

1. GitHub CI must pass typecheck, lint, unit/component tests, production build and route tests on this branch.
2. Real browser QA still needs a known teacher password: login → dashboard → class → create assessment → reload → edit/clear results → reload → student profile/PDF → logout.
3. Vercel connector access is still unavailable in this session (no accessible team returned), so Preview/Production environment scopes and live deployment cannot yet be verified from the connector.
4. The database has no persisted `important` flag on assessments; live assessments currently map that analytical field to `false`. Add a real column/UI before relying on the “séquence charnière” analysis with server data.
5. Do not merge to `main` or promote production until CI and real authenticated browser persistence are both verified.
