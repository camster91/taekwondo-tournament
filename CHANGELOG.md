# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
as best a pre-1.0 multi-tenant SaaS can: every shipped tag is the canonical
artifact, and the changelog is the source of truth for what changed between
artifacts.

## Known gaps in this release

These are tracked in the open issue tracker and will be addressed before
the 1.0.0 stable release:

- **CI is not yet a release gate.** Lint, typecheck, unit tests, build, and
  Playwright subset run on every PR, but the migration smoke check, the
  container smoke check, and the required-status-check branch protection
  on `main` are tracked separately (#19) and need maintainer action
  (Settings → Branches) to take effect.
- **GitHub Actions billing is currently blocking the `Build and Push
  Image` check** across the repo. The release artifact for v1.0.0-pilot.1
  was built and validated locally; the publish step is the only
  outstanding concern, and it is an external (GitHub billing) issue,
  not a code issue. Fix: https://github.com/settings/billing.
- **Public deploy URLs are not yet in the changelog** — they are owned
  by the production ops team and reconciled per-release.

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
