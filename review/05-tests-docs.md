# Track 5 — Tests & Documentation Review

**Scope:** `tests/e2e/**` (37 Playwright specs, 151 E2E tests), `src/test/**` + `src/**/*.test.{ts,tsx}` (145 unit test files, 1,178 test() blocks), `playwright.config.ts`, `playwright.offline.config.ts`, `vitest.config.ts`, `scripts/production-smoke.mjs`, `smoke-final.py`, `README.md`, `REQUIREMENTS.md`, `AGENTS.md`, `CLAUDE.md`, `LAUNCH_PLAN.md`, `docs/**` (72 files), `tsconfig*.json`, `eslint.config.js`, `bundle-baseline.json`, `AUDIT-REPORT-2026-06-26.md`.

**Repo:** `taekwondo-tournament`, production at `https://tkd.ashbi.ca`.
**Mode:** READ-ONLY. Only this report file is written.

---

## 1. Executive Summary

The test surface is mature and broad: 145 unit test files (1,178 individual test cases) plus 37 Playwright specs (151 E2E tests) covering the critical user journeys. The E2E suite includes six accessibility specs using `axe-core/playwright` and the documented `a11y-release-gates.md` baseline, plus a `keyboard-journeys` spec, a `viewport-zoom-a11y` spec, a `responsive-matrix` spec, and a single offline-reload spec that exercises both check-in and scorekeeper cache replay.

The five concrete audit items from `AUDIT-REPORT-2026-06-26.md` are all closed in code: the AuthContext console.log is gone, the Scorekeeper stale-closure deps array now contains `readyMatches` and `currentMatchIndex`, the magic-link code is double-gated by `!isEmailConfigured()` and `NODE_ENV !== 'production'`, the match-advancement `console.warn` is now a `console.log` behind `process.env.DEBUG`, and the noisy `// console.log noise in production.` comment in `brackets.ts:266` is replaced by a meaningful explanation of why BYE handling is outside the transaction. Item #5 — property-based testing on the bracket generator — is **not landed** (`fast-check` is not in `package.json`).

Documentation has three notable drift issues: (1) `README.md:154-157` lists four API endpoints that 404 (`/api/tournaments/:id/import`, `/api/tournaments/:id/brackets`, `/api/brackets/:id/score`, `/api/displays/:ring`); (2) `REQUIREMENTS.md` says "Vitest with 69 unit tests" — the real number is 1,178 across 145 files; (3) `docs/a11y-release-gates.md` claims `public-scoreboard-a11y.spec.ts` contains an axe scan but the file imports `checkA11y` and never calls it.

`smoke-final.py` is a dead one-off script at the repo root: hardcoded URL, hardcoded tournament UUID, and no non-zero exit on failure. It is not wired into CI and not referenced by any package.json script.

TypeScript strictness is on for both `tsconfig.json` and `tsconfig.server.json` but neither sets `noUncheckedIndexedAccess` or `exactOptionalPropertyTypes`. ESLint is intentionally minimal (only `@typescript-eslint/no-explicit-any`), documented as a Phase-1 lock-in.

CI (`.github/workflows/ci.yml`) runs typecheck + lint + vitest + `npm audit` + build + Playwright + the fresh-migration drill, but does **not** run `npm run bundle:check` or `npm run qa:smoke`. Both are defined as scripts but only invoked manually.

---

## 2. Findings Table

| # | Severity | Title | Location |
|---|---|---|---|
| 1 | HIGH | Bracket generator has no property-based tests; double-elim coverage is partial | `src/server/services/bracket-generator.test.ts`; `package.json` |
| 2 | MEDIUM | `match-advancement.ts` (847 LOC) has no unit test | `src/server/services/match-advancement.ts` |
| 3 | MEDIUM | `README.md` API table lists four endpoints that 404 | `README.md:154-157` |
| 4 | MEDIUM | `REQUIREMENTS.md` test count is 17× understated | `REQUIREMENTS.md:15,67` |
| 5 | MEDIUM | `smoke-final.py` is dead one-off code with hardcoded prod UUID | `smoke-final.py` |
| 6 | MEDIUM | `tsconfig.json` + `tsconfig.server.json` lack `noUncheckedIndexedAccess` | `tsconfig.json`; `tsconfig.server.json` |
| 7 | MEDIUM | `bundle:check` and `qa:smoke` are not wired into CI | `.github/workflows/ci.yml` |
| 8 | LOW | `public-scoreboard-a11y.spec.ts` imports `checkA11y` but never calls it | `tests/e2e/public-scoreboard-a11y.spec.ts` |
| 9 | LOW | `docs/a11y-release-gates.md` claims an axe scan that the spec doesn't run | `docs/a11y-release-gates.md:26` |
| 10 | LOW | Pages with no axe coverage: DirectorDashboard, Divisions, BracketEditor, Schedule, Results, FairnessRules, Tournaments, TournamentSettings, Profile, UserManagement, Trash, SupportTickets, OrganizationSettings, Competitors | `tests/e2e/` |
| 11 | LOW | `eslint.config.js` enables only `no-explicit-any` (documented, but leaves real linting to typecheck) | `eslint.config.js:54-58` |
| 12 | LOW | `/api/competitors/template/mapping` is still public (intentional per audit; flagging for tracking) | `src/server/routes/competitors.ts:50` |
| 13 | LOW | `LAUNCH_PLAN.md` has no test / smoke / a11y section; only 20 lines | `LAUNCH_PLAN.md` |

