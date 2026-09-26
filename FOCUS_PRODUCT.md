# FOCUS — product contract for future coding sessions

Read this file together with AGENTS.md before changing the product. This contract supersedes the earlier prototype positioning and the initial dashboard recommendation in PR #1's audit.

## Purpose and positioning

FOCUS is a complementary pedagogical workspace. It helps teachers understand learning progression, make persistent difficulties more visible, interpret explicitly recorded competencies, choose an intervention, and eventually measure its effect. Teacher judgment remains final.

Public positioning: “FOCUS complète les outils de vie scolaire en donnant aux enseignants une lecture pédagogique plus fine de la progression de leurs élèves.”

PRONOTE, ÉcoleDirecte and ENT tools keep timetable, attendance, discipline, administrative communication, official grades and school administration. Do not disparage them or claim FOCUS replaces them. No automatic integration with those products is implemented here.

## Three distinct applications

1. **FOCUS Teacher** — THIS repository (`hamzaentreprise481-ctrl/focus-app`).
2. **FOCUS Student** — future separate application/project.
3. **FOCUS Parent** — future separate application/project.

The public site can explain the ecosystem. This repository must only provide teacher access. Do not add a role picker, student login, parent login, or student/parent workspace. Domain types may evolve to allow secure interoperability later; do not invent that backend now.

## Public and authenticated architecture

- Root layout: fonts, document metadata, global CSS only; never an application data provider.
- `app/(marketing)/`: public `/`, institutional presentation, independent navigation. It imports ONLY the dedicated immutable `lib/demo/marketing-data.ts` fixture for its preview. That fixture has no imports. Public pages must not depend, even transitively, on application data loaders, `lib/analysis` or teacher components (tested).
- `app/(auth)/`: `/connexion`, teacher login, server actions; no student data.
- `app/(teacher)/app/`: private `/app`, `/app/classes`, `/app/eleves`, `/app/evaluations`, `/app/parametres`. Dynamic rendering. Each page calls `requireTeacher()` before rendering its existing client view. The layout also checks the teacher and provides shell/context. Future data readers, route handlers and mutations must independently authorize the user and the requested resource.
- `proxy.ts`: checks every `/app` request, refreshes Auth cookies, denies unauthenticated/non-teacher access and applies private/no-store responses. It is not the only authorization layer.
- Legacy `/classes/*`, `/eleves/*`, `/evaluations/*`, `/parametres/*` redirect to `/app/...`; `/decouvrir` redirects to `/`.
- No pathname-based public/private shell exception. Sidebar pathname use is only for the active navigation item.

## Authentication and current limits

Supabase Auth is the authentication provider. Server actions perform password login and logout. Server-verified `getUser()` obtains current administrator-managed `app_metadata.role === "teacher"`; a user-editable metadata field must NEVER authorize access. Anonymous users and all other roles are rejected. `user_metadata.display_name` is display-only.

Session cookies are HttpOnly, SameSite=Lax and Secure on HTTPS/Vercel. Redirect destinations are restricted to `/app` paths. Missing configuration denies access; there is no public bypass, demo password or mock identity in application code. No service role key is used by the app. Provisioning is administrator-only; self-registration and password recovery screens are not implemented.

See README.md and `.env.example` for external setup. Real Supabase credentials and teacher provisioning are still required. Protocol-level tests use a separate loopback Auth double; they do not certify an actual Supabase project's setup.

## Teacher UX

The home experience follows: arrive → understand the current workspace → choose an action → optionally deepen the analysis.

- Calm greeting and class/subject context first.
- Three clear actions: open class, add evaluation, consult students.
- "À traiter" second, only for mathematics assessments of the class: hypotheses awaiting the teacher's decision first, then copies awaiting analysis, then missing subjects and copies; each row links to the exact place. Nothing is shown when nothing is tracked.
- Recent evaluations third, without dominant raw grades or alert totals.
- Pedagogical insights last, inside a collapsed, keyboard-accessible “À consulter quand vous êtes prêt” disclosure.
- Avoid alarming first screens, labels that judge students, red as the default priority cue, excessive cards and competing calls to action.
- Keep navigation text visible on tablet and mobile. Marketing links do not belong in operational navigation.
- One clear purpose per page; empty states should explain the next useful action.
- Preserve keyboard focus, form labels, button types, aria-pressed, aria-current and table header scopes. Tables scroll horizontally AND vertically inside bounded, keyboard-focusable regions; check sticky headers in the browser, not just the CSS source.

## Analytical safeguards

Keep the existing transparent analysis in `lib/analysis.ts`:

- Never use “score < 10 means difficulty” as an automatic universal rule.
- Never silently infer competency mastery from the overall grade. Missing explicit observations mean insufficient data.
- Keep confidence based on both sample size and consistency. More observations do not guarantee certainty.
- Preserve distinct patterns: persistent competency difficulty, consistent decline, isolated low result, recent improvement, irregular results, important missed evaluation.
- Preserve cautious explanations and the teacher's final decision. Do not claim validated dropout prediction.
- Competencies can be entered without a grade. The grade-to-competency shortcut was removed: observations must be entered explicitly. Blank, zero, absent and competency-only results are distinct.
- Do not alter analysis thresholds or interpretation rules as part of cosmetic changes without explicit approval and regression tests.

