# FOCUS — product contract for future coding sessions

Read this file together with AGENTS.md before changing the product. This contract supersedes the earlier prototype positioning and the initial dashboard recommendation in PR #1's audit.

## Purpose and positioning

FOCUS is a complementary pedagogical workspace. It helps teachers understand learning progression, make persistent difficulties more visible, interpret explicitly recorded competencies, choose an intervention, and eventually measure its effect. Teacher judgment remains final.

Public positioning: “FOCUS complète les outils de vie scolaire en donnant aux enseignants une lecture pédagogique plus fine de la progression de leurs élèves.”

PRONOTE, ÉcoleDirecte and ENT tools keep timetable, attendance, discipline, administrative communication, official grades and school administration. Do not disparage them or claim FOCUS replaces them. No automatic integration with those products is implemented here.

## Three spaces in this repository (owner decision, October 2026)

1. **FOCUS Teacher** — `/app`, role `teacher`.
2. **FOCUS Student** — `/student`, role `student`.
3. **FOCUS Direction** — `/director`, database role `admin` (the role every RLS policy already treats as the school's direction through `is_school_admin`; the `membership_role` enum is NOT changed for it).

**FOCUS Parent** remains a future separate project: no parent login or workspace here. The public home presents FOCUS briefly, then lets each person choose their space; every space has its own login, its own server guard and its own navigation, and none grants another (a teacher membership never opens Direction, a student never reaches `/app` or `/director`). Accounts are created by the school's administrator; there is no self-registration.

## Public and authenticated architecture

- Root layout: fonts, document metadata, global CSS only; never an application data provider.
- `app/(marketing)/`: public `/` (short presentation + one card per space: `/connexion`, `/connexion-eleve`, `/connexion-direction`), `/enseignants` (the detailed Teacher presentation), institutional pages, independent navigation. It imports ONLY the dedicated immutable `lib/demo/marketing-data.ts` fixture for its preview. That fixture has no imports. Public pages must not depend, even transitively, on application data loaders, `lib/analysis` or teacher components (tested).
- `app/(auth)/`: `/connexion` (teacher), `/connexion-eleve`, `/connexion-direction`, server actions; no student data. A new password (invitation or reset) opens the space of the account's active membership.
- `app/(student)/student/`: `/student`, `/student/evaluations[/id]`, `/student/progression`, `/student/assistant`, `/student/profil`; each page calls `requireStudent()`.
- `app/(director)/director/`: `/director`, `/director/classes[/id]`, `/director/professeurs`, `/director/programme`, `/director/alertes`, `/director/parametres`; each page and the layout call `requireDirector()`.
- `app/(teacher)/app/`: private `/app`, `/app/classes`, `/app/eleves`, `/app/evaluations`, `/app/parametres`. Dynamic rendering. Each page calls `requireTeacher()` before rendering its existing client view. The layout also checks the teacher and provides shell/context. Future data readers, route handlers and mutations must independently authorize the user and the requested resource.
- `proxy.ts`: checks every `/app`, `/student` and `/director` request against its own role, refreshes Auth cookies, denies unauthenticated/non-teacher access and applies private/no-store responses. It is not the only authorization layer.
- Legacy `/classes/*`, `/eleves/*`, `/evaluations/*`, `/parametres/*` redirect to `/app/...`. `/decouvrir` is a dedicated public marketing page.
- No pathname-based public/private shell exception. Sidebar pathname use is only for the active navigation item.

## Authentication and current limits

Supabase Auth is the authentication provider. Server actions perform password login and logout. Server-verified `getUser()` identifies the account, then `hasActiveTeacherMembership()` requires an active `school_memberships` row with `role = "teacher"`. Metadata is not an authorization source and a user-editable field must NEVER authorize access. Anonymous users and all other roles are rejected. `user_metadata.display_name` is display-only.

Session cookies are HttpOnly, SameSite=Lax and Secure on HTTPS/Vercel. Redirect destinations are restricted to `/app` paths. Missing configuration denies access; there is no public bypass, demo password or mock identity in application code. No service role key is used by the app. Provisioning is administrator-only (Supabase invitation via `scripts/admin-invite-teacher.ts`, active school membership and class/subject assignment); there is no self-registration. Forgotten-password and invitation links go through `/auth/confirm` (server-verified, single-use) to `/connexion/nouveau-mot-de-passe`; the reset request answers identically whether or not the address exists, and a non-teacher who sets a password still cannot enter. These flows are tested against the local Auth double, not yet with a real project's e-mail templates.

See README.md and `.env.example` for external setup. Real Supabase credentials and teacher provisioning are still required. Protocol-level tests use a separate loopback Auth double; they do not certify an actual Supabase project's setup.

## Student

Read-only for the student's own data under RLS: results, recorded answers, teacher comments and annotations, explicit competency levels, progression. Students never read questions, corrections or any AI output of the teacher pipeline (RLS since `20261002120000`); nothing unvalidated is shown — an automatic reading of a scanned copy the teacher has not checked is neither shown nor sent to the assistant, only counted. No Student code writes to the database (tested statically).

**Assistant FOCUS** (`/student/assistant`) is pedagogical help only: explain, question, train. Its context is built with the student's own session (own data, class programme notions) — never another student's data, teacher-only tables or the student's name. It never creates, changes or validates a grade, correction, competency or assessment; such requests get a deterministic refusal before any model call. Guided by default (no direct final answer); the full solution only on explicit request. The conversation history comes from the browser and is not authoritative: refused requests and the replies that followed them are dropped before the model call. Trust order: teacher-validated data, recorded results, official programme, then its own help; it quotes teacher comments verbatim and says when context is insufficient. Conversations are not stored. Model: `FOCUS_STUDENT_AI_MODEL` or the release model.

## Direction

Read-only aggregates of the director's own school (RLS `is_school_admin`, every query also filtered by school): no student list, no individual grade, and teachers get operational indicators only — never a ranking or a grade-based comparison. Programme progress keeps three dimensions apart and never presents them as mastery: **programme enseigné** (référentiel competencies linked to lessons declared by teachers), **programme évalué** (official programme notions present in past assessments, else référentiel competencies), **compétences documentées** (explicit levels entered). The delay risk is deterministic (`lib/director/metrics.ts`; on track / vigilance from 80 % of the needed pace / at risk; no pace before 3 weeks or without declarations — missing data is never shown as a delay). Teachers cannot declare lessons yet (writes on `lessons` are closed); the audited function is a proposal in `supabase/proposals/`, not applied. Figures cover the active school year only.

The Direction app never writes. The database does not enforce that yet: the base schema still lets the `admin` role write its school's official data (assessments, results, competency levels, answers, questions) and add a teacher membership and assignment for its own account. `supabase/proposals/20261010100000_direction_read_only_official_data.sql` closes both with restrictive policies (tested on both heads, teachers unaffected); it is NOT applied. Until it is, do not describe Direction as read-only at the database level, and give a demo direction a login only on request (`--with-direction-login`).

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
- Each student analysis keeps observation (`evidence`: dated scores and levels), interpretation (summary, narrative) and suggestions (each naming the observation it answers) apart, with a signal reliability from sample size and consistency (`confidence`, `signalBasis`). The patterns and statuses of the fixture students are pinned in `tests/analysis-evidence.test.ts`.
- Preserve cautious explanations and the teacher's final decision. Do not claim validated dropout prediction.
- Competencies can be entered without a grade. The grade-to-competency shortcut was removed: observations must be entered explicitly. Blank, zero, absent and competency-only results are distinct.
- Do not alter analysis thresholds or interpretation rules as part of cosmetic changes without explicit approval and regression tests.

## Terminology

Prefer “Évolution”, “Point à travailler”, “Fiabilité du signal”, “Signal à confirmer”, “Signal fiable”, and “Basé sur N évaluations”. Avoid “Trajectoire”, “Signal de compétence”, “Niveau de preuve” in ordinary teacher tables. Technical identifiers may retain their precise internal meaning.

## Data/privacy truth

The teacher app reads and writes only Supabase, with the teacher's cookie session, under RLS. There is no demonstration dataset, browser storage or fallback in the teacher app: when a read fails, the page says so. The only fictitious data are the public preview fixture (`lib/demo/marketing-data.ts`) and test fixtures (`tests/fixtures/`).

Establishment isolation is enforced by RLS and by the `focus_*` write functions (teacher assignment, class, subject and enrollment checks); `anon` has no privilege on application tables. Any Supabase Auth account can call PostgREST directly with the publishable key, so RLS and the functions — not the app — are the boundary: AI output (runs, observations, hypotheses, notes, decision history) is readable only by the teachers assigned to the assessment's class AND subject and the school admin, never by the student (migration `20261002120000`); direct table writes obey the same rules as the `focus_*` functions. The live project holds only fictitious records so far. Do not enter real student data until the owner has settled hosting, retention/deletion, the processing register and impact assessment with the school. No GDPR certification or completed audit is claimed.

The public preview is isolated by construction and a transitive import test. Never replace its fixture with application data or re-use a teacher view as public preview.

## Evidence and pedagogical AI contract

The flow is: assessment → subject, questions, correction, rubric, assessed notions (shared) → each student's exact answer, points, annotation → analysis → teacher decision → student file.

- The model sees the exact answers and the correction, the notions tagged on each question, and only the class's programme with its catalogue of typical errors. It returns a strict JSON schema.
- FOCUS keeps a finding only if its excerpt appears literally in the answer (meaningful length), its notion is an in-scope notion related to the question's assessed notions (part_of either way or prerequisite, checked identically in TypeScript and SQL), the teacher did not give full marks, the answer is not the correction, and the wording is neither overstated nor non-pedagogical. A typical-error code is kept only for the same notion. Rejected candidates are counted, never shown as findings. Do not relax these rules to make model output pass.
- Confidence (`limitee`, `moderee`, `forte`) is computed by the database from the student's history (repeated, and already confirmed by the teacher); the model's own confidence is ignored.
- AI tables are written only by audited SECURITY DEFINER functions; teachers cannot insert or edit AI output. Editing a copy, a question or its notions supersedes the analysis; superseded hypotheses are frozen in the history.
- Every hypothesis waits for a teacher currently assigned to the assessment's class and subject (or the school admin): confirm or dismiss, with an optional note, revisable while current. The assessment page lists all of its hypotheses for review; the student file shows them per student. Only confirmed observations appear in the student PDF; pending ones are counted.
- "No error observed" is never presented as mastery; insufficient evidence is reported as such.
- Scanned or photographed copies (PDF, or up to 12 photos checked in the browser for darkness and blur, then assembled into a PDF) are read by a separate transcription call that never receives the correction: literal transcription, `[illisible]` / `[?…]` markers, crossed-out text kept apart, a status per question and a report per page. FOCUS computes legibility (`lisible`, `partielle`, `illisible`, `vide`, `absente`) from the status AND the markers, never from a model confidence. A copy is imported without review only when nothing is uncertain; otherwise the teacher checks it question by question.
- Each response records its provenance (`source` manual/scan, `legibility`, `transcription_verified`), part of the evidence version. An automatic import stays an unverified reading until the teacher confirms or corrects it.
- Every analysis records one validated outcome per question (`error`, `no_error_observed`, `incomplete`, `no_answer`, `illegible`, `insufficient_evidence`), checked again in SQL. Evidence decides first: nothing written → no answer; illegible → illegible; zone absent from the image → insufficient evidence. No finding may rest on an illegible answer or a marked passage; an error whose proof fails the checks becomes insufficient evidence, never a finding.
- Confidence is additionally capped by the reading: `limitee` when the cited answer is partially legible, at most `moderee` for an unverified automatic reading. See docs/HANDWRITING_EVALUATION.md; the real reader has not yet been measured.

## Features and claims

Implemented: teacher login, dashboard work queue, class overview (groups to examine/follow/improving/insufficient data, competency signals from explicit levels, entry completion), classes and students, evaluations with grades/competencies (competencies of the class's subject; deletion by their teacher until copies are analysed), subject/questions/correction/notions, copy entry, AI analysis of mathematics copies (one copy or the whole class, one request per copy) with teacher review on the assessment page and in the student file, longitudinal student follow-up (hypotheses, confirmed observations, notion timelines, history), PDF exports, import of scanned or photographed copies with teacher verification, curriculum importer and catalogue, forgotten password and invitation onboarding, per-request AI usage records. Also implemented: the public portal, FOCUS Student (read-only space and Assistant FOCUS) and FOCUS Direction (read-only app over aggregates, programme progress, deterministic alerts; the database-level write restriction of the `admin` role is a proposal only). Not implemented: per-school AI budget enforcement, school-tool synchronization, measuring intervention outcomes, lesson declaration by teachers (proposal only), Parent app. The Student assistant has not been exercised on the real model from this repository's environment. The release model is `gpt-6-astra`. A real-model synthetic benchmark is part of the V1 release evidence; scripted stand-ins remain the evidence for deterministic local E2E wiring, not model quality.

The demonstration CTA uses an optional verified HTTPS `FOCUS_DEMO_REQUEST_URL`. Without it, explain that requests are not open and link to the public preview. Never invent an email address, collect leads without a configured recipient, or claim a request was sent when it was not.

## Curriculum knowledge base

The official curriculum graph is changed only through packages in `curriculum/` and `npm run curriculum` (validate → generated migration or dry-run-first import). `public.focus_import_curriculum` is service_role only, idempotent, never deletes nodes (it deactivates them) and refuses mass deactivation, node takeover across sources, retyping referenced nodes, duplicate or conflicting relationships and cycles. Store short FOCUS-written labels and source locators only — never programme or textbook text. The pedagogical AI reads the graph through `public.focus_curriculum_graph`, scoped to the class level; only in-scope notions can carry a recommendation. See curriculum/README.md.

## Changes requiring explicit approval

Do not, without explicit approval:

- Rebuild this application, create another repository, or introduce Parent here; give Student or Direction any write path to official data.
- Replace the three-app architecture or complementary positioning.
- Add public student-data access or weaken route protection.
- Claim prediction, autonomous decisions, compliance, tenant isolation, live integrations or features unsupported by implementation/evidence.
- Introduce real student data into the public fixture or test fixtures.
- Change analytical safeguards/thresholds under a design task.
- Merge into `main`, promote to production or apply migrations to the live project: the owner decides, after the migrations, real authentication and the real model have been verified on a Preview.
- Access, inspect or modify the unrelated Metrik project. It is outside this project's scope.

Work on a branch, never on `main`; never merge into `main` without the owner. Re-read current PR comments, confirm the remote head before pushing, and never overwrite another agent's work. Apply database migrations to a Supabase branch or copy before the live project. Report commands actually run, exact commit, Preview URL, and remaining limitations honestly.
