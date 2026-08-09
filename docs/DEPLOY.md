# Production deployment

The supported production topology is the full-stack Docker image plus PostgreSQL, deployed through Coolify. The Node process serves both the Vite build and `/api`; do not deploy the Vite client separately unless an explicit same-origin API gateway is configured.

## Required configuration

- `NODE_ENV=production`
- `DATABASE_URL`: PostgreSQL connection string with a unique production password
- `JWT_SECRET`: at least 32 random characters
- `METRICS_TOKEN`: at least 32 random characters used only by the private `/api/internal/metrics` collector
- `ADMIN_SETUP_KEY`: random bootstrap key; remove it after the first administrator is created
- `ALLOWED_ORIGINS`: comma-separated HTTPS application origins
- `PUBLIC_APP_URL`: canonical HTTPS origin used in sign-in and registration-management emails
- `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`: verified production email configuration
- `RETENTION_PURGE_ENABLED=true`: enables the destructive soft-delete purge only after the retention policy is approved
- `SOFT_DELETE_RETENTION_DAYS`: whole days before soft-deleted competitors, tournaments, divisions, and incidents are permanently purged (default `7` when enabled)
- `REGISTRATION_CONSENT_VERSION`: immutable identifier for the approved notice/terms presented during registration
- `PRIVACY_NOTICE_URL`, `TOURNAMENT_TERMS_URL`: public HTTPS URLs for those exact approved versions; production startup fails if they are absent or non-HTTPS
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_STARTER_PRICE_ID`, `STRIPE_PRO_PRICE_ID`: configure all four to enable self-service billing; omit them for a managed-invoice pilot

Keep `ENABLE_DEV_AUTH`, `ENABLE_DEMO_LOGIN`, `ENABLE_E2E_AUTH_BYPASS`, and `RATE_LIMIT_DISABLED` unset in production. `POSTGRES_PASSWORD` is mandatory when using `docker-compose.yml`.

### Isolated public showcase

The public showcase is a separate deployment profile, never a customer or mixed-use production database. It requires both `ENABLE_DEMO_LOGIN=1` and `DEMO_ISOLATED_DATA=1`; `DEMO_RATE_LIMIT_MAX` defaults to 30 sign-ins per IP per 15 minutes. Production fails closed by leaving the demo route unmounted when the isolation attestation is absent.

After migrations and readiness succeed, reset only the marker-protected fabricated tenant with:

```sh
DEMO_RESET_CONFIRM=bowin-resettable-showcase-v1 npm run demo:reset:production
```

The command additionally requires `DEMO_ISOLATED_DATA=1` in its environment. It refuses an absent or mismatched attestation and will not replace an organization whose canonical slug lacks the expected marker. Never persist `DEMO_RESET_CONFIRM` as a normal application secret.

Automatic retention is deliberately disabled by default. Verify a backup and obtain operator/legal approval before enabling it; expired records are deleted at startup and then once per day and cannot be restored from the Trash view.

## Release sequence

1. Back up PostgreSQL and verify that the backup can be read.
2. Build and test the exact commit: `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`.
3. Review `npm audit` and the bounded exception in `SECURITY.md`.
4. Run `npx prisma migrate deploy` against a staging database restored from production-compatible data.
5. Deploy the immutable image. The Docker entrypoint runs `prisma migrate deploy` before starting Node.
6. Require `/api/health` and `/api/health/ready` to return HTTP 200 before routing traffic, then verify `/api/internal/metrics` rejects anonymous requests and succeeds with the collector token.
7. Smoke-test admin sign-in, invitation email, tournament creation, public registration, private registration-management link, public scoreboard key rotation, check-in, scoring, and result correction.
8. Confirm the previous image and pre-deploy database backup remain available for rollback.

## Rollback

Application rollback means redeploying the previous immutable image. Database rollback is restore-based because Prisma production migrations are forward-only. Never restore over the live database without first retaining a snapshot of the failed state. Validate tenant counts and a representative tournament after restoration.

## GitHub and Coolify

CI runs on pushes and pull requests to `main`. Production deployment is manual-only and targets the GitHub `production` environment. Configure required reviewers for that environment and store `COOLIFY_URL`, `COOLIFY_TOKEN`, `COOLIFY_APP_UUID`, and `DEPLOY_HEALTHCHECK_URL` there. A non-2xx/3xx Coolify response fails the workflow, and the workflow then polls the database-aware readiness endpoint for up to five minutes.
