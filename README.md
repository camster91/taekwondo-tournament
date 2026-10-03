# Bowin

Bowin is an organizer-only tournament SaaS. The active application is the rebuild in
[`replacement/`](replacement/README.md), live at https://tkd.ashbi.ca. Public pages
must carry organizer branding only; removing the current Bowin header/footer from
public results remains launch work.

The rebuild supports owner setup, password sign-in, staff invitations, tournaments,
manual divisions and competitor entry/check-in, single-elimination sparring,
scored-final patterns, ring bookings, and explicit publication/withdrawal of results.
See [launch status](docs/LAUNCH-STATUS.md) for limitations and priorities.

## Local development

Requires Node.js 22+ and a dedicated PostgreSQL database. From the repository root:

```sh
cd replacement
npm ci --ignore-scripts
npm test
```

For local operation, supply `DATABASE_URL` and matching `REBUILD_DATABASE_NAME`
(name beginning `bowin_rebuild_`), `APP_ORIGIN` (for example
`http://localhost:3001`), a locally generated `SETUP_TOKEN` of at least 32
characters, and `RELEASE_SHA` (the full 40-character Git revision).
Use `LOCAL_QA=true` only for local HTTP testing; leave it unset on live deployments.
The server does not load an environment file automatically.

```sh
npm run migrate
npm start
```

Open the configured origin (default port 3001). Setup/sign-in is at `/`.
Never connect local tests or migrations to production, archive, or old `taekwondo`
databases. Without `DATABASE_URL`, `npm test` skips the Postgres integration journey;
that journey requires a fresh migrated `bowin_rebuild_qa_*` database.

## Deployment and recovery

Coolify app **bowin-tkd** automatically deploys every push to `main` to
https://tkd.ashbi.ca using `docker-compose.rebuild-staging.yml`, with build context
`./replacement`. Despite its staging label, this is the live production service.
**Merging to main means a production deploy.** Pushes, merges and deployments require
Cameron's explicit approval. See [deployment and recovery](docs/DEPLOY.md).

The parked React/Prisma application is recoverable at tag `old-app-final`.
Retained historical docs may describe that retired application; they are not rebuild
feature or operational evidence.
