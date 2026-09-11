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
- `app/(marketing)/`: public `/`, institutional presentation, independent navigation. It imports ONLY the dedicated immutable `lib/demo/marketing-data.ts` fixture for its preview. That fixture has no imports. Public pages must not depend, even transitively, on `lib/data`, `lib/analysis`, the demo store or teacher components.
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
- Recent evaluations second, without dominant raw grades or alert totals.
- Pedagogical insights third, inside a collapsed, keyboard-accessible “À consulter quand vous êtes prêt” disclosure.
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

All current academic data are fictitious. The teacher app still uses the existing one-class demonstration dataset and browser-only additions. Additions are namespaced by teacher ID to avoid accidental reuse between accounts. This is convenience separation, NOT tenant isolation, encryption, or a real student-record access boundary. Old unscoped browser additions are not automatically migrated or deleted.

Do not enter real student data. Business persistence, server-side resource ownership, establishment isolation, retention/deletion rules, deployment/data processing review and compliance checks must be implemented and verified before a real school pilot. Authentication alone does not provide these guarantees. No GDPR certification or completed audit is claimed.

The public preview is isolated by construction and a transitive import test. Never replace its fixture with application data or re-use a teacher view as public preview. The existing client-side academic fixtures must be replaced by authorized server data readers before real records exist; client bundles are publicly downloadable even when their page is protected.

## Reliability update — 11 September 2026

The current user request authorizes progressive production deployment after successful checks. Earlier no-production language in the original PR describes that earlier task, not a new approval requirement. This does not waive verification: provider access and production authentication are still blocked, so production must not be marked verified or ready.

Read AUDIT_2026-09-11.md. Local evaluation saves now report failures, validate restored data, and allow editing demo additions. Dates are calendar dates displayed in UTC. Historical evaluation baselines use earlier evaluations in the same class only. Less than two numeric results cannot establish a score trend; explicit competency evidence remains independent. Thresholds and established example narratives remain regression-tested. No SQL migration is safe to invent before inspecting the existing schema.

## Features and claims

Existing evaluation entry, charts, class roster, student profile and cautious recommendations are preserved. Evaluation persistence depends on browser storage availability and is not synchronized. Accompaniment suggestions are read-only; no plan or intervention is saved and no simulated success is shown. Measuring intervention outcomes and automatic school-tool synchronization remain future work.

The demonstration CTA uses an optional verified HTTPS `FOCUS_DEMO_REQUEST_URL`. Without it, explain that requests are not open and link to the public preview. Never invent an email address, collect leads without a configured recipient, or claim a request was sent when it was not.

## Changes requiring explicit approval

Do not, without explicit approval:

- Rebuild this application, create another repository, or introduce Student/Parent apps here.
- Replace the three-app architecture or complementary positioning.
- Add public student-data access or weaken route protection.
- Claim prediction, autonomous decisions, compliance, tenant isolation, live integrations or features unsupported by implementation/evidence.
- Introduce real student data into the demo store or public fixture.
- Change analytical safeguards/thresholds under a design task.
- Merge into main or deploy production during the current PR task.
- Access, inspect or modify the unrelated Metrik project. It is outside this project's scope.

Continue PR #1 on `codex/effectuer-un-audit-visuel-de-focus`, or use a safe continuation branch. Re-read current PR comments, confirm the remote head before pushing, and never overwrite another agent's work. Report commands actually run, exact commit, Preview URL, and remaining limitations honestly.
