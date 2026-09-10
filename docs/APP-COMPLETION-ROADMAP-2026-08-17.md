# Bowin app completion roadmap — 2026-08-17

This roadmap records the remaining work between the verified production hotfix and a fully rehearsed, supportable pilot. It complements the existing GitHub shipping plan rather than replacing it.

## Verified release baseline

- Production revision: `45daa0b344ab22e2da8b93fd0597f1b4f743310c`
- Production readiness: application and database healthy.
- Production demo policy: the server reports `demoLoginEnabled: false`; the client now hides the demo action instead of calling a disabled endpoint and displaying an HTML-as-JSON error.
- Staging policy: isolated synthetic data with demo login enabled.
- Staging browser smoke: Chromium, Firefox, and WebKit passed the demo journey against the exact production revision.
- Automated verification baseline: 770 tests passed, 24 skipped. The final login-copy delta passed 17 focused tests, typecheck, lint, production build, whitespace checks, and the staging browser smoke.
- Release recovery artifacts:
  - Production rollback container: `taekwondo-tournament-rollback`
  - Production pre-release backup: `/var/backups/taekwondo/pre-20260817T225844Z-45daa0b344ab.dump`
  - Staging rollback container: `bowin-staging-rollback`
  - Staging pre-release backup: `/opt/bowin-staging-backups/bowin-staging-pre-45daa0b344ab22e2da8b93fd0597f1b4f743310c.OOGGen.dump`

The production fix is complete. The product is not yet an unattended general-availability service: the remaining gates below include infrastructure provisioning, human approvals, and physical rehearsal evidence.

## Phase 1 — isolated public demo

Tracking issue: #164.

### Outcome

Give prospects a safe, useful demonstration without connecting public demo identities to a customer or mixed production database.

### Work

- Provision a dedicated hostname and synthetic database for the public demo.
- Enable demo login only with both `ENABLE_DEMO_LOGIN=1` and `DEMO_ISOLATED_DATA=1`.
- Provision a unique offline-capability signing key pair for that environment.
- Run the marker-protected fixture reset and publish the canonical public registration and scoreboard fixtures.
- Prove public visitors cannot enumerate or modify data outside the showcase scope.
- Establish an operator-owned reset cadence and disclose shared fabricated-state behavior truthfully.

### Exit criteria

- Ten simultaneous fresh visitors can complete the intended demo paths without seeing customer data.
- Public registration and a valid published scoreboard are testable with fabricated records.
- Reset, isolation, expiry, rate limiting, logout, and external-side-effect denial pass in the deployed environment.
- Exact-image health, fixture, and rollback evidence is recorded.

### Cameron/VPS operator steps (required for Phase 1 completion)

The code and tests for isolated demo readiness are complete. Remaining steps require Cameron action on the VPS:

#### 1. Provision dedicated demo hostname + DNS
```bash
# On DNS provider (e.g. Cloudflare)
# Create A record: demo.tkd.ashbi.ca → 187.77.26.99
```

#### 2. Provision isolated demo database
```bash
# On VPS as root
docker run -d \
  --name bowin-demo-db \
  --restart unless-stopped \
  --network markup-net \
  -e POSTGRES_USER=bowin_demo \
  -e POSTGRES_PASSWORD={secure_password_distinct_from_production} \
  -e POSTGRES_DB=bowin_demo \
  -v bowin-demo-pgdata:/var/lib/postgresql/data \
  postgres:16-alpine
```

#### 3. Generate unique demo signing keys
```bash
# On VPS as root
# These keys MUST be distinct from production and staging
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 \
  -out /etc/taekwondo.d/offline-capability-demo-private-key
openssl rsa -in /etc/taekwondo.d/offline-capability-demo-private-key \
  -pubout -out /etc/taekwondo.d/offline-capability-demo-public-key
chmod 600 /etc/taekwondo.d/offline-capability-demo-*

# Generate demo JWT secret (distinct from production)
openssl rand -base64 32 > /etc/taekwondo.d/jwt-secret-demo
chmod 600 /etc/taekwondo.d/jwt-secret-demo
```

#### 4. Configure Traefik reverse proxy for demo hostname
```bash
# Create Traefik dynamic config
sudo nano /opt/traefik/dynamic/bowin-demo.yml
```

Add the following configuration:
```yaml
http:
  routers:
    bowin-demo:
      rule: "Host(`demo.tkd.ashbi.ca`)"
      entryPoints:
        - websecure
      service: bowin-demo-backend
      tls:
        certResolver: letsencrypt
      middlewares:
        - compress

  services:
    bowin-demo-backend:
      loadBalancer:
        servers:
          - url: "http://localhost:18305"

  middlewares:
    compress:
      compress: {}
```

