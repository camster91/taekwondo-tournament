# Bowin deployment and recovery

Updated 2026-10-03 from repository configuration and owner-supplied operational facts.
No live infrastructure was inspected during this cleanup.

## Live deployment

Coolify application **bowin-tkd** serves https://tkd.ashbi.ca and automatically deploys
on every push to `main`. Merging to main is a production deployment; obtain Cameron's
explicit approval before pushes, merges or deploys.

The live configuration is [`docker-compose.rebuild-staging.yml`](../docker-compose.rebuild-staging.yml).
The staging label does not mean a separate test environment. Both Node services build
from `./replacement` using its runtime Docker target and the supplied `SOURCE_COMMIT`.
PostgreSQL 16 must become healthy, then the `migrate` service runs SQL migrations;
the `app` service starts only after migration succeeds. The live database is
`bowin_rebuild_staging`, stored in the `bowin_rebuild_staging_database_v2` Compose volume
(Coolify prefixes the deployed volume name). Preserve this data during configuration changes.

Coolify supplies database connection/configuration, canonical `APP_ORIGIN`, setup token
and source revision. Manage values through the operator configuration; never copy
secrets into docs, logs or commits. Never point the rebuild at the old `taekwondo` DB.
Traefik routes the production hostname through Coolify's application route.

Readiness is `GET /api/health/ready`; it checks database access and includes the source
revision. After an approved release, verify HTTPS readiness, expected full revision,
sign-in and an authenticated tournament journey. Green CI alone is not a live ship gate.

[`docker-compose.rebuild-production.json`](../docker-compose.rebuild-production.json)
is preparation for checked immutable images and separate provisioning, migration-owner
and runtime roles. It is not the live deployment. The rebuild image checks do not yet
establish that Coolify deploys only their checked digest.

## Rollback

Coolify retains previous images. An approved rollback uses the previous known-good
images/release through Coolify, followed by readiness/revision and authenticated workflow
checks. Keep app and migration image identities together. Previous images alone do not
undo database migrations: check schema compatibility before rollback and restore data
only through an approved, rehearsed recovery plan. A timed live rollback drill remains open.

## Backups

Nightly local backups of `bowin_rebuild_staging` run at **03:25 America/Toronto (ET)**
through `/usr/local/sbin/bowin-rebuild-backup.sh` and
`/etc/cron.d/bowin-rebuild-backup`. Dumps are age-encrypted under
`/var/lib/bowin-backups` with **14-day retention**.

There is **no off-host copy yet**. A freshness alert, isolated decrypt-and-restore drill,
and agreed recovery point/time objectives remain required. A restore drill must verify
migrations, accounts, latest accepted scores and publication before any live recovery.
Do not expose encryption keys or backup contents, and do not use the live database for drills.

Historical root-app backup/deploy instructions in other retained docs are recovery
references only. This page is the current rebuild deployment runbook.
