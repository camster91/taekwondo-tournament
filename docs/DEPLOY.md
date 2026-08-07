# Production deployment

The supported production topology is the full-stack Docker image plus PostgreSQL, deployed through Coolify. The Node process serves both the Vite build and `/api`; do not deploy the Vite client separately unless an explicit same-origin API gateway is configured.

## Required configuration

- `NODE_ENV=production`
- `DATABASE_URL`: PostgreSQL connection string with a unique production password
- `JWT_SECRET`: at least 32 random characters
- `ADMIN_SETUP_KEY`: random bootstrap key; remove it after the first administrator is created
- `ALLOWED_ORIGINS`: comma-separated HTTPS application origins
- `PUBLIC_APP_URL`: canonical HTTPS origin used in sign-in and registration-management emails
- `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`: verified production email configuration
- `RETENTION_PURGE_ENABLED=true`: enables the destructive soft-delete purge only after the retention policy is approved
- `SOFT_DELETE_RETENTION_DAYS`: whole days before soft-deleted competitors, tournaments, divisions, and incidents are permanently purged (default `7` when enabled)
- `REGISTRATION_CONSENT_VERSION`: immutable identifier for the approved notice/terms presented during registration
- `PRIVACY_NOTICE_URL`, `TOURNAMENT_TERMS_URL`: public HTTPS URLs for those exact approved versions; production startup fails if they are absent or non-HTTPS

Keep `ENABLE_DEV_AUTH`, `ENABLE_DEMO_LOGIN`, `ENABLE_E2E_AUTH_BYPASS`, and `RATE_LIMIT_DISABLED` unset in production. `POSTGRES_PASSWORD` is mandatory when using `docker-compose.yml`.

Automatic retention is deliberately disabled by default. Verify a backup and obtain operator/legal approval before enabling it; expired records are deleted at startup and then once per day and cannot be restored from the Trash view.

## Release sequence

1. Back up PostgreSQL and verify that the backup can be read.
2. Build and test the exact commit: `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`.
3. Review `npm audit` and the bounded exception in `SECURITY.md`.
4. Run `npx prisma migrate deploy` against a staging database restored from production-compatible data.
5. Deploy the immutable image. The Docker entrypoint runs `prisma migrate deploy` before starting Node.
6. Require `/api/health` and `/api/health/ready` to return HTTP 200 before routing traffic.
7. Smoke-test admin sign-in, invitation email, tournament creation, public registration, private registration-management link, public scoreboard key rotation, check-in, scoring, and result correction.
8. Confirm the previous image and pre-deploy database backup remain available for rollback.

## Rollback

Application rollback means redeploying the previous immutable image. Database rollback is restore-based because Prisma production migrations are forward-only. Never restore over the live database without first retaining a snapshot of the failed state. Validate tenant counts and a representative tournament after restoration.

## GitHub and Coolify

CI runs on pushes and pull requests to `main`. Deployment requires `COOLIFY_URL`, `COOLIFY_TOKEN`, and `COOLIFY_APP_UUID` repository secrets. A non-2xx/3xx Coolify response fails the workflow; a queued deployment is not proof that the application became healthy, so verify the readiness endpoint and Coolify rollout status separately.
