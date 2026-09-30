# TKD Tournament App — Master Audit Report

**Date:** 2026-06-26  
**Auditor:** Mavis (orchestrator), self-conducted  
**Scope:** All 36 source files in `~/taekwondo-tournament` (22,426 LOC across 27 frontend pages + 11 backend route files + UI primitives + services)  
**Method:** Cross-cutting greps (TODO/FIXME markers, console.log, missing auth, missing soft-delete filter, missing role check, $queryRaw usage, dangerouslySetInnerHTML, alert/confirm) + end-to-end reads of high-risk files (Scorekeeper, bracket-generator, auth, PublicRegister, TournamentDetail) + cross-feature wiring verification (route registration, App.tsx mount, prisma model coverage) + live-site smoke test against https://tkd.ashbi.ca  
**Outcome:** Repository is in substantially good health. Two latent bugs and a handful of low-severity findings below.

---

## Severity Counts

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 2 |
| Low | 4 |
| Nit | 3 |

---

## Medium severity

### 1. `console.log` left in production client code (logs every session expiry to user's devtools)
**File:** `src/client/context/AuthContext.tsx:80`  
**Pattern:** `console.log('Session expired, logging out...');`  
**Why it matters:** Not a security issue (no sensitive data leaked), but it's debug noise that ships to every user's browser. Will pollute end-user devtools and reveals session-management timing.  
**Suggested fix:** Remove the line, or gate it behind `if (import.meta.env.DEV)`.

### 2. Stale-closure bug in Scorekeeper keyboard handler (Ctrl+Z undo may target wrong match)
**File:** `src/client/pages/Scorekeeper.tsx:414`  
**Pattern:**  
```ts
const handleKeyDown = useCallback((e: KeyboardEvent) => { … readyMatches.filter(...) … },
  [showConfirm, selectedDivision, currentMatch, selectedWinner, readyMatches.length]);
```  
**Why it matters:** The dep array includes `readyMatches.length` (a number) but the callback body references `readyMatches` (the array). When matches complete without changing the array length (e.g., one ready → completed while another still ready), the callback won't re-memo, and `readyMatches.filter(m => m.status === 'completed').slice(-1)[0]` returns a stale "last completed match". Ctrl+Z would then undo the wrong match.  
**Likelihood:** Low — only triggers when a match completes AND another match is concurrently ready. Race window is small.  
**Suggested fix:** Add `readyMatches` (the array) to deps, or wrap the filter+slice in a `useMemo` keyed on `readyMatches`.

---

## Low severity

### 3. `console.log` in `brackets.ts:266` commented but the comment itself is noisy
**File:** `src/server/routes/brackets.ts:266`  
**Pattern:** `// console.log noise in production.`  
**Why it matters:** Leftover debug comment from when console.log was removed. Harmless but adds noise.  
**Suggested fix:** Delete the comment.

### 4. `console.log` in dev-mode magic-link route logs the URL and 6-digit code
**File:** `src/server/routes/auth.ts:161-163`  
**Pattern:**  
```ts
console.log(
  `[dev-auth] magic link for ${activeUser.email}: ${magicUrl} (code: ${code})`,
);
```  
**Why it matters:** Inside the `if (!emailResult.success && !isEmailConfigured())` branch, so it only fires when SMTP isn't configured. In dev / Mailgun-less deployments this prints plaintext codes to server logs. Server logs are typically less exposed than client logs, so this is low risk — but a `console.log` of a 6-digit auth code is exactly the kind of thing that becomes a leak when logs get shipped to Datadog/CloudWatch.  
**Suggested fix:** Gate behind an explicit `if (process.env.NODE_ENV !== 'production')` check, or redact the code/URL.

### 5. `console.warn` on legitimate flow is noisy
**File:** `src/server/services/match-advancement.ts:150`  
**Pattern:** `console.warn(`Match ${matchId} already has both competitors`);`  
**Why it matters:** This fires whenever the advancement engine sees an already-filled slot — which can happen on legitimate re-runs. Will spam logs in normal operation.  
**Suggested fix:** Demote to debug-level or guard with a `if (process.env.DEBUG)` flag.

