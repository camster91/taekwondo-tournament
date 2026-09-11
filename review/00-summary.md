# Bowin Tournament OS — Code Review Synthesis

**Date:** 2026-09-10
**Tracks:** 5 (security, backend, frontend, platform, tests+docs)
**Anchored against:** `AUDIT-REPORT-2026-06-26.md` (only regressions flagged, not re-reported)
**Reports:** [`01-security.md`](./01-security.md) · [`02-backend.md`](./02-backend.md) · [`03-frontend.md`](./03-frontend.md) · [`04-platform.md`](./04-platform.md) · [`05-tests-docs.md`](./05-tests-docs.md)

---

## Master verdict

**`NEEDS_FIXES_BEFORE_SHIP`** — not a clean ship. 6 CRITICAL items cluster into two themes, both with user-visible impact. The 2 platform HIGHs are silent regression factories. The 13 HIGH items are concrete and short to land.

## Counts (cross-track)

| Severity | Security | Backend | Frontend | Platform | Tests+Docs | **Total** |
|---|---|---|---|---|---|---|
| CRITICAL | 2 | 3 | 1 | 0 | 0 | **6** |
| HIGH | 2–3 | 5 | 3 | 2 | 1 | **13** |
| MEDIUM | 4 | 5 | 9 | 3 | 6 | **27** |
| LOW | 4 | 5 | 7 | 10 | 6 | **32** |

---

## Top 6 must-fix (the CRITICAL cluster)

### Two themes

1. **Data integrity / tenant isolation** — broken trust boundaries that any tenant-isolated SaaS needs to be defensible.
2. **Live updates are dead** — the headline live-scorekeeper feature has been silently broken since the cookie-auth migration.

### The list

