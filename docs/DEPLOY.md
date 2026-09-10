# Production deployment

The supported production topology is the full-stack Docker image plus PostgreSQL, deployed to an Ashbi VPS (187.77.26.99) via `scripts/deploy-production.sh`. The Node process serves both the Vite build and `/api`; do not deploy the Vite client separately unless an explicit same-origin API gateway is configured.

**Deployment method:** Immutable, rollback-safe manual deployment via `scripts/deploy-production.sh`. The script requires a clean worktree, uploads a verified source archive to the VPS, builds a Docker image on-host, validates a private candidate container, performs a stopped-write cutover with automatic database backup, runs `prisma migrate deploy`, and automatically rolls back if health checks fail.

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

Offline Check-In and Scorekeeper reopening requires an environment-specific
Ed25519 key pair. Provide the PKCS8 DER private key as
`OFFLINE_CAPABILITY_PRIVATE_KEY_BASE64` at runtime and the matching SPKI DER
public key as the Docker build argument
`VITE_OFFLINE_CAPABILITY_PUBLIC_KEY_BASE64`. Never reuse the example E2E keys
or expose the private key. If either half is absent or mismatched, ordinary
online authentication continues but offline identity restoration fails closed.

After migrations and readiness succeed, reset only the marker-protected fabricated tenant with:

```sh
DEMO_RESET_CONFIRM=bowin-resettable-showcase-v1 npm run demo:reset:production
```

The command additionally requires `DEMO_ISOLATED_DATA=1` in its environment. It refuses an absent or mismatched attestation and will not replace an organization whose canonical slug lacks the expected marker. Never persist `DEMO_RESET_CONFIRM` as a normal application secret.

Automatic retention is deliberately disabled by default. Verify a backup and obtain operator/legal approval before enabling it; expired records are deleted at startup and then once per day and cannot be restored from the Trash view.

## Release sequence

1. **Verify CI passes:** Ensure GitHub Actions CI (lint, typecheck, unit tests, E2E tests, build) passes on the commit to be deployed.
2. **Local verification (optional but recommended):** `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` on the exact commit.
3. **Review security advisories:** Check `npm audit` output and bounded exceptions documented in `SECURITY.md` or `docs/ADVISORY-TRACKING-*.md`.
4. **Staging validation (recommended):** Deploy to staging VPS via `scripts/deploy-staging.sh` against a database restored from production snapshot. Run smoke tests.
5. **Production deploy:** Execute `scripts/deploy-production.sh` from a clean worktree. The script:
   - Uploads immutable source archive to VPS with SHA256 verification
   - Builds Docker image on VPS
   - Validates health checks on candidate container
   - Performs stopped-write cutover with automatic DB backup
   - Runs `prisma migrate deploy` to apply pending migrations
   - Starts new live container on same port
   - Automatically rolls back (DB + container) if health checks fail
6. **Post-deploy verification:** The script validates `/api/health/ready` both internally and via public URL. Additionally verify:
   - Admin sign-in works
   - Invitation email sends
   - Tournament creation succeeds
   - Public registration form renders
   - Registration-management token link works
   - Check-in and scoring flows work
7. **Rollback readiness:** Previous container is renamed to `taekwondo-tournament-rollback` and DB backup is at `/var/backups/taekwondo/pre-{timestamp}-{SHA}.dump`. Manual rollback procedure is documented in `scripts/deploy-production.sh` comments (< 5 minute RTO).

## Rollback

Application rollback means redeploying the previous immutable image. Database rollback is restore-based because Prisma production migrations are forward-only. Never restore over the live database without first retaining a snapshot of the failed state. Validate tenant counts and a representative tournament after restoration.

## GitHub CI and VPS deployment

**CI:** GitHub Actions runs on pushes and pull requests to `main`. Workflows include:
- `.github/workflows/ci.yml`: lint, typecheck, unit tests, E2E tests (Playwright), build verification
- `.github/workflows/build-and-push.yml`: multi-arch Docker image build (amd64 + arm64) and push to `ghcr.io/camster91/taekwondo-tournament`

**Deployment:** Production deployment is **manual-only** via `scripts/deploy-production.sh` executed from a developer's local machine (requires SSH key for VPS). There is NO automated GitHub Actions deployment workflow. The script performs an immutable, rollback-safe deploy with automatic health-check validation.

**VPS access:** Deployment requires SSH access to the Ashbi VPS (187.77.26.99) with the appropriate SSH key (`BOWIN_PRODUCTION_SSH_KEY` env var, defaults to `/c/Users/camst/.ssh/id_ed25519_hostinger`). Environment variables for the live container are preserved from the previous deployment and updated only for changed legal/consent fields.

**Traefik reverse proxy:** The VPS runs Traefik for TLS termination and routing. Public URL `tkd.ashbi.ca` routes to `127.0.0.1:{LIVE_PORT}` where `{LIVE_PORT}` is the port allocated to the `taekwondo-tournament` container. Custom domain support (PR #256) requires dynamic Traefik configuration to route tenant-specific hostnames.