---

## 3. Numbered Findings

### [HIGH] 1. Bracket generator has no property-based tests; double-elim coverage is partial

- **Location:** `src/server/services/bracket-generator.test.ts:1-81`; `package.json` (no `fast-check` dependency)
- **Trigger:** The audit (`AUDIT-REPORT-2026-06-26.md:149`) explicitly recommended "Add a property-based test for `bracket-generator.ts` — fast-check on round/match invariants." `package.json` does not list `fast-check`. The seven tests in `bracket-generator.test.ts` are all for `generateSingleElimination` with hand-picked N=0/1/4/5/8. `generateBracket` dispatches to `generateDoubleEliminationBracket` for ≥5 competitors, but no test in this file exercises that path. `bracket-positions.test.ts` (9 tests, separate file) does cover double-elim positions and linkings, so the gap is narrower than a full miss — but it is not property-based and the file is named `positions`, suggesting a future maintainer may not realise it is the only double-elim coverage.
- **Impact:** A regression in double-elim linking (e.g., the grand-finals/reset position bug fixed in `bracket-positions.test.ts`) would have a single point of failure. The 1,069-LOC `bracket-generator.ts` (vs the 946 LOC the audit measured) keeps growing without a property harness to bound the input space.
- **Remediation:** Add `fast-check` and write property tests for round count = ⌈log2 N⌉, total matches, link invariants (every `nextWinnerMatch` points to a real match in the next round), and BYE placement for both single- and double-elim paths.
- **Evidence:**
  ```ts
  // bracket-generator.test.ts only seeds N=0,1,4,5,8 with hand-picked inputs
  it('8 competitors produce 4 + 2 + 1 = 7 matches', () => {
    const result = generateSingleElimination(seeded(8));
    expect(result.winners).toHaveLength(6);
  ```
  ```sh
  # package.json — no fast-check
  $ grep fast-check package.json
  (no output)
  ```

### [MEDIUM] 2. `match-advancement.ts` (847 LOC) has no unit test

