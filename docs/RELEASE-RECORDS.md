# Release Records — Bowin Tournament OS

**Product:** Bowin Tournament OS
**Repository:** `camster91/taekwondo-tournament`
**Current version:** `1.0.0` (from `package.json` line 3)
**Last release tag:** `v1.0.0-pilot.1` — `1894c4e Release Bowin managed SaaS pilot` — **2026-08-07**
**Last deploy date:** **Not yet tagged.** All `main` commits since `v1.0.0-pilot.1` (8 SH-1..SH-8 ship-blockers + 2 supporting commits) are sitting on `main` and have **not** been cut into a new release tag. Production has not been re-cut since `v1.0.0-pilot.1`.

---

## Releases

| Date | Version | What's shipped | Deployed to | Smoke result |
|------|---------|----------------|-------------|--------------|
| 2026-08-07 | `v1.0.0-pilot.1` (commit `1894c4e`) | "Release Bowin managed SaaS pilot" — the managed-pilot cut. Includes everything in `main` up to PR #237 (security fixes, support isolation, demo hardening, legal pages, marketing launch, public portal, billing, etc.) — see `git log v1.0.0-pilot.1` for the full list | `https://tkd.ashbi.ca` (HH VPS) | Green at tag time; release evidence recorded in `docs/RELEASE-EVIDENCE-2026-08-13.md` |
| 2026-09-10 | **Not yet tagged** | All 8 SH-1..SH-8 ship-blocker fixes + SOSAlert type reconciliation + `docs/AGENT_HANDOFF.md` (commits `cc07122`..`6a2d60a` on `main`). No `v1.x.y` tag exists. | **Not deployed.** | **Not run** — release tag is required before re-cut. |

---

## What's shipped since `v1.0.0-pilot.1` (the 9 most recent release-bound commits on `main`)

Listed in reverse-chronological order (newest first) — these are the commits the next release will contain. Source: `git log --oneline v1.0.0-pilot.1..main`.

- `6a2d60a` — **fix(backend):** type `SOSAlert.ringNumber` back to legacy `int` (out of SH-4 scope)
  — area: backend / SOS alerts — `src/client/pages/DirectorDashboard.tsx`, `prisma/schema.prisma`
- `92a22be` — **fix(backend):** reconcile `Match` schema ↔ migration, update call sites *(closes SH-4)*
  — area: backend / schema migration — `prisma/schema.prisma`, `prisma/migrations/20260910_sh4_match_reconcile/`, `src/server/services/bracket-correction.ts`, `src/client/pages/Scorekeeper.tsx`
- `52d6a3a` — **fix(backend):** public registration atomicity — unique constraint + Stripe failure rollback *(closes SH-5)*
  — area: backend / public registration — `src/server/routes/public.ts`, `prisma/schema.prisma`, `prisma/migrations/20260910_competitor_unique_sh5/`
- `eb985d4` — **fix(security):** scope demo user to synthetic tenant, remove global admin bypass *(closes SH-3)*
  — area: security / multi-tenant — `src/server/middleware/auth.ts`, `src/server/routes/auth.ts`, `prisma/seed.ts`
- `7469358` — **fix(platform):** Postgres `LISTEN`/`NOTIFY` for cross-instance WebSocket fan-out *(closes SH-6)*
  — area: platform / realtime — `src/server/services/ws-pubsub.ts`, `src/server/index.ts`
- `84d3595` — **fix(platform):** allow `SENTRY_*` in deploy env + required-var assertion *(closes SH-7)*
  — area: platform / deploy — `scripts/deploy-production.sh`, `scripts/deploy-staging.sh`, `scripts/lib/assert-required-env.sh`
- `1bfede1` — **fix(platform):** add `--init` to live container, restore graceful shutdown *(closes SH-8)*
  — area: platform / container — `Dockerfile`, `docker-entrypoint.sh`, `scripts/deploy-production.sh`
- `fd9d7b5` — **fix(security):** reject SVG uploads, magic-byte sniff image type *(closes SH-2)*
  — area: security / uploads — `src/server/routes/organization-logo.ts`
- `cc07122` — **fix(frontend):** switch WebSocket to cookie auth — restore live bracket updates *(closes SH-1)*
  — area: frontend / realtime — `src/client/hooks/useBracketWebSocket.ts`

---

## Pending release (8 ship-blockers in this release, not yet pushed)

All 8 SH-blocker fixes are committed to `main` but **not yet in a tagged release** and **not yet deployed to production**. They must ride together — each SH-X is a piece of the same release-bound risk envelope (security, atomicity, schema reconciliation, realtime, deploy fail-closed, container lifecycle).