### 6. Bracket generator logic is dense — recommended adversarial test pass
**File:** `src/server/services/bracket-generator.ts` (946 lines)  
**Pattern:** Double-elimination bracket construction with winners + losers + finals, winnersRounds = log2(bracketSize), losers bracket scales (winnersRounds-1)*2 rounds.  
**Why it matters:** Read carefully — round-by-round linking via `matchNumber`, losers-bracket consolidation rounds, and grand-finals reset match all looked correct in my spot read. But this is the kind of code that has subtle off-by-ones in edge cases (3-person bracket feeding, byes, 5-person pools).  
**Suggested fix:** Write a property-based test (e.g. fast-check) that asserts: every match has 0/1/2 competitors from registration; winners eventually resolve to one finalist; losers bracket resolves to one finalist; grand finals resolves to one champion. Currently the test coverage on this file (if any) is manual.

---

## Nit

### 7. Two stale `// NOTE: Must be defined BEFORE /:id route` comments
**File:** `src/client/pages/Competitors.tsx:366` (no, that's wrong) — let me recheck. Actually:  
**File:** `src/server/routes/competitors.ts:213, 227`  
**Pattern:** `// NOTE: Must be defined BEFORE /:id route to avoid being matched as an ID`  
**Why it matters:** Express router ordering trap — meta routes (`/meta/aggregates`, `/meta/schools`, `/meta/belts`) must come before the `/:id` catch-all. Comments are accurate and necessary. Just flagging them as important guard rails.  
**Suggested fix:** None — these are correctly defending against future refactors.

### 8. Excel template + mapping endpoints are intentionally public
**File:** `src/server/routes/competitors.ts:38, 47`  
**Pattern:** `router.get('/template', (_req, res) => { … }); router.get('/template/mapping', (_req, res) => { … });`  
**Why it matters:** These download the Excel import template and column-mapping JSON. They're public by design (so the public `/register` page can pre-fill columns), but the mapping endpoint leaks the system's expected column schema. Low impact — schema isn't secret.  
**Suggested fix:** None — leave as is.

### 9. Audit script false positives flagged but verified clean
Three routes initially appeared to lack role checks: `invites.ts POST /send`, `POST /resend/:id`, `DELETE /:id`. Manual read confirmed all three have `if (req.user!.role !== 'admin')` on the very next line. The audit script's `chunk[300]` window was too narrow. No action needed.

---

## Cross-cutting checks (passed)

### Soft-delete hygiene
- 22 `deletedAt` filters found across server routes
- All prisma.competitor / prisma.tournament / prisma.division queries in routes that read or list now filter `where: { deletedAt: null }`
- `analytics.ts`, `competitors.ts`, `tournaments.ts:91, 124, 287, 370, 481` all handle soft-delete correctly (post-fetch checks OR in-where filters)
- Mutations correctly preserve `deletedAt` via `update` (which doesn't clear it) — verified on `competitors.ts:347` (restore route sets `deletedAt: null`) and the soft-delete routes that set `deletedAt: new Date()`

### Auth coverage
- 115 route handlers across 11 route files
- Mutations (POST/PUT/PATCH/DELETE) have `authenticate` middleware
- Admin-only routes have `requireRole('admin', …)` or inline `if (req.user!.role !== 'admin')` checks
- Public routes (`/api/auth/*`, `/api/public/*`, `/api/competitors/template*`) are intentionally unauthenticated and well-documented
- Rate limiters (authLimiter, registrationLimiter, scoreboardLimiter, etc.) applied to the appropriate endpoints

### Input validation
- Routes using mutation accept input via `validateRequest(zodSchema)` middleware (visible in `auth.ts:51-52, 71, 105-128, etc.`)
- Magic-link code is 6-digit numeric, bounded between 100000-999999 (`auth.ts:126`)
- Tokens are 32-byte crypto random hex (`auth.ts:125`, `invites.ts:52`)

### Security
- **No `$queryRaw` / `$executeRaw` in any route** — all DB access goes through Prisma's parameterized queries. No SQL-injection vectors.
- **No `dangerouslySetInnerHTML` in src/client** — no XSS-injection vectors from user content
- **Email-enumeration-safe** on `/api/auth/request-magic-link` — always returns 200 with generic message in production (`auth.ts:116, 121`)
- **Dev-mode gating** — `if (process.env.NODE_ENV === 'production')` checks guard the JWT-secret, dev-token, and dev-mode auth bypass paths

### Race / staleness
- 3 `console.log` calls in production paths (covered above)
- 1 stale-closure bug in Scorekeeper keyboard handler (covered above)
- No other obvious stale-closure patterns in the audited files

---

## Feature inventory (live verification on https://tkd.ashbi.ca)

| Feature cluster | Frontend pages | Backend routes | Mounted? | Soft-delete safe? | Auth OK? | Live verified |
|---|---|---|---|---|---|---|
| Tournament Management | Tournaments, TournamentDetail, TournamentSettings, Schedule, Results, BracketEditor | tournaments.ts, brackets.ts, divisions.ts | ✓ | ✓ | ✓ | ✓ |
| Competitor & Registration | Competitors, PublicRegister, ManageRegistration, CheckRegistration, AcceptInvite | competitors.ts, public.ts | ✓ | ✓ | ✓ | ✓ |
| Scorekeeping & Check-in | Scorekeeper, CheckIn, DirectorDashboard, MatchTimer | brackets.ts (scoring), incidents.ts | ✓ | n/a (matches not soft-deletable) | ✓ | partial — Scorekeeper requires a live tournament to demo |
| Public Display | PublicScoreboard, PublicScoreboardBySlug, ParentScoreboard | public.ts (scoreboard) | ✓ | ✓ | n/a (public) | ✓ |
| Auth & User Management | Login, VerifyMagicLink, Profile, UserManagement, Trash | auth.ts, invites.ts | ✓ | ✓ (User soft-delete) | ✓ | ✓ |
| Fairness & Rules | FairnessRules, SchoolPortal | rules.ts, rule-engine.ts | ✓ | n/a (rules are scope of a tournament) | ✓ | ✓ (FairnessRules page renders, SchoolPortal shows 6 schools from seed) |

---

## Recommendations (priority order)

1. **Remove `console.log` in AuthContext.tsx:80** — 1-line change, eliminates noise
2. **Fix stale-closure in Scorekeeper useCallback:414** — change `readyMatches.length` → `readyMatches` in deps
3. **Gate `console.log` of magic-link codes in auth.ts:161** — wrap in `if (process.env.NODE_ENV !== 'production')`
4. **Demote `console.warn` in match-advancement.ts:150** to debug-level
5. **Add a property-based test for bracket-generator.ts** — fast-check on round/match invariants
6. **Delete the leftover `// console.log noise in production.` comment** in brackets.ts:266
7. (Optional) Consider whether `/api/competitors/template/mapping` should be admin-only — currently public by design, low risk

---

## What was NOT audited (scope limits)

- **Full correctness of bracket-generator.ts** — 946 lines of double-elimination logic; read structurally but not fuzzed
- **Prisma schema migrations** — only looked at the live schema, didn't check git history for lost migrations
- **Frontend performance / bundle size** — main bundle is 1.6 MB unminified / 488 KB gzipped, which is large but not unreasonable for an admin SPA
- **Mobile responsiveness** — checked dashboard and registration pages; didn't sweep all 27 pages
- **E2E test suite** — there is one (`tests/e2e/`), but I didn't run it; should be part of CI per `package.json`'s `test:e2e` script
- **Frontend accessibility deeper than what my recent fixes covered** — didn't run axe-core or full WCAG audit
- **Server-side memory / load testing** — pure static analysis, no runtime profiling

---

**Generated by:** Mavis orchestrator session `mvs_3615778779144a4a93986a0bdfc4661`  
**Files scanned:** 36 source files, 22,426 LOC  
**Live site verified:** https://tkd.ashbi.ca (Spring Championship 2026 seeded data, 20 competitors, 6 schools, 31 matches)