- **Location:** `src/server/services/match-advancement.ts` (847 lines, 8 exported functions); no `match-advancement.test.ts` in `src/server/services/`
- **Trigger:** `src/server/services/` has 28 unit test files plus several integration test files, but `match-advancement.ts` is the largest service without one. The audit touched this file (item #5 demoted the `console.warn` here) but did not call out the test gap. Functions exported include `resolvePlacements`, `resolveNextMatchSlots`, `pickSlotsToNull`, `isValidStatusTransition`, `isBracketComplete`, and `isBracketCompletePure` — all of them drive match advancement after a score is recorded.
- **Impact:** A regression in status transitions or slot resolution would only be caught by the E2E `bracket-correction.spec.ts` (2 tests) and `scorekeeper-a11y.spec.ts` integration scenarios, which are narrow and slow.
- **Remediation:** Add `match-advancement.test.ts` covering the eight exported functions, particularly the state-machine invariants in `isValidStatusTransition` and `isBracketCompletePure` (these are pure and easy to test without a DB).
- **Evidence:**
  ```ts
  // match-advancement.ts — 8 exports, no matching .test.ts
  export function resolvePlacements(
  export function getBracketPlacementsFromLoaded(
  export function isBracketCompletePure(
  export function resolveNextMatchSlots(
  export function pickSlotsToNull(
  export function isValidStatusTransition(
  export function validateMatchStatusTransition(...
  export function isBracketComplete(
  ```
  ```sh
  $ ls src/server/services/match-advancement*
  src/server/services/match-advancement.ts
  # (no .test.ts)
  ```

### [MEDIUM] 3. `README.md` API table lists four endpoints that 404

- **Location:** `README.md:154-157`
- **Trigger:** The "API Endpoints" table at the bottom of `README.md` lists:
  - `POST /api/tournaments/:id/import` — does not exist. The actual roster-import route is `POST /api/competitors/import` (`src/server/routes/competitors.ts:643`).
  - `GET /api/tournaments/:id/brackets` — does not exist. Brackets live under `/api/brackets/tournament/:tournamentId/...` and `/api/brackets/division/:divisionId/...` (`src/server/routes/brackets.ts`).
  - `POST /api/brackets/:id/score` — does not exist. The actual route is `PUT /api/brackets/match/:matchId` (`brackets.ts:339`).
  - `GET /api/displays/:ring` — does not exist anywhere. There is no `/api/displays/*` mount in `src/server/index.ts`.
- **Impact:** A new operator following the README will hit 404 on every one of these. The "API Endpoints" table is the only API reference in the README — `CLAUDE.md` is the real source of truth.
- **Remediation:** Either remove the table or update it with the correct routes. The four lines should not exist in their current form.
- **Evidence:**
  ```md
  | POST | `/api/tournaments/:id/import` | Import Excel roster |
  | GET  | `/api/tournaments/:id/brackets` | Get brackets |
  | POST | `/api/brackets/:id/score` | Submit score |
  | GET  | `/api/displays/:ring` | Get ring display data |
  ```
  ```sh
  $ grep -r "router\.post.*'/import" src/server
  src/server/routes/competitors.ts:643:router.post('/import', ...)
  $ grep -r "router\..*'/displays" src/server
  (no output)
  ```

### [MEDIUM] 4. `REQUIREMENTS.md` test count is 17× understated

- **Location:** `REQUIREMENTS.md:15` ("Vitest with 69 unit tests") and `REQUIREMENTS.md:67` ("Vitest testing framework (69 tests passing)")
- **Trigger:** `find src -name '*.test.ts' -o -name '*.test.tsx'` returns 145 files, and the test() block count is 1,178. The "69" figure predates the `src/client/utils/*` test explosion (28 async-state, 38 url-state, 18 offline-operation-queue, 14 draft-storage, 25 onboarding-flow, 28 csv-export, etc.) and the server-side test harness expansion.
- **Impact:** A new contributor reading the requirements to understand coverage will be misled. The doc also stops at "69" as if testing is a finished MVP line item, which is no longer accurate.
- **Remediation:** Replace the fixed number with `find src -name '*.test.*' | wc -l` style description, or drop the count entirely. A `last updated: 2026-09` line with a generated count would be honest.
- **Evidence:**
  ```sh
  $ find src -name '*.test.ts' -o -name '*.test.tsx' | wc -l
  145
  $ grep -rc "^\s*(it|test)(" src --include="*.test.ts" --include="*.test.tsx" | awk -F: '{s+=$2} END {print s}'
  1178
  ```
  ```md
  | Testing Framework | ✅ Done | Vitest with 69 unit tests |
  - Vitest testing framework (69 tests passing)
  ```

### [MEDIUM] 5. `smoke-final.py` is dead one-off code with hardcoded prod UUID

- **Location:** `smoke-final.py` (49 lines, repo root)
- **Trigger:** The script:
  - hardcodes `https://tkd.ashbi.ca` (no env override);
  - hardcodes a tournament UUID `435ab382-fe49-4469-be51-b826a40ddcf3`;
  - catches exceptions in the loop body and only prints the error — it never `sys.exit(1)`, `raise`, or otherwise fails the build. A green CI run is possible with all routes broken.
  - is not in any `package.json` script, not referenced by `docs/DEPLOY.md`, not in `.github/workflows/ci.yml`, and not in `scripts/`.
- **Impact:** Confusing artifact at the repo root that looks like a smoke script but is actually a one-off diagnostic from a prior session. New operators may try to use it.
- **Remediation:** Delete `smoke-final.py`. The real smoke is `scripts/production-smoke.mjs` (CI-suitable: `https`-only, throws on failure, has an equivalent in `scripts/staging-smoke.mjs`).
- **Evidence:**
  ```python
  # smoke-final.py:12-13 — no env override
  TOKEN = get_token()
  print("token len:", len(TOKEN))
  ...
  # smoke-final.py:23-32 — only prints; never exits non-zero
  for path in working:
      try:
          ...
      except Exception as e:
          print(f"  ERR {time.time()-t0:.2f}s  {path}  {type(e).__name__}: {e}")
  ```

### [MEDIUM] 6. `tsconfig.json` and `tsconfig.server.json` lack `noUncheckedIndexedAccess`

- **Location:** `tsconfig.json:8`; `tsconfig.server.json:7`
- **Trigger:** Both files set `"strict": true` but not `noUncheckedIndexedAccess` or `exactOptionalPropertyTypes`. With 24 `as unknown as` usages across the source tree (a sample of the cast density that ships in this repo), the lack of an `arr[i]` → `T | undefined` safety net is a real correctness gap.
- **Impact:** Bugs like `result.matches[0].id` returning `T` instead of `T | undefined` are not caught at compile time. The 1,178 unit tests mitigate the runtime impact, but the cost of adding the flag is well-defined and bounded (the audit mentioned a prior 112-cast cleanup as a one-time PR).
- **Remediation:** Add `"noUncheckedIndexedAccess": true` to both tsconfigs and address the fallout (will surface in bracket-generator.ts, match-advancement.ts, and the E2E `helpers.ts`).
- **Evidence:**
  ```json
  // tsconfig.json
  "strict": true,
  "esModuleInterop": true,
  // (no noUncheckedIndexedAccess, no exactOptionalPropertyTypes)
  ```

### [MEDIUM] 7. `bundle:check` and `qa:smoke` are not wired into CI

- **Location:** `.github/workflows/ci.yml` (the workflow defines 7 steps: checkout, setup-node, install, typecheck, unit tests, lint, audit, build, install-playwright, postgres, e2e, fresh-migration)
- **Trigger:** `package.json` defines `qa:smoke`, `bundle:check`, and `bundle:baseline` scripts. The bundle baseline file (`bundle-baseline.json`) was last updated 2026-09-10. None of these are invoked by the CI workflow. The bundle baseline is maintained by hand and would silently rot if the bundle:baseline script is forgotten.
- **Impact:** A PR that pushes the initial entry chunk above 150 KB raw (or the public scoreboard above 60 KB) passes CI; only a manual run of `npm run bundle:check` catches it. The smoke is similarly manual.
- **Remediation:** Add a `bundle:check` step after `Build` that fails on a budget breach, and a `qa:smoke` step gated to `workflow_dispatch` (smoke is to a live URL, not a PR gate).
- **Evidence:**
  ```yaml
  # .github/workflows/ci.yml — no qa:smoke, no bundle:check
      - name: Build
        run: npm run build
  ...
      - name: Fresh migration test
  ```
  ```json
  // package.json
  "qa:smoke": "node scripts/production-smoke.mjs",
  "bundle:check": "node scripts/analyze-bundle.mjs check",
  ```

### [LOW] 8. `public-scoreboard-a11y.spec.ts` imports `checkA11y` but never calls it

- **Location:** `tests/e2e/public-scoreboard-a11y.spec.ts:5`
- **Trigger:** The file is named `-a11y.spec.ts` and imports `checkA11y` (line 5), but the only three tests are manual a11y assertions: `getByRole`, `keyboard.press`, `getByText`. No `await checkA11y(page)` call exists. The import is dead.
- **Impact:** A future reader assumes this spec gates axe-core violations for the public scoreboard; it does not. The other a11y specs (`scorekeeper-a11y`, `checkin-a11y`, `public-register-a11y`, `tournament-management-a11y`) all do call `checkA11y`.
- **Remediation:** Add a `test('axe scan on public scoreboard', ...)` that calls `checkA11y(page)` and asserts zero critical/serious violations, or rename the file to drop the `-a11y` suffix.
- **Evidence:**
  ```ts
  // public-scoreboard-a11y.spec.ts
  import { checkA11y } from './axe-helper';
  ...
  test('public scoreboard renders with semantic HTML and is scannable', ...)
  test('public scoreboard has keyboard navigation', ...)
  test('public scoreboard updates are announced to screen readers', ...)
  // (no call to checkA11y anywhere)
  ```

### [LOW] 9. `docs/a11y-release-gates.md` claims an axe scan that the spec doesn't run

- **Location:** `docs/a11y-release-gates.md:26`
- **Trigger:** The release-gate doc claims:
  > `tests/e2e/public-scoreboard-a11y.spec.ts` — "public scoreboard renders with semantic HTML"
  is an axe gate. The spec's first test matches that name but does not call `checkA11y`. So this gate is satisfied by a manual role/aria-label assertion only, not an axe scan.
- **Impact:** A release checklist reviewer will tick the box thinking axe passed on the public scoreboard, when only three manual assertions ran.
- **Remediation:** Add the missing axe scan to the spec (see finding 8) so the doc and the test agree.
- **Evidence:**
  ```md
  // docs/a11y-release-gates.md:26
  - `tests/e2e/public-scoreboard-a11y.spec.ts` — "public scoreboard renders with semantic HTML"
  ```

### [LOW] 10. Pages with no axe coverage

- **Location:** `tests/e2e/` — six specs call `checkA11y`: `login.spec.ts`, `checkin-a11y.spec.ts`, `public-register-a11y.spec.ts`, `public-scoreboard-a11y.spec.ts` (import only, see finding 8), `scorekeeper-a11y.spec.ts`, `tournament-management-a11y.spec.ts`.
- **Trigger:** The following client pages have no axe scan: `DirectorDashboard.tsx` (1,208 LOC), `Divisions.tsx` (1,966 LOC), `BracketEditor.tsx` (1,176 LOC), `Schedule.tsx` (1,283 LOC), `Results.tsx`, `FairnessRules.tsx`, `Tournaments.tsx`, `TournamentSettings.tsx` (1,587 LOC), `Profile.tsx`, `UserManagement.tsx`, `Trash.tsx`, `SupportTickets.tsx`, `OrganizationSettings.tsx`, `Competitors.tsx` (1,351 LOC), `Waitlist.tsx`, `SchoolPortal.tsx`, `EventPortal.tsx`, `OrganizerPortal.tsx`, `ParentScoreboard.tsx`, `CompetitorProfile.tsx`, `TournamentTemplates.tsx`, `TournamentTemplateForm.tsx`, `AnnouncerView.tsx`, `CompetitorDuplicates.tsx`, `DivisionMoveCompetitor.tsx`, `AcceptInvite.tsx`, `VerifyMagicLink.tsx`, `VerifyParentConsent.tsx`, `CheckRegistration.tsx`, `ManageRegistration.tsx`, `Dashboard.tsx`.
- **Impact:** The four "critical journeys" from `a11y-release-gates.md` (Login, Public Registration, Scorekeeper, Public Scoreboard) are gated. The remaining ~30 pages rely on the component library's defaults. The branded landing page and the offline shell have a manual a11y pass via `marketing-mobile-accessibility.spec.ts`, but the admin and director surfaces are uncovered.
- **Remediation:** Add an axe scan per page for the most-trafficked admin pages (Tournaments list, TournamentSettings, Divisions). Cheaper alternative: a `tests/e2e/admin-axe-scan.spec.ts` that walks `page.goto('/admin/page')` for each authenticated route.
- **Evidence:** See the inventory above; `tests/e2e/*a11y*.spec.ts` is the closed set.

### [LOW] 11. `eslint.config.js` enables only `no-explicit-any` (documented, but leaves real linting to typecheck)

- **Location:** `eslint.config.js:1-79`
- **Trigger:** The config comment at the top is explicit:
  > Other lint rules (unused-vars, prefer-const, etc.) are intentionally left to the typecheck step + code review — turning on the full typescript-eslint recommended set would surface ~100 pre-existing issues unrelated to this task.
  So the only enforced rule is `@typescript-eslint/no-explicit-any`. There is no `no-unused-vars`, no `no-console` (the only one that would have caught the audit's first three findings), no `no-floating-promises`, no `eqeqeq`, no `consistent-type-imports`.
- **Impact:** A future PR can ship `console.log`, floating promises, and `as any` on test files (the test escape hatch at line 64-79 is generous) without lint stopping it. The audit's first three findings were all caught by a manual grep, not lint.
- **Remediation:** This is a documented choice, not a bug. If the project's velocity allows, add the recommended-typescript-eslint set incrementally. The TypeScript strictness is doing most of the work.
- **Evidence:**
  ```js
  // eslint.config.js:53-58
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
  },
  ```

### [LOW] 12. `/api/competitors/template/mapping` is still public

- **Location:** `src/server/routes/competitors.ts:50`
- **Trigger:** The audit's optional recommendation #7: "Consider whether `/api/competitors/template/mapping` should be admin-only — currently public by design, low risk." The route has not changed; it is still unauthenticated and returns the default Excel column mapping. This is a tracking item, not a regression.
- **Impact:** The data returned is static column-mapping metadata (not PII, not organization-specific). The risk profile is genuinely low.
- **Remediation:** None required. If the team wants to lock it down, add `authenticate` + `requireRole('admin', 'director')` middleware. Track as a deliberate "public by design" call.
- **Evidence:**
  ```ts
  // competitors.ts:49-52
  // Get default column mapping for imports
  router.get('/template/mapping', (_req: Request, res: Response) => {
    res.json(getDefaultColumnMapping());
  });
  ```

### [LOW] 13. `LAUNCH_PLAN.md` has no test / smoke / a11y section; only 20 lines

- **Location:** `LAUNCH_PLAN.md` (20 lines total)
- **Trigger:** The doc has three phases (MVP, Deployment, Launch) with checkbox items like "Configure custom domain", "Setup CI/CD", "Add analytics" — but no mention of `qa:smoke`, `bundle:check`, the a11y release gates, the fresh-migration drill, or the offline E2E. The CI workflow and `docs/DEPLOY.md` cover most of this, but the launch plan itself reads as if testing is out of scope.
- **Impact:** A new operator reading `LAUNCH_PLAN.md` before a launch will not know the smoke is `npm run qa:smoke` or that the a11y release gates in `docs/a11y-release-gates.md` are blocking.
- **Remediation:** Add a "Pre-Launch Verification" section that points at `docs/DEPLOY.md`, `docs/a11y-release-gates.md`, and the smoke scripts. Alternatively, mark the file as deprecated in favor of `docs/RELEASE-RUNBOOK.md` (which appears more comprehensive).
- **Evidence:**
  ```md
  # LAUNCH_PLAN.md — full file
  # Launch Plan & TODOs
  ## Phase 1: MVP & Prep
  - [x] Audit existing codebase for bugs and incomplete features
  ...
  ## Phase 3: Launch
  - [x] Prepare app store assets...
  - [ ] Submit to app stores (if applicable)
  - [x] Write launch post...
  - [ ] Monitor logs and feedback post-launch
  ```

---

## 4. Audit Follow-up Table (from `AUDIT-REPORT-2026-06-26.md`)

| # | Audit item | Original line | Status | Evidence | What (if anything) blocks it |
|---|---|---|---|---|---|
| A1 | Remove `console.log('Session expired, logging out...')` in `AuthContext.tsx:80` | 1, 145 | **CLOSED** | `grep -n "console.log" src/client/context/AuthContext.tsx` → no matches. The 401 handler now uses `sessionEvidence.consumeExpiredSessionEvidence()` + a `CustomEvent('session-expired')`; no client-side console.log. | None. |
| A2 | Fix stale-closure in `Scorekeeper useCallback:414` (deps had `readyMatches.length` instead of `readyMatches`) | 2, 146 | **CLOSED** | `src/client/pages/Scorekeeper.tsx:692`: deps array now includes `readyMatches, currentMatchIndex, ...`. The number-length dep is gone. | None. |
| A3 | Gate `console.log` of magic-link codes in `auth.ts:161` behind `NODE_ENV !== 'production'` | 3, 147 | **CLOSED (double-gated)** | `src/server/routes/auth.ts:205-219`: the existing `!emailResult.success && !isEmailConfigured() && process.env.NODE_ENV !== 'production'` block is now wrapped in an extra `if (process.env.NODE_ENV !== 'production')` at line 216. Comment explains why the inner gate is necessary. | None. |
| A4 | Demote `console.warn` in `match-advancement.ts:150` to debug-level | 4, 148 | **CLOSED** | `src/server/services/match-advancement.ts:161-163`: now `if (process.env.DEBUG) { console.log(...) }` with a comment explaining the choice. | None. |
| A5 | Add a property-based test for `bracket-generator.ts` (fast-check) | 5, 149 | **STILL OPEN** | `package.json` does not contain `fast-check`. `bracket-generator.test.ts` has 7 hand-picked single-elim tests; `bracket-positions.test.ts` has 9 double-elim regression tests (positions, linkings, 14/15 and 22/23 invariants). Neither is property-based. No adversarial test exercises the 1,069-LOC double-elim path with randomly-seeded inputs. | Lack of `fast-check` dep + the audit said "fast-check on round/match invariants" which is broader than what landed. |
| A6 | Delete the leftover `// console.log noise in production.` comment in `brackets.ts:266` | 6, 150 | **CLOSED** | `src/server/routes/brackets.ts:265-270` is now a meaningful 6-line comment explaining why BYE handling is outside the transaction (Prisma `read` calls don't see in-flight writes; transaction is already committed). | None. |
| A7 | (Optional) Make `/api/competitors/template/mapping` admin-only | 7, 151 | **STILL OPEN (low risk by design)** | `src/server/routes/competitors.ts:50` still has no `authenticate` middleware. The route returns static `getDefaultColumnMapping()` data. The audit called this "low risk" and "public by design". | Deliberate. If locked down, add `authenticate` + `requireRole('admin', 'director')`. |
| A8 | Two stale `// NOTE: Must be defined BEFORE /:id route` comments | 7 (mentioned in "What was NOT audited") | **STILL PRESENT, by design** | These are the meta-route ordering guard rails at `competitors.ts:41,50`. The audit called them "accurate and necessary". | None — they are intentional operator guidance. |

Net: **5 closed, 1 still open (A5 — property-based testing), 1 still open by design (A7), 1 still present by design (A8).** The "WHAT WAS NOT AUDITED" section (lines 155-163) explicitly excluded: full correctness of `bracket-generator.ts` (only structural read), prisma migration history, frontend performance / bundle size, full mobile sweep, **E2E test suite runs**, deeper a11y than the recent fixes, server memory / load testing. Of these, the E2E suite is now exercised in CI (`.github/workflows/ci.yml` runs `npx playwright test`); bundle size is still hand-maintained (see finding 7); a11y is partially exercised (six specs call `checkA11y`, but with the gaps in finding 10).

---

## 5. Coverage Gap Summary

### Routes → E2E coverage

| Route | Page component | E2E spec | Axe? | Notes |
|---|---|---|---|---|
| `/` (Marketing) | `Marketing.tsx` | `marketing.spec.ts` (4) | No axe, but `marketing-mobile-accessibility.spec.ts` (1) covers mobile nav + support | Solid. |
| `/login` | `Login.tsx` | `login.spec.ts` (5) | ✅ axe | Solid. |
| `/verify` | `VerifyMagicLink.tsx` | `auth-session-hydration.spec.ts` (3) | No | Three hydration scenarios. |
| `/register` | `PublicRegister.tsx` | `public-register.spec.ts` (8), `public-register-a11y.spec.ts` (10) | ✅ 3 axe scans | Strongest-covered route. |
| `/check-registration` | `CheckRegistration.tsx` | None | None | Gap. |
| `/manage-registration` | `ManageRegistration.tsx` | `manage-registration-save.spec.ts` (3) | No | Covered via PATCH semantics. |
| `/verify-parent-consent` | `VerifyParentConsent.tsx` | None | None | Gap. |
| `/events/:orgSlug` | `EventPortal.tsx` | None | None | Gap. |
| `/events/:orgSlug/:eventSlug` | `EventPortal.tsx` | None | None | Gap. |
| `/accept-invite` | `AcceptInvite.tsx` | `invites-lifecycle.test.ts` (server, 29) | No | Server coverage strong, UI not walked. |
| `/scorekeeper/:tournamentId` | `Scorekeeper.tsx` | `scorekeeper-a11y.spec.ts` (16) | ✅ 2 axe scans | Best-covered operational page. |
| `/checkin/:tournamentId` | `CheckIn.tsx` | `checkin.spec.ts` (6), `checkin-a11y.spec.ts` (8) | ✅ 1 axe scan | Strong. |
| `/waitlist/:tournamentId` | `Waitlist.tsx` | None | None | Gap. |
| `/display/:tournamentId` | `AnnouncerView.tsx` | None | None | Gap. |
| `/announcer/:tournamentId` | `AnnouncerView.tsx` | None | None | Gap. |
| `/scoreboard/parent/:tournamentId` | `ParentScoreboard.tsx` | `anonymous-status.spec.ts` (14, mixed) | No | Public anonymous coverage includes the parent scoreboard paths. |
| `/scoreboard/:publicSlug` | `PublicScoreboard.tsx`, `PublicScoreboardBySlug.tsx` | `public-scoreboard-a11y.spec.ts` (3) | **Import only, no call** | Finding 8. |
| `/tournaments/:tournamentId/school` | `SchoolPortal.tsx` | None | None | Gap. |
| `/tournaments/:id/scorekeeper` | (Scorekeeper) | See above. | | Same handler. |
| `/tournaments/:id/checkin` | (CheckIn) | See above. | | Same handler. |
| `/tournaments/:id/display` | (Display) | None | None | Gap. |
| `/dashboard` | `Dashboard.tsx` | None | None | Gap. |
| `/competitors` | `Competitors.tsx` | `competitor-operation-status.spec.ts` (1) | None | Light. |
| `/competitors/duplicates` | `CompetitorDuplicates.tsx` | None | None | Gap. |
| `/competitors/:id/profile` | `CompetitorProfile.tsx` | None | None | Gap. |
| `/trash` | `Trash.tsx` | None | None | Gap. |
| `/tournaments` | `Tournaments.tsx` | `tournament-management-a11y.spec.ts` (14) | ✅ 1 axe scan | Covered. |
| `/tournament-templates` | `TournamentTemplates.tsx` | None | None | Gap. |
| `/tournament-templates/new` | `TournamentTemplateForm.tsx` | `tournament-templates.test.ts` (server, 6) | No | Server covered, UI not walked. |
| `/tournament-templates/:id/edit` | `TournamentTemplateForm.tsx` | (same as above) | No | Same. |
| `/tournaments/:id` | `TournamentDetail.tsx` | `tournament-management-a11y.spec.ts` (settings tab) | ✅ axe | Partial — only settings tab is a11y-tested. |
| `/tournaments/:id/results` | `Results.tsx` | None | None | Gap. |
| `/tournaments/:id/settings` | `TournamentSettings.tsx` | `tournament-management-a11y.spec.ts`, `tournament-settings-atomic.spec.ts` (1) | ✅ axe | Strong. |
| `/tournaments/:id/divisions` | `Divisions.tsx` | `tournament-attention.spec.ts` (1), `tournament-operation-status.spec.ts` (1) | No | Covered indirectly. |
| `/tournaments/:id/schedule` | `Schedule.tsx` | `schedule-correction.spec.ts` (3) | No | Strong on correction flow. |
| `/tournaments/:id/director` | `DirectorDashboard.tsx` | `tournament-attention.spec.ts` (2) | No | Coverage of attention panel only. |
| `/tournaments/:tournamentId/fairness` | `FairnessRules.tsx` | None | None | Gap. |
| `/admin/users` | `UserManagement.tsx` | None | None | Gap. |
| `/support/tickets` | `SupportTickets.tsx` | `support-config.spec.ts` (1) | No | Server covered. |
| `/profile` | `Profile.tsx` | `account-lifecycle.spec.ts` (2) | No | Deletion flow only. |
| `/organization` | `OrganizationSettings.tsx` | `organization-settings.spec.ts` (3), `organizations.spec.ts` (1), `organization-lifecycle.spec.ts` (1) | No | Strong. |
| `/tutorials` | `VideoTutorials.tsx` | None | None | Gap. |
| `/tournaments/:tournamentId/divisions/:divisionId/bracket` | `BracketEditor.tsx` | `bracket-correction.spec.ts` (2) | No | Strong on correction only. |

### Service-level coverage

| Service (LOC) | Unit tests | Notes |
|---|---|---|
| `categorization-engine.ts` (1,168) | `categorization-engine.test.ts` (26) | Strong. |
| `pdf-export.ts` (1,148) | `pdf-batch.test.ts` (7) | Limited to batch. |
| `bracket-generator.ts` (1,069) | `bracket-generator.test.ts` (7 single-elim), `bracket-positions.test.ts` (9 double-elim) | Finding 1: no property tests. |
| `match-advancement.ts` (847) | **None** | Finding 2. |
| `schedule-optimization-recommendations.ts` (635) | `schedule-optimization-recommendations.test.ts` (7) + integration (4) | Strong. |
| `rule-engine.ts` (512) | `rule-engine.test.ts` (10) | Solid. |
| `schedule-delay-propagation.ts` (489) | `schedule-delay-propagation.test.ts` (10) | Solid. |
| `email-templates.ts` (454) | `email-templates.test.ts` (5) | Light. |
| `bracket-correction.ts` (443) | `bracket-correction.test.ts` (11) + integration (1) | Strong. |
| `backup-recovery.ts` (415) | `backup-recovery.integration.test.ts` (6) | Integration only. |
| `placements.ts` | `placements.test.ts` (78) | Strongest. |

### Unit-test totals

- 145 `.test.ts` files
- 2 `.test.tsx` files (`DirectorOverrideDialog.test.tsx`, `ConfirmDialog.test.tsx`)
- 1,178 `test()` / `it()` blocks

The two `.test.tsx` files are a thin layer; most React component testing happens via E2E.

---

## 6. Verdict

**`NEEDS_FIXES`** — not ship-blocking, but finding #1 (no property tests on a 1,069-line double-elim generator) is a real test-coverage gap on a critical operational path, and finding #3 (README's API table points to four 404 endpoints) is operator-facing doc drift. The five-actionable audit items from `AUDIT-REPORT-2026-06-26.md` are otherwise closed; the one that's still open (A5) is the same one the audit explicitly called out as "Full correctness of bracket-generator.ts — 946 lines of double-elimination logic; read structurally but not fuzzed" (line 157). The CI is otherwise strong: typecheck, lint, vitest, audit, build, full Playwright matrix, and a fresh-migration drill all run on PRs.

---

## Appendix — Quick file references

- E2E specs: 37 files in `tests/e2e/`, 151 total tests
- Unit test files: 145 in `src/**`; 1,178 `test()`/`it()` blocks
- CI workflow: `.github/workflows/ci.yml` (7 job steps)
- Vitest config: `vitest.config.ts` (fileParallelism: false, env JWT_SECRET injected)
- Playwright config: `playwright.config.ts` (webServer: concurrently dev:server + vite; ENABLE_E2E_AUTH_BYPASS / ENABLE_DEV_AUTH / ENABLE_DEMO_LOGIN all set to `'1'` via `String(1)`)
- Smoke scripts: `scripts/production-smoke.mjs` (good), `scripts/staging-smoke.mjs` (good), `smoke-final.py` (DEAD — see finding 5)
- Bundle baseline: `bundle-baseline.json` (last updated 2026-09-10; not enforced in CI — finding 7)
- ESLint: `eslint.config.js` (only `@typescript-eslint/no-explicit-any` enabled; documented)
- TypeScript: `tsconfig.json` + `tsconfig.server.json` (strict; no `noUncheckedIndexedAccess` — finding 6)