## Terminology

Prefer “Évolution”, “Point à travailler”, “Fiabilité du signal”, “Signal à confirmer”, “Signal fiable”, and “Basé sur N évaluations”. Avoid “Trajectoire”, “Signal de compétence”, “Niveau de preuve” in ordinary teacher tables. Technical identifiers may retain their precise internal meaning.

## Data/privacy truth

The teacher app reads and writes only Supabase, with the teacher's cookie session, under RLS. There is no demonstration dataset, browser storage or fallback in the teacher app: when a read fails, the page says so. The only fictitious data are the public preview fixture (`lib/demo/marketing-data.ts`) and test fixtures (`tests/fixtures/`).

Establishment isolation is enforced by RLS and by the `focus_*` write functions (teacher assignment, class, subject and enrollment checks); `anon` has no privilege on application tables. The live project holds only fictitious records so far. Do not enter real student data until the owner has settled hosting, retention/deletion, the processing register and impact assessment with the school. No GDPR certification or completed audit is claimed.

The public preview is isolated by construction and a transitive import test. Never replace its fixture with application data or re-use a teacher view as public preview.

## Evidence and pedagogical AI contract

The flow is: assessment → subject, questions, correction, rubric, assessed notions (shared) → each student's exact answer, points, annotation → analysis → teacher decision → student file.

- The model sees the exact answers and the correction, the notions tagged on each question, and only the class's programme with its catalogue of typical errors. It returns a strict JSON schema.
- FOCUS keeps a finding only if its excerpt appears literally in the answer (meaningful length), its notion is an in-scope notion related to the question's assessed notions (part_of either way or prerequisite, checked identically in TypeScript and SQL), the teacher did not give full marks, the answer is not the correction, and the wording is neither overstated nor non-pedagogical. A typical-error code is kept only for the same notion. Rejected candidates are counted, never shown as findings. Do not relax these rules to make model output pass.
- Confidence (`limitee`, `moderee`, `forte`) is computed by the database from the student's history (repeated, and already confirmed by the teacher); the model's own confidence is ignored.
- AI tables are written only by audited SECURITY DEFINER functions; teachers cannot insert or edit AI output. Editing a copy, a question or its notions supersedes the analysis; superseded hypotheses are frozen in the history.
- Every hypothesis waits for the teacher: confirm or dismiss, with an optional note, revisable while current. Only confirmed observations appear in the student PDF; pending ones are counted.
- "No error observed" is never presented as mastery; insufficient evidence is reported as such.

## Features and claims

Implemented: teacher login, dashboard work queue, classes and students, evaluations with grades/competencies, subject/questions/correction/notions, copy entry, AI analysis of mathematics copies with teacher review, longitudinal student follow-up (hypotheses, confirmed observations, notion timelines, history), PDF exports, curriculum importer and catalogue. Not implemented: invitations/password recovery, school-tool synchronization, measuring intervention outcomes, Student/Parent apps. The live model has never been exercised from this repository's environment; only scripted stand-ins have — never report those as real model tests.

The demonstration CTA uses an optional verified HTTPS `FOCUS_DEMO_REQUEST_URL`. Without it, explain that requests are not open and link to the public preview. Never invent an email address, collect leads without a configured recipient, or claim a request was sent when it was not.

## Curriculum knowledge base

The official curriculum graph is changed only through packages in `curriculum/` and `npm run curriculum` (validate → generated migration or dry-run-first import). `public.focus_import_curriculum` is service_role only, idempotent, never deletes nodes (it deactivates them) and refuses mass deactivation, node takeover across sources, retyping referenced nodes, duplicate or conflicting relationships and cycles. Store short FOCUS-written labels and source locators only — never programme or textbook text. The pedagogical AI reads the graph through `public.focus_curriculum_graph`, scoped to the class level; only in-scope notions can carry a recommendation. See curriculum/README.md.

## Changes requiring explicit approval

Do not, without explicit approval:

- Rebuild this application, create another repository, or introduce Student/Parent apps here.
- Replace the three-app architecture or complementary positioning.
- Add public student-data access or weaken route protection.
- Claim prediction, autonomous decisions, compliance, tenant isolation, live integrations or features unsupported by implementation/evidence.
- Introduce real student data into the public fixture or test fixtures.
- Change analytical safeguards/thresholds under a design task.
- Merge into `main`, promote to production or apply migrations to the live project: the owner decides, after the migrations, real authentication and the real model have been verified on a Preview.
- Access, inspect or modify the unrelated Metrik project. It is outside this project's scope.

Work on a branch, never on `main`; never merge into `main` without the owner. Re-read current PR comments, confirm the remote head before pushing, and never overwrite another agent's work. Apply database migrations to a Supabase branch or copy before the live project. Report commands actually run, exact commit, Preview URL, and remaining limitations honestly.