| ID | Commit | Title | Risk class | Cross-deps |
|----|--------|-------|-----------|-----------|
| **SH-1** | `cc07122` | WebSocket cookie auth (frontend) | Realtime correctness — public scoreboard went stale without it | SH-6 |
| **SH-2** | `fd9d7b5` | SVG upload rejection + magic-byte sniff | XSS / file-upload security | — |
| **SH-3** | `eb985d4` | Demo user scoped to synthetic tenant | Multi-tenant isolation — global-admin bypass removed | — |
| **SH-4** | `92a22be` | Match schema ↔ migration reconciliation | DB schema drift — required for the new `Match.scores` (JSON) shape and `ring` (String) | SH-8 (deploy fail-closed surfaces schema mismatches) |
| **SH-5** | `52d6a3a` | Public registration atomicity + Stripe rollback | Data integrity — duplicate competitors + orphaned Stripe charges on failure | — |
| **SH-6** | `7469358` | Postgres `LISTEN`/`NOTIFY` cross-instance fan-out | Realtime scalability — single-instance WebSocket was the old bottleneck | SH-1 |
| **SH-7** | `84d3595` | Required-env assertion + `SENTRY_*` allow-list | Deploy fail-closed — missing `SENTRY_DSN` would have silently deployed a broken app | SH-8 |
| **SH-8** | `1bfede1` | `--init` on container + graceful shutdown | Container lifecycle — `docker stop` killed Node before it could drain WebSockets / SIGTERM the pubsub | SH-6, SH-7 |

Plus one supporting fix (in scope, not a ship-blocker) — `6a2d60a` reverts the `SOSAlert.ringNumber` type change that leaked out of the SH-4 scope.

The SH-X commit messages and code references are the source of truth; the decision-record trail for SH-3, SH-6 lives under `docs/decisions/0122-tenancy-model.md` and `docs/decisions/0126-live-update-sla.md`.

---

## Pre-release gate (Cameron must complete before tagging)

These are the items #15 (this issue) calls out as still open before the next release is signed off. None are code/agent work — they all need a Cameron action against a live vendor, a counsel mailbox, or a real human. Sourced from `docs/END_TO_END_SHIP_PLAN.md` "What Cannot Hit 100% Without Cameron" + the `docs/AGENT_HANDOFF.md` "Do NOT do without Cameron" list.

### Legal & compliance

- [ ] **Privacy policy final sign-off** (counsel) — `docs/END_TO_END_SHIP_PLAN.md` line 423
- [ ] **Terms of service final sign-off** (counsel) — line 424
- [ ] **COPPA compliance audit** (counsel) — line 425
- [ ] **Insurance** — general liability + cyber liability — line 426

### Payments & accounts

- [ ] **Stripe account setup** (dashboard) — line 430
- [ ] **Stripe merchant underwriting approval** (3–7 day SLA, Cameron must respond to verification requests) — line 431
- [ ] **Sales tax / nexus registrations** (accountant) — line 432
- [ ] **Stripe payout bank account connected** — line 433

### Operations & vendor setup

- [ ] **Mailgun sender-domain verification** (DNS: SPF / DKIM / `mail.from`) — line 445
- [ ] **Live Mailgun delivery test** for staff-invitation flow (real recipient, real headers, bounce path) — `docs/END_TO_END_SHIP_PLAN.md` lines 118–119
- [ ] **Email template audit** across Gmail, Outlook, Apple Mail, mobile — line 119
- [ ] **Live rollback drill on the HH VPS** (validate the < 5 min RTO target) — line 131
- [ ] **Real production deploy execution** with full cutover validation (this is the actual `v1.0.0-pilot.2` cut) — line 132
- [ ] **Deployment evidence JSON audit** (verify no secrets leak into `deploy.json`) — line 133
- [ ] **Domain purchase** if switching from `tkd.ashbi.ca` to `bowin.io` / `bowin.app` — line 444

### Product & marketing

- [ ] **First paying customer** (or first manual `mark-paid` pilot organizer) — line 450
- [ ] **Case study interviews** with 3 on-record pilot customers — line 451
- [ ] **Demo video voiceover** (~2 min walkthrough) — line 452
- [ ] **Brand final approval** — logo, colors, messaging sign-off — line 453

### Ship gate

- [ ] **Go/no-go decision** to enable paid checkout in production — line 457
- [ ] **Launch announcement** — social, email list, Product Hunt — line 458

**Estimated Cameron time** for the full gate: **40–60 hours over 6 weeks** (`docs/END_TO_END_SHIP_PLAN.md:460`).

---

## How to cut the next release (when the gate above is green)

1. Confirm the 8 SH-X commits above are still on `main` and unreverted. `git log --oneline v1.0.0-pilot.1..main` should still show `cc07122`..`6a2d60a` at HEAD.
2. Run `npm test` and `npm run typecheck`; both must be green. Note: at the time of writing (2026-09-10), `npm test` reports 12 test files failing (12 tests) on `main` — primarily `src/server/services/schedule-delay-propagation.test.ts` (Postgres `recommendation.updateMany` undefined on the synthetic tenant) and a handful of pre-existing infra-dependent failures. **These must be triaged and either fixed or quarantined before the next tag.**
3. Tag: `git tag -a v1.0.0-pilot.2 -m "Ship-blocker release: SH-1..SH-8 + SOSAlert type-fix"` from the `6a2d60a` commit.
4. Push the tag (not `main` alone): `git push origin v1.0.0-pilot.2`.
5. Trigger the production cutover via `scripts/deploy-production.sh` (see `docs/DEPLOY.md`).
6. Run `npm run qa:smoke` against `https://tkd.ashbi.ca` post-cutover; record the JSON in `docs/RELEASE-EVIDENCE-<date>.md`.
7. Add the new row to the **Releases** table above.

> **Reminder:** per `docs/AGENT_HANDOFF.md`, **GitHub Actions ≠ ship gate.** The `npm run qa:smoke` against the live VPS is the ship gate, not CI.
