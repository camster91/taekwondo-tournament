# Bowin release and rollback runbook

This runbook covers a controlled managed-pilot release. It does not authorize a live deployment. The operator must record the exact commit, image digest, approver, backup artifact, and test evidence for every release.

## Before deployment

1. Confirm every required gate in `MARKET-LAUNCH-PLAN.md` has evidence. Do not substitute a local test for TLS, email delivery, backup restore, real-device, legal, or venue evidence.
2. Merge only a reviewed commit whose required repository checks pass. GitHub Actions and protected `main` must be enabled before relying on remote automation.
3. Build one immutable image and record its SHA-256 digest. Staging and production must use that same digest.
4. Export a PostgreSQL custom-format backup with `pg_dump --format=custom --no-owner --no-acl`, encrypt it at rest, record its SHA-256 checksum, and retain it outside the application host.
5. Restore that backup into an isolated database with `pg_restore --exit-on-error --no-owner --no-acl`. Verify tenant, tournament, registration, bracket, match, incident, and consent counts plus one representative tournament.
6. Confirm the prior application image digest and the pre-deploy database backup are available to the on-call operator.

## Staging

1. Use a separate application, database, Mailgun test domain, Stripe test-mode account, and hostname. Never copy participant PII into staging.
2. Configure every required variable from `.env.example`; keep all development bypasses unset.
3. Apply `prisma migrate deploy`, then require `/api/health` and `/api/health/ready` to return 200.
4. Verify trusted TLS, HTTP-to-HTTPS redirect, CORS, CSP, authentication, email delivery/events, Stripe checkout/webhook/portal, public-link rotation, retention disabled state, and backup monitoring.
5. Execute the full critical workflow and recovery matrix. Retain screenshots, provider event IDs, timings, and issue links.

## Production change

1. Obtain explicit action-time approval and open the protected `production` environment.
2. Announce the change window and pause data-changing operator activity.
3. Capture the pre-deploy backup and current image digest.
4. Deploy the exact staging-tested digest. Do not rebuild from a mutable branch.
5. Wait for database migration completion and readiness. Do not route traffic to an unready container.
6. Smoke-test sign-in, invitation email, tenant isolation, tournament creation, public registration, private management link, check-in, scoring/advancement/correction, scoreboard rotation, results export, and billing in the configured launch mode.
7. Monitor readiness, 5xx rate, database saturation, email failures, Stripe webhook failures, authentication anomalies, and logs continuously through the change window.

## Rollback

Rollback immediately for failed readiness or migrations, authentication or tenant-boundary failure, corrupt scoring/advancement, unrecoverable offline reconciliation, public-link revocation failure, or sustained errors threatening tournament continuity.

1. Stop new traffic and operator writes.
2. Preserve a snapshot of the failed state for investigation.
3. If the database remains compatible, redeploy the prior immutable image digest and verify readiness plus the critical smoke tests.
4. If data/schema rollback is required, restore the verified pre-deploy backup into a new database, validate it, then switch the application connection. Never overwrite the only copy of the failed or pre-deploy database.
5. Record timing, commands, approver, validation results, customer impact, and follow-up actions in the incident log.

## Evidence record

| Field | Value |
|---|---|
| Commit and image digest | |
| Staging URL and approval | |
| Backup path, checksum, and restore timestamp | |
| Migration output | |
| Readiness and smoke-test evidence | |
| Legal/rules approvals | |
| On-call contact and change window | |
| Production approval | |
| Rollback image and database artifact | |
