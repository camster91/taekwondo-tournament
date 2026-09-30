# Agent Handoff — Bowin (`camster91/taekwondo-tournament`)

**Product:** Bowin — organizer-only Taekwondo tournament SaaS. Public pages are **organizer-branded** (never Bowin watermark).
**Live / deploy:** Ashbi VPS + Traefik. **Ship gate = VPS verify**, not GitHub Actions.
**Owner:** Cameron (camster91)
**Last updated:** 2026-09-10

## Status

- **~95%** agent-shippable product path (see `docs/END_TO_END_SHIP_PLAN.md`).
- Keep-shipping **paused** until Cameron asks to resume (Cursor usage / billing).

## Read first

1. `docs/END_TO_END_SHIP_PLAN.md` — source of truth for % complete, recent PRs, Next Agent Track
2. This file — short resume card
3. Open issues on GitHub
4. `docs/DEPLOY.md`, `docs/contracts.md`, `docs/a11y-release-gates.md`, `docs/BUNDLE-BUDGETS.md`

## Recent ships (2026-09-10)

- #274 capacity/waitlist · #275 deploy docs · #276 scoreboard freshness · #277–#279 API contracts P1/P2
- #278/#281 a11y Slice 1–2 · #282 bundle budgets · #283 fail-closed deploy (Coolify retired) · #284 invite lifecycle tests

## Next agent track (when Cameron resumes)

Prefer **agent-shippable P1**, not Cameron-gated:

1. **#15** release-records docs (supersede stale PR #178 if still open)
2. **#63** compose host-port hardening (supersede stale PR #181 if still open)
3. More connected polish only if ship plan Next Agent Track says so

## Do NOT do without Cameron

- Stripe live products / keys (or stick to mark-paid)
- Legal counsel approval
- Production Bowin cutover / #119 VPS rollback drill / demo hostname
- Tutorial / case-study video
- #148 notifications decision · #192 ring staffing · SSO
- #128 a11y Slice 3+ (venue / full AT matrix)
- Contracts Phase 3 runtime Zod on hot paths (deferred)
- Agency BD / cold email

## Rules

- GitHub Actions ≠ ship gate
- Prefer `gh` over broken GitHub MCP
- World-class bar — not MVP slop
- No inventing secrets or client intent
