# Bowin codebase guide

Read [launch status](docs/LAUNCH-STATUS.md) first. The active app is `replacement/`,
live at https://tkd.ashbi.ca. The parked root React/Prisma app is at `old-app-final`.
Historical docs do not establish rebuild features.

## Architecture

- Node.js 22+, ES modules and Express in `replacement/src/app.mjs` / `server.mjs`.
- Plain JavaScript UI in `replacement/src/public/`: `app.js`, `index.html`, `style.css`.
- PostgreSQL through `pg`; sequential SQL migrations in `replacement/migrations/`,
  run by `replacement/src/migrate.mjs` with transactional migration history checks.
- Route modules cover tournaments/registrations/brackets, invitations, patterns,
  schedules and explicit public publication. `security.mjs` handles auth primitives.
- Domain and optional Postgres integration tests are in `replacement/test/`.

Setup/sign-in is `/`; invite acceptance is `/accept-invite`; public results are
`/results/:publicId`. Readiness is `/api/health/ready`. Authentication uses password
hashes and hashed session tokens with HttpOnly/Secure/SameSite Strict cookies;
mutations require the canonical Origin. Keep server role/tenant checks authoritative,
public projections explicit, and mutations/audit records transactional.

## Local commands

```sh
cd replacement
npm ci --ignore-scripts
npm test
npm run migrate
npm start
```

Migration/start require `DATABASE_URL`, matching `REBUILD_DATABASE_NAME` beginning
`bowin_rebuild_`, `APP_ORIGIN`, a setup token of at least 32 characters and full
40-character `RELEASE_SHA`. The server defaults to port 3001 and does not auto-load
an env file. `LOCAL_QA=true` permits local HTTP cookies only; never enable it live.
Tests skip the DB journey without `DATABASE_URL`; integration requires a fresh,
migrated, disposable `bowin_rebuild_qa_*` DB. Never use live/archive data for QA.
There are no root build commands or React/Prisma workflows.

## Deployment and working rules

Coolify **bowin-tkd** builds `./replacement` through
`docker-compose.rebuild-staging.yml`; Postgres health precedes migration success,
which precedes app startup. Its `bowin_rebuild_staging` DB is the live production DB.
The production JSON Compose is preparation, not the active deployment.
See [DEPLOY.md](docs/DEPLOY.md) for backups, rollback and verification.

- Organizer branding only on public pages; no Bowin watermark. Current shell branding
  is an open launch gap, not an approved public design.
- Never point the rebuild at the old `taekwondo` database or run legacy migrations.
- Every main push auto-deploys production. No direct main pushes; Cameron must explicitly
  approve commits/pushes, branches/PRs, merges, deploys, deletions and operational changes.
- Never read, print or commit secrets. Do not send messages or spend without approval.
- Read Cameron's Ashbi build guide before planning/coding/reviewing; match existing
  patterns, make small safe changes, and verify affected user workflows.
- Describe only implemented features and checks actually performed. Readiness and CI
  success alone do not prove real-event readiness.
