# Ship handoff

> **Read `docs/AGENT_HANDOFF.md` first** for product status, next agent track, and Cameron-gated work.

# AGENTS.md

See `CLAUDE.md` for the full codebase guide (architecture, routes, DB
models, conventions). This file adds environment/operational notes.

## Cursor Cloud specific instructions

This is a full-stack app: Vite React SPA (`:5173`) that proxies
`/api/*` to an Express + Prisma backend (`:3001`) backed by
PostgreSQL. Standard commands live in `package.json` scripts and
`CLAUDE.md` ("Running locally"); don't duplicate them here.

### Startup (services are NOT auto-started)

The update script only refreshes npm deps (`npm install`, which runs
`prisma generate` via `postinstall`). PostgreSQL and the dev servers
must be started manually each session:

1. Start PostgreSQL (systemd is offline in this VM, so use the
   cluster wrapper directly, not `systemctl`):
   ```bash
   sudo pg_ctlcluster 16 main start
   ```
   The `taekwondo` role + `taekwondo_tournament` database already
   exist in the VM snapshot (matching `DATABASE_URL` in `.env`).
2. For disposable local development only, sync a schema change with
   `npm run db:push`. Production and CI use the checked-in `prisma/migrations`
   through `prisma migrate deploy`; release-bound schema changes must include
   and validate a migration rather than pushing the schema directly.
3. Start dev servers: `npm run dev` (concurrently runs Vite `:5173`
   + `tsx watch` server `:3001`). Health check: `curl
   http://localhost:3001/api/health/ready` → `{"status":"ok","db":"ok"}`.

### Environment / `.env`

- A local `.env` is committed-out (gitignored). Required keys:
  `DATABASE_URL`, `JWT_SECRET`, `NODE_ENV=development`. Leaving the
  `MAILGUN_*` keys blank puts auth in **dev-mode**: magic-link
  codes are logged to the server console (and not emailed), which
  is fine for local testing.
- `ENABLE_DEMO_LOGIN=1` enables the one-click "Try the demo" button
  (`POST /api/auth/demo`), the fastest way to get an admin session
  for manual/E2E testing. On a fresh DB there are no users, so
  either use the demo login or the magic-link dev-mode flow.

### Testing notes

- Unit: `npm test` (vitest, no DB/server needed).
- Lint / typecheck: `npm run lint`, `npm run typecheck`.
- E2E: `npm run test:e2e` (needs Postgres running + Chromium via
  `npm run test:e2e:install`). Playwright starts its **own** dev
  server with `ENABLE_E2E_AUTH_BYPASS`/`RATE_LIMIT_DISABLED`, and
  reuses an already-running server on `:5173` if present — but a
  server started plainly via `npm run dev` lacks those env vars, so
  stop it first to let Playwright manage the webServer for E2E.
- E2E requires `ENABLE_DEMO_LOGIN`, `ENABLE_DEV_AUTH`, and
  `ENABLE_E2E_AUTH_BYPASS` (set by `tests/e2e/global-setup.ts` +
  `playwright.config.ts` webServer.env). Demo login has no
  NODE_ENV fallback — without the flag the route is not mounted.
- `loginAsDemo` skips the onboarding tour via
  `bowin_tour_completed` localStorage so the tour overlay does
  not intercept clicks on authenticated pages.
