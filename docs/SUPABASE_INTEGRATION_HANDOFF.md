# V1 continuation — 25 September 2026

Branch: `codex/focus-v1-supabase-20260925`, based on PR #1 commit `8368421a959eb787d69efb413d845471a09712e4`.

## Implemented

- The existing PR authentication is reused without changes.
- `EvaluationDataset` now carries classes, students, skills, evaluations and raw grades. Analysis has no fixture imports or implicit default dataset. Teacher views consume `SchoolDataProvider`; only `DemoDataProvider` knows the browser storage/fixture implementation.
- Dashboard supports selecting a class when the supplied dataset contains several. Class links preselect evaluation entry. Rosters, profiles and analyses resolve the supplied identities. A blank workspace stays blank; failed loading is not presented as valid results.
- Evaluation saving is asynchronous. Pending writes lock controls and repeated submissions. Failed saves retain fields and retry the same ID. Editing can remove the last incorrect observation.
- Class, student and evaluation PDF exports use the currently loaded snapshot, have pagination and an embedded locally hosted font. Demo exports are marked fictitious. No academic data is sent to an export service.

## Actual limitation

**The application still mounts `DemoDataProvider` and still saves evaluations to localStorage. No Supabase academic-data reader or writer has been implemented.** The generic provider and async save signature are integration prerequisites, not an active Supabase adapter.

The owner reports Claude restored project `wznqeofsvbutbvbyxfab`, linked the teacher to demo data, and verified the schema/RLS. This session cannot read it: `list_tables` and a read-only `information_schema.columns` query both returned `You do not have permission to perform this action`. Vercel `get_project` for `focus-app-nhkt` returned `403 Forbidden`. This does not contradict Claude's observations: permissions differ between sessions/connectors.

No migrations, RLS, teacher accounts, production records, environment settings or production deployments were changed. No schema/table/RPC names have been guessed.

## Concrete continuation when access works

1. Obtain actual generated database types or a schema-only export for this project (columns, foreign keys, enum values and relevant existing RPC signatures). Do not provide service-role keys or real student rows.
2. Implement the adapter with the existing cookie-bound `createAuthClient()` and `requireTeacher()`. Fetch only classes/subjects available to that teacher; map actual relations into `EvaluationDataset`. Keep queries scoped and page through records beyond the API page limit. Never use a service-role client or fall back to fixtures on failure.
3. Implement authenticated saves against the verified schema. Validate evaluation/class/subject ownership and student membership server-side; distinguish absent, zero, blank and explicit skills. A save must atomically replace the selected evaluation's results, including clearing removed observations, and report success only after confirmed persistence. Reuse an existing transactional RPC if present. If the current backend has no safe transactional write surface, document the exact proposed migration for coordination with Claude before applying it. Add conflict detection for concurrent edits.
4. Mount the Supabase-backed provider only after read/write checks succeed. Update demo-specific copy. Do not automatically migrate localStorage into the server.
5. Test on the existing synthetic teacher dataset: login → dashboard → class → student → create evaluation → reload → edit/clear results → reload → verify analyses and PDF; verify rejection for a different teacher/class and persistence from a second session. Then review deployment gates for PR #1 and this continuation.

## Verification boundaries

Typecheck, ESLint, unit/component tests and production build are run locally. Route tests use an isolated loopback Auth double, and component save tests use controlled promises: they do not establish real Supabase persistence. PDF samples are rendered with Poppler for layout/text inspection. Live authenticated browser QA and real persistence remain unverified; do not merge or promote to production on these checks alone.
