# FOCUS — corrective product / UX audit

## Context

This revision continues PR #1 (`aac0f9e93c2c442505cfbb0f3ebccd22437a62ed`) after reading its complete diff, discussion and independent audit (comments 5624345290 / 5624346290). The original accessibility work and analytical rules are preserved. The latest product brief supersedes the audit's suggestion to lead the home screen with students needing attention.

The original PR claimed `pnpm test` passed despite having no test script. That claim was inaccurate. This revision adds actual tests and reports only executions that can be verified.

## Audit corrections

| Finding                                | Correction                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Marketing calls application analysis   | Dedicated deeply frozen, import-free public fixture; transitive dependency regression test           |
| Student count labeled as competencies  | Removed ambiguous aggregate; preview explicitly shows competency counts per fictitious evaluation    |
| Predictive/adversarial positioning     | Complementary to school administration software; no dropout prediction claim                         |
| Technical teacher terminology          | Évolution, Point à travailler, Fiabilité du signal, explicit observation counts                      |
| Marketing link in teacher navigation   | Removed from daily sidebar                                                                           |
| Pathname-based shell exception         | Separate marketing/auth/teacher route groups and layouts                                             |
| Privacy guarantees overstated          | No claim of tenant isolation or GDPR certification; real-data prerequisites documented               |
| Invented contact email                 | Optional verified HTTPS request URL; honest unavailable state without fake submission                |
| Minified CSS                           | Reformatted stylesheet and named responsive layout rules                                             |
| Sticky header outside scroll container | Bounded two-axis scroll regions, keyboard-focusable, descriptive names                               |
| Dashboard too aggressive               | Welcome/actions first, recent work second, collapsed pedagogical insights third                      |
| No private product                     | Supabase server authentication, teacher authorization, refresh, logout and fail-closed configuration |

## Accessibility retained / extended

Table column/row scopes, button types, filter aria-pressed, visible focus and keyboard use retained. Explicit names added to search, score/competency fields and scroll regions. Navigation has aria-current and remains labeled on tablet/mobile. Public/teacher skip links and native keyboard-operable FAQ/disclosure controls added. Client teacher pages are guarded by server entry components.

## Verification status

Executed in this revision:

- `npm run typecheck`: pass.
- `npm run lint`: pass, no errors or warnings from ESLint.
- `npm run test`: 10 tests passed (analysis and security/import boundaries).
- `npm run build`: pass; marketing root static, teacher routes dynamic.
- `npm run test:routes`: 9 tests passed against the production build and a loopback Auth double (real Server Actions, session cookies, refresh, logout, role revocation, legacy redirects and unauthenticated RSC denials).
- `git diff --check`: pass.

The Auth double checks integration behavior, not an actual Supabase project's configuration.

Visual QA is **blocked, not passed**. The cloud browser rejects the local URL (`ERR_BLOCKED_BY_CLIENT`). The existing FOCUS Preview opens a Vercel login page rather than the application, and the Vercel connector returns 403 for the FOCUS project. Consequently desktop/tablet/mobile rendering, browser interaction, empty states and sticky-header behavior have NOT been visually validated in this revision. Responsive styles and bounded scroll containers are implemented, but source inspection is not visual proof. Do not mark this PR ready for a real school pilot until authenticated browser QA has been completed.

## Remaining product limits

- One fictitious class, browser-local evaluation additions; no school-data backend.
- No live Supabase credentials provisioned in this task yet; private access remains denied without them.
- No self-registration, invitation acceptance, or self-service password recovery UI.
- Accompaniment creation is simulated; outcome measurement remains future work.
- Public requests require a verified configured HTTPS destination.
- Real-data operation requires server-side ownership/tenant policies, retention rules and operational/privacy review. Per-user demo storage keys are not tenant isolation.
