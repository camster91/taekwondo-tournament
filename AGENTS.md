# Bowin agent instructions

Read [docs/LAUNCH-STATUS.md](docs/LAUNCH-STATUS.md) first, then
[CLAUDE.md](CLAUDE.md) for architecture and commands. The active app is the live
rebuild in `replacement/`; the retired root app is recoverable at `old-app-final`.

## Stack and local work

Node.js 22+ / Express ES modules in `replacement/src/`, plain JavaScript UI in
`replacement/src/public/`, PostgreSQL via `pg`, SQL migrations in
`replacement/migrations/`. From `replacement/`: `npm ci --ignore-scripts`,
`npm test`, `npm run migrate`, `npm start`. Supply the configuration documented in
[README.md](README.md). DB integration tests require a fresh migrated
`bowin_rebuild_qa_*` database; otherwise that journey is skipped.
Never point the rebuild at the old `taekwondo` DB or live/archive data for tests.

## Product and operational rules

- Organizer-only tournament SaaS; organizer branding only on public output, never a
  Bowin watermark. The current public shell branding remains work to fix.
- Coolify **bowin-tkd** builds `./replacement` with `docker-compose.rebuild-staging.yml`.
  Despite the label, `bowin_rebuild_staging` is live at https://tkd.ashbi.ca.
  Migrations must succeed before app startup; readiness is `/api/health/ready`.
- Main auto-deploys production on every push. No direct main pushes. Cameron's explicit
  approval is required for commits/pushes, branches/PRs, merges, deploys, deletions,
  spending, permission changes and sending messages. Default to read-only unless work
  is authorized. See [docs/DEPLOY.md](docs/DEPLOY.md).
- Never read, print or commit secrets or credential files. Preserve live data.
- Before planning/coding/design/review, read the Ashbi build guide at
  `/home/box/.codex/skills/ashbi-build-guide/SKILL.md` (also distributed at
  `~/.agents/skills/ashbi-build-guide/SKILL.md`). Match patterns, make small safe steps,
  and verify affected flows on mobile/desktop for UI changes.
- Do not claim tests, deployment or live verification unless performed. Historical
  docs and old-app issues do not count as rebuild implementation evidence.
- Keep updates short; report times in America/Toronto.