Traefik auto-reloads dynamic configs from `/opt/traefik/dynamic/` within 5-10 seconds. Let's Encrypt will automatically provision an SSL certificate via HTTP-01 challenge.

#### 5. Verify demo environment variables
The demo deploy script (`scripts/deploy-demo.sh`) requires these env vars in the live container:
- `ENABLE_DEMO_LOGIN=1` — enables demo route
- `DEMO_ISOLATED_DATA=1` — production fail-closed attestation
- `DEMO_RATE_LIMIT_MAX=30` — higher than production (default 20)
- `DATABASE_URL=postgresql://bowin_demo:...@bowin-demo-db:5432/bowin_demo` — isolated DB
- `JWT_SECRET=$(cat /etc/taekwondo.d/jwt-secret-demo)` — distinct secret
- `PUBLIC_APP_URL=https://demo.tkd.ashbi.ca`
- `ALLOWED_ORIGINS=https://demo.tkd.ashbi.ca`
- `OFFLINE_CAPABILITY_PRIVATE_KEY_BASE64=...` — base64-encoded demo private key
- **NO external integration keys**: MUST NOT have `MAILGUN_API_KEY`, `STRIPE_SECRET_KEY`, `OPENAI_API_KEY`, `SUPPORT_ALERT_EMAIL` configured (deploy script validates this)

#### 6. Deploy demo environment
```bash
# From repo root on local machine
# Script validates isolation attestations and refuses production/staging DBs
./scripts/deploy-demo.sh
```

The deploy script:
- Builds and ships the exact tracked revision
- Validates `ENABLE_DEMO_LOGIN=1` and `DEMO_ISOLATED_DATA=1` are set
- Validates demo DB URL is distinct from production
- Refuses deploy if external integration keys are configured
- Runs `prisma migrate deploy` in candidate container
- Resets fabricated showcase data via marker-protected `demo:reset:production`
- Tests internal + public health checks
- Retains rollback container (`bowin-demo-rollback`)

#### 7. Verify demo isolation post-deploy
```bash
# From any machine with curl
# 1. Health check
curl https://demo.tkd.ashbi.ca/api/health/ready
# Should return: {"status":"ok","db":"ok"}

# 2. Setup status reports demo enabled
curl https://demo.tkd.ashbi.ca/api/auth/setup-status
# Should return: {"needsSetup":false,"demoLoginEnabled":true}

# 3. Demo login creates independent principal
curl -X POST https://demo.tkd.ashbi.ca/api/auth/demo
# Should return 200 with JWT and demo user

# 4. Fabricated tournaments visible
curl -H "Authorization: Bearer {jwt}" https://demo.tkd.ashbi.ca/api/tournaments
# Should include "Bowin Live Championship (Demo)" and "Future Stars Open Registration (Demo)"

# 5. Administrative reads blocked for demo users
curl -H "Authorization: Bearer {jwt}" https://demo.tkd.ashbi.ca/api/auth/users
# Should return 403: "This action is unavailable in the public demo."

# 6. External integrations blocked
curl -X POST -H "Authorization: Bearer {jwt}" https://demo.tkd.ashbi.ca/api/billing/checkout -d '{}'
# Should return 403: demo capability denied
```

#### 8. Establish reset cadence
The fabricated showcase can be reset to clean state:
```bash
# On VPS as root, inside bowin-demo container
docker exec -e DEMO_RESET_CONFIRM=bowin-resettable-showcase-v1 bowin-demo npm run demo:reset:production
```

Recommended cadence: daily at 02:00 UTC via cron (same as backup window).

#### Rollback procedure
If demo deploy fails or produces broken state:
```bash
# On VPS as root
docker stop bowin-demo
docker rename bowin-demo-rollback bowin-demo
docker start bowin-demo
# Health check
curl https://demo.tkd.ashbi.ca/api/health/ready
```

#### Security boundaries (already implemented in code)
- Demo users cannot access `/api/auth/users`, `/api/invites`, `/api/billing`, `/api/organizations`, `/api/support`
- Demo users can only mutate fabricated bracket matches and registrations (read-only otherwise)
- Demo login route is unmounted in production unless BOTH `ENABLE_DEMO_LOGIN=1` AND `DEMO_ISOLATED_DATA=1` are set
- Deploy script refuses to proceed if demo DB URL matches production
- Deploy script refuses to proceed if external integration keys are configured
- Fabricated showcase org/tournaments have `marker: 'bowin-resettable-showcase-v1'` in settings JSON
- Reset command refuses to delete any org without the marker