1. **🔴 [SECURITY] Organization logo upload trusts client-supplied `mimeType` and stores SVG.** Handler allows `image/svg+xml`, base64-decodes the client payload with no magic-byte sniff, writes the buffer to disk, and Express serves it back as `image/svg+xml` at `/logos`. SVG carries event handlers and `javascript:` hrefs. The global `style-src 'unsafe-inline'` (see #5) makes this worse. One malicious director in tenant A can push an SVG that exfiltrates other users' state when rendered.
   → `src/server/routes/organization-logo.ts:14, 79-163`; static serve at `src/server/index.ts:262-266`

2. **🔴 [SECURITY] Demo user (`role='admin'`, no org) reads every tenant's data when `ENABLE_DEMO_LOGIN=1 && DEMO_ISOLATED_DATA=1`.** `.env.example` sells `DEMO_ISOLATED_DATA=1` as the operator's promise that the demo is isolated. The runtime honors the contract but not the promise: `checkTournamentAccess` short-circuits to `{ ok: true }` for any `admin` user; `enforceDemoCapability` only blocks 5 path prefixes; every other read across tournaments, divisions, brackets, competitors, analytics, SOS alerts, recommendations, incidents is reachable. A public demo on a multi-tenant install is a tenant-isolation break.
   → `src/server/routes/auth.ts:1150-1196`; `src/server/middleware/auth.ts:179-208, 466-469`

3. **🔴 [BACKEND] Schema ↔ migration drift on `Match` and others — the build is on a knife-edge.** The application code references `score1`, `score2`, `notes`, `scheduledTime`, `ringNumber` (the migration names). The schema renames them to `scores` (JSON), drops `notes`, renames `scheduledTime → scheduledAt`, drops `ringNumber`. With `prisma generate && tsc -p tsconfig.server.json` as the build, the code should fail to compile — it doesn't, so the dev DB is the actual source of truth and the migrations are decorative. Deploy from this branch is unsafe.
   → `prisma/schema.prisma:245-273` vs `prisma/migrations/20260710_init/migration.sql:128-150`; services at `bracket-correction.ts:23-60`, `match-advancement.ts:247`; routes at `public.ts:1227-1411`, `brackets.ts:53-59`

4. **🔴 [BACKEND] Public registration: TOCTOU + non-atomic, Stripe failure leaves user stranded.** `POST /api/competitors/import` and the public-portal path both create a `Competitor` without a uniqueness invariant on `(tournamentId, firstName, lastName, dateOfBirth)` — a same-second double-submit duplicates the competitor. The Stripe checkout step failure path leaves the registration as `paymentStatus: 'pending'` and never returns a payment URL. Two callers, same bug.
   → `src/server/routes/public.ts:320-585`; `src/server/routes/public-portal.ts:441-600`

5. **🔴 [BACKEND] WebSocket broadcast state is in-memory; no cross-instance fan-out.** `src/server/services/websocket.ts:21-35, 117-128` keeps a single-process `Map` of subscriptions. A second app instance will not see publishes from the first, and live bracket updates will silently disagree between the two. With Coolify / Docker replicas on the roadmap, this is a structural defect.
   → `src/server/services/websocket.ts:21-35, 117-128`

6. **🔴 [FRONTEND] `useBracketWebSocket` reads `localStorage` keys that no longer exist after the cookie-auth migration — live bracket updates are dead.** The hook calls `localStorage.getItem('bowin_session')` then `localStorage.getItem('tkd_auth_token')`. Both return `null` — the JWT lives in an `HttpOnly` cookie that JS cannot read. The hook warns to console and never opens. The headline live-scorekeeper feature is silently broken in production. Neither `Scorekeeper` nor `BracketEditor` surfaces this to the user.
   → `src/client/hooks/useBracketWebSocket.ts:36-43`

---

## The 2 silent-regression HIGHs (platform)

These don't fail loudly; they make the next incident invisible and the next deploy a connection-pool leak.

- **🔴 [PLATFORM] `ALLOWED_ENV` regex silently strips `SENTRY_DSN` and `SENTRY_ENVIRONMENT` on every deploy.** The Sentry SDK no-ops with no log line. First deploy after enabling Sentry works, every subsequent deploy drops it. There is no deploy-time assertion.
  → `scripts/deploy-production.sh:148`; `scripts/deploy-staging.sh:114`
  Fix: add both vars to the allowlist; add `grep -q '^SENTRY_DSN=' "$ENV_FILE"` near the existing required-key assertions.

- **🔴 [PLATFORM] Production live container started without `--init`; SIGTERM never reaches Node.** `Dockerfile:69` `CMD` is `sh -c "… && node server.js"`, so PID 1 is `sh`. `docker stop` SIGTERMs `sh`, which exits without forwarding. The graceful-shutdown block at `src/server/index.ts:333-340` is dead code on every production restart, deploy, and `docker stop`. In-flight scoreboard and billing-webhook requests 502; Prisma connection pool leaks one connection per restart.
  → `scripts/deploy-production.sh:206`; `src/server/index.ts:333-340`; `docker-compose.yml:44` already does this right
  Fix: add `--init` to the live and candidate `docker run` lines, OR change `Dockerfile:69` to a `tini` ENTRYPOINT.

---

## Cross-track patterns (worth fixing in passes, not one-offs)

- **Dead/silent failure modes:** live updates (item 6), Sentry on deploy, graceful shutdown, demo data isolation, magic-link race — the system keeps running but the safety net is gone. The "defense in depth" theme from the June audit has regressed in three of the four.
- **Contract drift:** schema vs migration vs code (`Match` fields); client `localStorage` keys vs cookie migration; API table in `README.md` lists 4 endpoints that 404. The codebase needs a single source of truth for each contract.
- **Docs that lie:** `README.md` API table (4× 404), `REQUIREMENTS.md` test count is 17× understated ("69" vs 1,178), `docs/a11y-release-gates.md` claims an axe scan the spec never runs. New operators and contributors will be misled.
- **Coverage gaps on the critical path:** bracket generator has no property-based tests (`fast-check` not in deps); `match-advancement.ts` (847 LOC) has no unit test; `bundle:check` and `qa:smoke` defined but not wired into CI.
- **PII through the cracks:** Sentry events include user email (no `beforeSend` scrubber); magic-link email failure path logs the email; org-logo error path can leak.

---

## Suggested fix order (smallest blast-radius first)

1. **Day 1 (hours):** Fix item 6 (WebSocket auth — switch to cookie on upgrade) and the 2 platform HIGHs. These unblock the user-facing feature (live updates) and stop the silent-regression factory.
2. **Day 2:** Fix item 1 (SVG out of the allowlist, magic-byte sniff). One-file change in `organization-logo.ts`.
3. **Day 2–3:** Fix items 2, 3, 4, 5 (demo isolation, schema/migration reconciliation, public-registration atomicity, WS cross-instance). Items 3 and 5 are structural; expect a Prisma migration of their own plus a Redis/PG-backed WS pubsub for item 5.
4. **Day 4–5:** Land the 13 HIGH items in priority order — security and data integrity first, then perf, then a11y, then test-coverage gaps.
5. **Day 5:** Wire `bundle:check` and `qa:smoke` into CI; add `noUncheckedIndexedAccess` to both `tsconfig*.json`; reconcile the README API table and the REQUIREMENTS test count.
6. **Day 6:** Doc-drift pass — fix the 4× README 404s, the 17× test count, the A11y doc claim, the dead `smoke-final.py`.

---

## Verdict per track

| Track | Verdict |
|---|---|
| Security | SHIP_BLOCKED (2 CRITICAL: logo SVG, demo data isolation) |
| Backend | NEEDS_FIXES_BEFORE_SHIP (3 CRITICAL: schema/migration drift, registration atomicity, WS in-memory) |
| Frontend | NEEDS_FIXES_BEFORE_SHIP (1 CRITICAL: live updates dead) |
| Platform | NEEDS_FIXES_BEFORE_SHIP (2 silent-regression HIGHs) |
| Tests+Docs | NEEDS_FIXES (1 HIGH: bracket-generator property tests) |

**Combined: `NEEDS_FIXES_BEFORE_SHIP`.** The 6 CRITICAL are all bounded, well-evidenced, and have remediation paths in their reports. None of the prior-audit RESOLVED items regressed (per the agents' regression checks).
