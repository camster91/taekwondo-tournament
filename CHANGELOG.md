# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
as best a pre-1.0 multi-tenant SaaS can: every shipped tag is the canonical
artifact, and the changelog is the source of truth for what changed between
artifacts.

## [Unreleased]

Changes merged to `main` since v1.0.0-pilot.1 and not yet deployed.
This section itemizes the September 2026 review work (#295 onward);
earlier post-pilot PRs are in the git history.
Production still needs the pending migrations listed in CLAUDE.md
("Deployment → Migration requirement").

### Security

- Tenant isolation: organization users see only their organizations and
  explicit grants; users with no organization see only the legacy pool;
  competitors are scoped by organization (#295).
- `/ws/brackets` authenticates with the session cookie (no query-string
  token), checks access per subscription, and re-checks open sockets
  every 60 s so logout, deactivation or revoked access cuts them off
  (#299, #300).
- Sentry / GlitchTip events are scrubbed of PII and credentials (#299).
- Per-user rate limits on bracket writes and rebuilds (#299).
- Logo uploads accept only real PNG/JPEG/GIF/WebP; logo changes need
  director-level organization membership (#299).

### Fixed

- Restored `prisma/schema.prisma` and added the missing migrations
  (`registration_waitlist_fields`, `tournament_created_by`,
  `competitor_organization`) so a fresh `migrate deploy` matches the
  schema (#295).
- Bracket advancement, byes, result corrections and placements (#295).
- Public registration, scoreboard and checkout fixes; schedules that do
  not fit the day list unscheduled divisions instead of clamping (#295).
- The soft-delete retention purge runs in one transaction (#299).
- Multi-sport: every screen, PDF, certificate and confirmation email
  uses the tournament's sport event names, and the Scorekeeper timer
  follows the sport's bout/forms format (#301, #305).

### Changed

- Scorekeeper and Bracket Editor show a notice when live updates stop
  (#300).
- CI uploads Playwright traces on failure; e2e login waits for the
  session cookie (#304).
- Dependency updates (#298).
- Demo and custom-domain fixes; e2e passes on all four CI browsers (#297).
- CLAUDE.md, CONTRIBUTING.md and the PR template describe the current
  auth model, CI gates and delivery workflow (#302, this change).

---

## [v1.0.0-pilot.1] — 2026-08-07

The first pilot release of the Bowin-branded managed SaaS, run live at
the Newton's 2026 Championship. Owner-authorized after local
473-test, 120-browser, staging, backup/restore, TLS, email, and
monitoring validation.

### Added

- Professional Bowin brand system (typography, color tokens, component
  primitives) applied across director, scorekeeper, and public surfaces.
  PR #159 / commit `256ba22`.
- Public scoreboard link sharing via per-tournament `publicSlug` (the
  rotation path is wired; the slug is generated on demand from the
  tournament settings UI).
- Magic-link authentication for parents and staff (32-byte hex token +
  6-digit OTP, 10-minute TTL, 10-attempt brute-force budget).
- Demo-login path for the staging environment (4-hour admin JWT,
  gated by `ENABLE_DEMO_LOGIN=1`).
- Tournament lifecycle: draft → registration → in_progress → completed,
  with soft-delete and trash recovery.
- Auto-categorization engine: place competitors into divisions by belt,
  age, weight, and gender without manual assignment.
- Double-elimination and single-elimination bracket generators with
  size-aware position seeding.
- Real-time scorekeeper: per-match rounds, penalties, undo, and bracket
  advancement on result confirmation.
- Public registration: 5-step parent flow with consent versioning,
  privacy acceptance, and rules attestation captured per registration.
- Per-registration management link returned to the parent at issue
  (3-factor legacy look-up; replaced in v1.1 by the bearer-token
  refactor tracked in #118).
- Public result export: PDF, CSV (school standings, all by division,
  all by competitor), Excel, and per-medal certificate print.
- Stripe billing hooks: starter and pro plans, webhook handler with
  signature verification, sandbox mode for E2E.
- Organization / multi-tenant model with member roles and
  tournament-scoped access grants.
- Invitation flow: email-based staff invitations with 7-day expiry and
  audit trail.

### Security

- JWT (HS256) auth with `iss` / `aud` pinning and 7-day default TTL.
- Per-IP rate limiting on auth and registration endpoints
  (10/15min registration, 5/15min auth, 30/min scoreboard).
- bcrypt password hashing for invited staff.
- Audit log for every match update (previous + new state, user, reason).
- Hardcoded JWT fallback secret removed (`auth.ts` now hard-exits in
  production if `JWT_SECRET` is unset).
- `xlsx` ReDoS / prototype-pollution and `vite` path-traversal /
  websocket-file-read HIGH advisories patched in a follow-up commit
  (closed #18; `npm audit` now shows zero high-severity findings).
- The legacy 3-factor management-token look-up remains in this pilot
  (first 8 chars of UUID + last name + DOB). It is **scheduled for
  removal in v1.1** via the bearer-token refactor in #118.

### Changed

- Bowin brand applied to all visible surfaces. Internal product name
  `taekwondo-tournament` retained for repo, env, and route paths.
- Prisma 6 → Prisma 7 (driver-adapter API, no SQLite path).
- React 18 → React 19 + React Router 7.
- Tailwind v3 → Tailwind v4.
- Server entry: ts-node-dev → tsx watch (faster HMR).
- Excel import: column auto-mapping with case-insensitive header
  detection, scope-aware error messages, dry-run preview.

### Removed

- SQLite dev path (production is PostgreSQL only; mirrored in
  `prisma.config.ts`).

### Fixed (since 1.0.0-pilot.0)

- TournamentDetail page crash on day-of view when the underlying
  response included a non-JSON-serializable value (#42 closed by
  PR #160).
- Tournament QA release blockers (PR #160): a sweep of issues
  blocking the pilot, including bracket editor stale-render,
  scorekeeper round-timer drift, division-rename conflict, and
  public scoreboard link rotation. Each had a regression test
  added in the same PR.

### Out of scope for this pilot

- Multi-sport (Karate, Judo, etc.) — sport-profile scaffolding is
  in place; the v1 release is TKD-only.
- Live-update push architecture — polling satisfies the pilot's
  freshness targets; push is a v2 decision (#126).
- Self-serve director-side rotate of the management token — the
  parent can request a fresh link from the director; a rotate
  endpoint is tracked as a follow-up to #118.
- The dependency-scanner, coverage-baseline, and migration /
  container smoke CI gates — added in #19 and the corresponding
  workflow PR but blocked on branch-protection configuration.

### Verified

- Local unit suite: 481 tests, 0 flake.
- Playwright E2E: 120 browser tests across chromium, firefox, webkit
  (login, public register, public register a11y, checkin,
  scorekeeper a11y, tournament create, account lifecycle, billing
  webhook, observability, organization lifecycle / settings,
  responsive matrix).
- Backup / restore rehearsal on the staging Postgres.
- TLS, email (Mailgun dev-mode magic-link console), and monitoring
  (Sentry + uptime) verified on the staging host.
- Manual walkthrough on the Newton's 2026 Championship data.