## Phase 2 — production operations and recovery

Tracking issue: #165.

### Outcome

Turn the healthy deployment into an operated service with detectable failures and a staffed response path.

### Work

- Configure external monitoring for public HTTPS, readiness, database connectivity, error rate, email delivery, Stripe webhook health, certificate expiry, and backup freshness.
- Configure actionable alert delivery with a named primary and backup responder.
- Move encrypted backups off-host and execute a timestamped restore drill against a disposable target.
- Record recovery time, recovery point, checksum, row-count, migration, and application-readiness evidence.
- Exercise rollback and write the result into the release record.

### Exit criteria

- A deliberately failed staging check pages the expected responder and is acknowledged.
- A selected off-host backup restores successfully and the restored app passes readiness and representative workflow checks.
- Monitoring, on-call, escalation, and status-communication ownership are documented.

Existing dependencies: #120, #148, and #19.

## Phase 3 — venue, device, and accessibility rehearsal

Tracking issue: #166.

### Outcome

Prove the tournament-day workflows on the hardware, networks, displays, and assistive technologies that staff and visitors will actually use.

### Work

- Complete the physical device and assistive-technology matrix in `docs/DEVICE-ACCESSIBILITY-ACCEPTANCE.md`.
- Rehearse director, scorekeeper, check-in, parent finder, public display, offline reload/recovery, corrections, printed fallback, and restore procedures.
- Run the venue display long enough to verify currentness, stale-state behavior, reconnect recovery, and screen legibility.
- Close or explicitly waive every critical or important defect with an owner and expiry date.

### Exit criteria

- WCAG 2.2 AA acceptance evidence is signed for critical journeys.
- Phone, tablet, laptop, venue display, zoom, reduced-motion, high-contrast, keyboard, and required screen-reader checks are recorded.
- `docs/VENUE-REHEARSAL-RECORD.md` is complete and signed.
- Printed fallback and restoration procedures are usable without developer intervention.

Existing dependency: #128.

## Phase 4 — policy, rules, and support approval

Tracking issue: #167.

### Outcome

Make every public and operator-facing promise supportable and approved for a real pilot.

### Work

- Approve minor-data consent, privacy notice, retention, deletion, and incident-response language.
- Approve tournament rules, division logic, weight classes, scoring, tie-breaking, and correction procedures with a named domain owner.
- Approve support hours, escalation, notification channels, and customer-facing service-status language.
- Verify email/domain identities and all public legal links in the target environment.

### Exit criteria

- Legal/privacy, rules, venue, operations, and product owners are named.
- Approved documents include version, date, owner, and review cadence.
- The deployed application links to the approved versions and preserves consent/audit evidence.

Existing dependencies: #123 and #148.

## Phase 5 — product and experience completion

### Outcome

Finish the remaining prioritized product and UX work without weakening the verified trust boundaries.

### Work

- Work through the reconciled product/UX roadmap in #151 and tracker #152.
- Complete shared component adoption and visual consistency on the remaining critical journeys.
- Close remaining command-centre, correction-preview, live-finder, offline, and operational-status acceptance gaps using server-backed evidence.
- Keep optional AI recommendation work deterministic, reviewable, tenant-scoped, stale-safe, and auditable.

### Exit criteria

- Every retained launch requirement is either shipped and verified or explicitly deferred by the product owner.
- Critical workflows have no silent failure, contradictory success, unsafe retry, or inaccessible recovery state.
- Visual, responsive, accessibility, and browser regressions pass on the supported matrix.

## Phase 6 — CI, dependency, and release maintenance

### Outcome

Keep the released baseline reproducible and prevent known maintenance debt from becoming a production incident.

### Work

- Finish the required CI/security gates tracked in #19.
- Track the current `deepmerge-ts` advisory inherited through Prisma tooling; do not force a breaking Prisma downgrade as an automated audit fix.
- Upgrade when an upstream-compatible fixed dependency is available, then run migrations, generation, build, unit, integration, and deployment rehearsals.
- Keep deployment scripts, supported runtime documentation, rollback tests, and release evidence current.

### Exit criteria

- Required checks block merges and produce reproducible evidence.
- No unresolved high-severity dependency finding has an exposed production request path or lacks an owner, mitigation, and review date.
- A clean checkout can build, migrate, test, and deploy the documented exact artifact.

## Release decision

The current production revision is suitable for controlled testing of the repaired login and existing authenticated workflows. A public demo should remain disabled on production until Phase 1 is complete. A staffed pilot should not be declared complete until Phases 2–4 have signed evidence. General availability additionally requires the retained launch scope in Phases 5–6 to pass its release gates.
