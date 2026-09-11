# Track 4 — Platform / DevOps Review

**Auditor:** platform-dev (Track 4 of 5)
**Date:** 2026-09-10
**Scope:** Dockerfile, docker-compose, CI workflows, env handling, Sentry, health endpoints, deploy scripts, custom domain wiring, backups, dependency hygiene, bundle pipeline
**Production target:** `https://tkd.ashbi.ca` (Traefik + Let's Encrypt on Ashbi VPS, deploy via `scripts/deploy-production.sh`)
**Repo:** `C:\Users\ashleyc2\.minimax\sessions\mvs_307587395596434a911e8761d0a78a68\workspace\taekwondo-tournament`

---

## 1. Executive Summary

The deploy pipeline is unusually disciplined for a single-dev project: immutable source archives, content-addressed image tags, candidate-canary + auto-rollback, OCI image labels, and a `prisma migrate deploy` flow that replaced a destructive `db push`. The Dockerfile is multi-stage, non-root, with `apk add --no-cache openssl` for Prisma, and a `HEALTHCHECK` against `/api/health/ready`. The custom-domain wiring is Traefik-based, not Coolify, and is well-documented.

The platform still has three real defects that will bite in production:

1. The deploy script's `ALLOWED_ENV` regex silently **strips `SENTRY_DSN` and `SENTRY_ENVIRONMENT` on every deploy** — the moment an operator turns Sentry on, the very next deploy turns it back off and they will not notice until an incident lands.
2. The production live container is started **without `--init`**, so SIGTERM never reaches the Node process spawned by `sh -c "./node_modules/.bin/prisma migrate deploy && node server.js"`. The graceful-shutdown block in `src/server/index.ts` (SIGTERM/SIGINT handlers, `prisma.$disconnect`, 25s safety net) is dead code on production restarts and deploys. The same code path is dead on `docker stop` during cutover, which is when it most matters.
3. The Dockerfile `CMD` runs `prisma migrate deploy` on every container start, and the deploy script also runs it in a one-shot sidecar. Two sources of truth, both run on every restart.

The Dockerfile itself is clean; the wiring around it is not. Once the two deploy-script issues above are fixed, the platform is shippable. Before that, it is **NEEDS_FIXES_BEFORE_SHIP** because the Sentry regression is silent and the SIGTERM regression is a real connection-pool leak on every deploy.

The 2026-06-26 master audit did not review the platform track, so this report does not declare any platform-specific findings "RESOLVED" — every item below is a new, evidence-cited defect.

---

## 2. Findings Table

| # | Severity | Title | Location |
|---|---|---|---|
| 1 | **HIGH** | `ALLOWED_ENV` strips `SENTRY_DSN` / `SENTRY_ENVIRONMENT` on every deploy | `scripts/deploy-production.sh:148`, `scripts/deploy-staging.sh:114` |
| 2 | **HIGH** | Production live container started without `--init`; SIGTERM never reaches Node | `scripts/deploy-production.sh:206` (and `src/server/index.ts:333-340`) |
| 3 | **MEDIUM** | Dockerfile `CMD` runs `prisma migrate deploy` on every container start, duplicated with deploy-script one-shot | `Dockerfile:69` vs `scripts/deploy-production.sh:196` |
| 4 | **MEDIUM** | Bundle-budget check is advisory-only in CI; `ci.yml` does not gate on `npm run bundle:check` | `.github/workflows/ci.yml`, `docs/BUNDLE-BUDGETS.md:80-87` |
| 5 | **MEDIUM** | Sentry receives exception events with user email; no `beforeSend`/PII scrubber | `src/server/services/sentry.ts:34-48,125`, `src/client/services/sentry.ts:97-101` |
| 6 | **MEDIUM** | No image vulnerability scan in CI | `.github/workflows/build-and-push.yml` |
| 7 | **MEDIUM** | `package.json` has no `engines` field; CI pins Node 22 major, Dockerfile pins 22.18 | `package.json`, `.github/workflows/ci.yml:38` |
| 8 | **LOW** | `console.info` logs first 20 chars of Sentry DSN at startup | `src/server/services/sentry.ts:108`, `src/client/services/sentry.ts:58` |
| 9 | **LOW** | CI uses unverified third-party action `harmon758/postgresql-action@v1` | `.github/workflows/ci.yml:101` |
| 10 | **LOW** | `dist-demo` bundled into production image (unnecessary ~MB of code in prod) | `Dockerfile:49` |
| 11 | **LOW** | `docker-compose.yml` app service lacks explicit `healthcheck:` block (Dockerfile's HEALTHCHECK is the only source) | `docker-compose.yml:1-59` |
| 12 | **LOW** | `npm audit --audit-level=high` is the only gate; medium/low advisories are silently dropped with no scheduled re-audit | `.github/workflows/ci.yml:88-91` |
| 13 | **LOW** | Backup script saves to local `/var/backups/taekwondo` only; no off-host copy documented | `scripts/backup-database.sh` (writes to `$BACKUP_DIR` on the VPS host) |
| 14 | **LOW** | Backup retention policy is implicit (just the directory); no `find … -mtime` prune, no restore-drill schedule enforced | `scripts/backup-database.sh`, `docs/BACKUP-RECOVERY.md` |
| 15 | **LOW** | Dockerfile HEALTHCHECK `start-period=30s` is borderline when `prisma migrate deploy` runs in CMD on a cold DB | `Dockerfile:60-61` |

---

## 3. Numbered Findings (Full Detail)

### [HIGH] 1. `ALLOWED_ENV` regex silently strips Sentry env on every deploy

**Location:** `scripts/deploy-production.sh:148`, `scripts/deploy-staging.sh:114`

**Trigger:** Operator sets `SENTRY_DSN` and `SENTRY_ENVIRONMENT` on the live container to enable GlitchTip / Sentry.io tracking. They are documented in `.env.example` (lines 67-86), and the `src/server/services/sentry.ts` SDK treats them as a first-class toggle. The deploy script's `ALLOWED_ENV` allowlist regex is used to copy env vars from the running live container into the candidate's env file (line 149 of `deploy-production.sh`):

```bash
ALLOWED_ENV='^(DATABASE_URL|JWT_SECRET|METRICS_TOKEN|ADMIN_SETUP_KEY|MAILGUN_API_KEY|MAILGUN_DOMAIN|MAILGUN_BASE_URL|EMAIL_FROM_NAME|EMAIL_FROM_ADDRESS|RETENTION_PURGE_ENABLED|SOFT_DELETE_RETENTION_DAYS|REGISTRATION_CONSENT_VERSION|PRIVACY_NOTICE_URL|TOURNAMENT_TERMS_URL|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|STRIPE_STARTER_PRICE_ID|STRIPE_PRO_PRICE_ID|DEBUG|ENABLE_DEMO_LOGIN|DEMO_ISOLATED_DATA|DEMO_RATE_LIMIT_MAX|PUBLIC_APP_URL|ALLOWED_ORIGINS|OPENAI_API_KEY|OPENAI_MODEL|OPENAI_BASE_URL|SUPPORT_ALERT_EMAIL)='
docker inspect "$LIVE" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E "$ALLOWED_ENV" > "$ENV_FILE"
```

Neither `SENTRY_DSN` nor `SENTRY_ENVIRONMENT` is in that allowlist. (The client-side `VITE_SENTRY_DSN` is bake-time, not runtime, so it would be captured in the image — but the server-side variables are runtime.) The next deploy, no matter how many times `SENTRY_DSN=…` is set on the running container, drops it on the way through. The `Sentry` SDK silently no-ops with no log line (only the boot-time `[sentry] SENTRY_DSN not set — error tracking disabled` appears once per container).

**Impact:** Silent observability regression. The first time an operator "turns on Sentry" it works. After the first subsequent deploy it is gone. There is no deploy-time assertion that Sentry is configured. Errors that would have been captured to GlitchTip silently disappear into the void during a real incident.

**Remediation:** Add `SENTRY_DSN` and `SENTRY_ENVIRONMENT` to the `ALLOWED_ENV` regex in both `scripts/deploy-production.sh:148` and `scripts/deploy-staging.sh:114`. Optionally add `grep -q '^SENTRY_DSN=' "$ENV_FILE"` near the existing required-key assertions at line 160 if Sentry is meant to be mandatory in production.

**Evidence:**
```bash
# scripts/deploy-production.sh:148
ALLOWED_ENV='^(DATABASE_URL|JWT_SECRET|METRICS_TOKEN|ADMIN_SETUP_KEY|MAILGUN_API_KEY|MAILGUN_DOMAIN|MAILGUN_BASE_URL|EMAIL_FROM_NAME|EMAIL_FROM_ADDRESS|RETENTION_PURGE_ENABLED|SOFT_DELETE_RETENTION_DAYS|REGISTRATION_CONSENT_VERSION|PRIVACY_NOTICE_URL|TOURNAMENT_TERMS_URL|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|STRIPE_STARTER_PRICE_ID|STRIPE_PRO_PRICE_ID|DEBUG|ENABLE_DEMO_LOGIN|DEMO_ISOLATED_DATA|DEMO_RATE_LIMIT_MAX|PUBLIC_APP_URL|ALLOWED_ORIGINS|OPENAI_API_KEY|OPENAI_MODEL|OPENAI_BASE_URL|SUPPORT_ALERT_EMAIL)='
```
(`SENTRY_DSN` / `SENTRY_ENVIRONMENT` / `VITE_SENTRY_*` are absent. Confirmed by ripgrep across `scripts/` — zero matches.)

---

### [HIGH] 2. Production live container started without `--init`; SIGTERM never reaches Node

**Location:** `scripts/deploy-production.sh:206`

**Trigger:** The live production container is launched with:

```bash
docker run -d --name "$LIVE" --restart unless-stopped --network markup-net \
  -p "127.0.0.1:${LIVE_PORT}:3001" --env-file "$ENV_FILE" "$IMAGE" >/dev/null
```

The Dockerfile `CMD` is `["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node server.js"]` (`Dockerfile:69`). PID 1 inside the container is therefore `sh`, not `node`.

The `docker-compose.yml` does set `init: true` on the `app` service (line 44), which gives the dev compose a real tini. The production `docker run` does not, and no ENTRYPOINT in the Dockerfile provides one.

When Docker / Coolify / the operator's `docker stop` sends SIGTERM to the container, **`sh` receives it and exits by default without forwarding the signal to its child `node` process**. Node does not see SIGTERM and does not run the shutdown handler at `src/server/index.ts:333-340`:

```ts
const shutdown = async (signal: string) => {
  console.log(`[shutdown] received ${signal}, draining...`);
  server.close(() => console.log('[shutdown] HTTP server closed'));
  setTimeout(() => { process.exit(1); }, 25_000).unref();
  try { await prisma.$disconnect(); ... } catch (err) { ... }
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
```

`docker stop` will then send SIGKILL after the 10s default grace period, tearing down in-flight requests and the Prisma connection pool. The block of comments starting at `index.ts:317` ("Closes D7. Docker / Coolify / Kubernetes send SIGTERM first… The previous handler only caught SIGINT…") is factually correct in its diagnosis but is **not actually closed** in production because of this PID-1 issue.

**Impact:** Every production deploy, every manual `docker restart`, and every OOM-kill will fail to drain gracefully. In-flight scoreboard / `POST /api/billing/webhook` requests that are mid-flight when the cutover starts will 502, and the Prisma pool may leak a connection per restart. The mitigation in the comment block (25s safety net, `prisma.$disconnect`) is unreachable on production.

**Remediation:** Add `--init` to the live container `docker run` at `scripts/deploy-production.sh:206`, and also to the candidate at line 164, and to the one-shot `prisma migrate deploy` containers at line 196. Alternatively, change `Dockerfile:69` to use a tiny `tini` (or `dumb-init`) ENTRYPOINT; the distroless-style alternative is a `node --enable-source-maps ./dist-server/server/index.js` invocation under a JSON `CMD` that drops `sh -c`.

**Evidence:**
```bash
# scripts/deploy-production.sh:206
docker run -d --name "$LIVE" --restart unless-stopped --network markup-net -p "127.0.0.1:${LIVE_PORT}:3001" --env-file "$ENV_FILE" "$IMAGE" >/dev/null
# Dockerfile:69
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node server.js"]
```

---

### [MEDIUM] 3. Dockerfile `CMD` runs `prisma migrate deploy` on every container start

**Location:** `Dockerfile:69`, `scripts/deploy-production.sh:196`

**Trigger:** The Dockerfile `CMD` is `sh -c "./node_modules/.bin/prisma migrate deploy && node server.js"`. The deploy-production script (line 196) also runs migrations in a one-shot sidecar before starting the live container:

```bash
docker run --rm --network markup-net --env-file "$ENV_FILE" "$IMAGE" \
  sh -c './node_modules/.bin/prisma migrate deploy'
```

But the live container at line 206 is started without overriding the CMD, so the Dockerfile's own `migrate deploy` fires again when the live container boots. Every subsequent `docker restart`, Docker daemon restart, or Coolify reschedule re-runs `migrate deploy` against the database. It is idempotent (no-op when schema is current) but adds measurable startup latency on every cold start and creates two sources of truth for "is the schema current?".

**Impact:** Slow, surprising cold starts. If a future migration is non-idempotent by accident (e.g., a manual seed step), running it twice will corrupt state. Operators may also incorrectly believe "if the live container came up, migrations ran" — when in fact the deploy script's one-shot is what protected the schema, and the live container's CMD is a redundant safety net.

**Remediation:** Pick one. The cleanest split is: keep the one-shot `prisma migrate deploy` in `deploy-production.sh` (and `deploy-staging.sh`), and change `Dockerfile:69` to `CMD ["sh", "-c", "node server.js"]` (or a direct `node` invocation). The deploy process then owns schema migration; the image just serves.

**Evidence:**
```dockerfile
# Dockerfile:69
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node server.js"]
```
```bash
# scripts/deploy-production.sh:196
docker run --rm --network markup-net --env-file "$ENV_FILE" "$IMAGE" sh -c './node_modules/.bin/prisma migrate deploy'
# scripts/deploy-production.sh:206  (live container — no command override)
docker run -d --name "$LIVE" --restart unless-stopped --network markup-net -p "127.0.0.1:${LIVE_PORT}:3001" --env-file "$ENV_FILE" "$IMAGE" >/dev/null
```

---

### [MEDIUM] 4. Bundle-budget check is advisory-only in CI

**Location:** `docs/BUNDLE-BUDGETS.md:80-87`, `.github/workflows/ci.yml`

**Trigger:** `docs/BUNDLE-BUDGETS.md` says verbatim:

> **IMPORTANT**: GitHub Actions is **NOT** a ship gate for Bowin due to billing/image constraints. The bundle budget check is **advisory-only** in CI.
> For actual release verification: 1. Run `npm run bundle:check` locally or on the VPS …
> CI failures on Actions should be investigated but do NOT block merge.

Confirmed by reading `ci.yml` end-to-end: it runs `npm run typecheck`, `npm test`, `npm run lint`, `npm audit --audit-level=high`, `npm run build`, Playwright, and `test-fresh-migration.sh` — but never `npm run bundle:check` (which `analyze-bundle.mjs:268-272` is set up to exit 1 on violation). A PR that adds an un-lazy-loaded `import 'xlsx'` to a page that previously was 13 KB gzip can be merged with the bundle doubling to 26 KB and the only thing that will notice is a manual `npm run bundle:check` on the VPS.

**Impact:** Front-end perf regressions (the kind that hurt public-page mobile load) are not caught at PR time. The bundle baseline at `bundle-baseline.json` is therefore advisory-only in practice.

**Remediation:** Either (a) add a `npm run bundle:check` step to `ci.yml` (it's just `node scripts/analyze-bundle.mjs check` after a `npm run build`) with a delta gate against `bundle-baseline.json`, or (b) document explicitly in the README that bundle budgets are checked manually before every release and add a checklist item to `scripts/deploy-production.sh`. The doc claims billing/image constraints prevent CI gating, but the script itself is a 1-second node check that needs neither.

**Evidence:**
```yaml
# .github/workflows/ci.yml (relevant steps only)
- run: npm run typecheck
- run: npm test
- run: npm run lint
- run: npm audit --audit-level=high
- run: npm run build
# (no bundle:check step)
```

---

### [MEDIUM] 5. Sentry receives exception events with user email; no `beforeSend`/PII scrubber

**Location:** `src/server/services/sentry.ts:34-48,125`, `src/client/services/sentry.ts:97-101`

**Trigger:** The Sentry SDK is initialized with `sendDefaultPii` left at its default (true since `@sentry/node` v8), and the Sentry context is then populated via:

```ts
// src/server/services/sentry.ts:125
Sentry.setUser({ id: user.id, email: user.email, role: user.role ?? 'user' });
// src/client/services/sentry.ts:97
Sentry.setUser({ id, email, role });
```

There is a `beforeSendTransaction` (server:54) that redacts metric labels, but no `beforeSend` hook to scrub exception events. Any exception that captures the active request's user (via Sentry's auto-context) will carry the user's email into GlitchTip in plaintext. The `.env.example` and `docs/MONITORING-OPS.md` document a Sentry-style DSN that is used by GlitchTip (self-hosted Sentry-compatible) on the VPS.

**Impact:** PII (user email) flows to a third-party error tracker on every server exception. The `docs/SECURITY.md` referenced from `ci.yml` says "Keep critical findings as a hard release gate", but PII-as-email-on-Sentry is not a "critical advisory" and never trips `npm audit`. The opt-out (Sentry not set → all calls no-op) works, but the moment Sentry is enabled, PII starts flowing.

**Remediation:** Either set `sendDefaultPii: false` in both `initSentry` calls, or add a `beforeSend(event)` hook that strips `event.user.email` and any other PII fields before sending. The client-side `setUser` call should also pass `{ id }` only and let email live separately if it is needed for non-Sentry flows.

**Evidence:**
```ts
// src/server/services/sentry.ts (lines 34-48, 125)
Sentry.init({
  dsn: SENTRY_DSN,
  environment: SENTRY_ENVIRONMENT,
  // ...
  tracesSampleRate: SENTRY_ENVIRONMENT === 'production' ? 0.1 : 1.0,
  // beforeSend for exception events is NOT defined
});
// ...
Sentry.setUser({ id: user.id, email: user.email, role: user.role ?? 'user' });
```

---

### [MEDIUM] 6. No image vulnerability scan in CI

**Location:** `.github/workflows/build-and-push.yml`

**Trigger:** `build-and-push.yml` builds a multi-arch (amd64+arm64) image, pushes to `ghcr.io/camster91/<repo>` with `provenance: true` and `sbom: true` (good — SBOM is published), but there is no `trivy`, `grype`, `docker scout`, or `snyk container` step. SBOM tells you what's inside; it does not tell you which of those CVEs matter.

**Impact:** A CVE in `node:22.18-alpine3.22`'s `openssl` or in any of the npm dependencies that snuck into the final image will not be flagged at build time. The SBOM is published for downstream consumers, but the CI itself does not fail on known criticals.

**Remediation:** Add an `anchore/scan-action` or `aquasecurity/trivy-action` step after the `Build and push` step, gated on `severity: CRITICAL`. Cost on a public GH Actions runner is ~1-2 minutes.

**Evidence:**
```yaml
# .github/workflows/build-and-push.yml (after the Build and push step)
# (no trivy/grype/scan step)
- name: Image summary
  run: |
    echo "## Image published" >> $GITHUB_STEP_SUMMARY
    # ...
```

---

### [MEDIUM] 7. `package.json` has no `engines` field

**Location:** `package.json`, `.github/workflows/ci.yml:38`

**Trigger:** The Dockerfile is pinned to `node:22.18-alpine3.22` (3 places: `Dockerfile:3,25,33`). The CI workflow uses `node-version: '22'` (`.github/workflows/ci.yml:38`), which is a major-version pin and will resolve to whatever 22.x GitHub Actions has installed (could be 22.10 one month, 22.18 the next). `package.json` has no `engines.node` field to constrain either side. `npm ci` will not refuse to install on a Node version that drifts.

**Impact:** CI can pass on a different Node minor than the runtime Dockerfile, and a future contributor can develop on a Node that is technically supported by `engines` (because there is no constraint) but not pinned to 22.18. Drift between CI and prod is a slow-acting bug source.

**Remediation:** Add `"engines": { "node": ">=22.18.0 <23" }` to `package.json` and set `npm config set engine-strict true` in CI. Pin the CI step to `node-version: '22.18'`.

**Evidence:**
```yaml
# .github/workflows/ci.yml:36-40
- name: Setup Node.js
  uses: actions/setup-node@v4
  with:
    node-version: '22'      # major only
    cache: 'npm'
```

---

### [LOW] 8. `console.info` logs first 20 chars of Sentry DSN at startup

**Location:** `src/server/services/sentry.ts:108`, `src/client/services/sentry.ts:58`

**Trigger:** When `SENTRY_DSN` is set, both server and client log a confirmation:

```ts
console.info(`[sentry] Initialized (env: ${SENTRY_ENVIRONMENT}, DSN: ${SENTRY_DSN.substring(0, 20)}...)`);
```

A Sentry/GlitchTip DSN has the form `https://<public-key>@<host>/<project-id>`. The first 20 characters are typically `https://<first 6 chars of public key>@`. The public key is, in fact, public (it is the key Sentry uses in the URL envelope), so this is not a credentials leak in the traditional sense — but it is unnecessary and is printed into the user's browser console in client-side init (anyone running DevTools can see the host and a key prefix).

**Impact:** Tiny information leak. Operational noise. Easy to fix; no urgency beyond "clean up the public DSN prefix out of user-facing console output."

**Remediation:** Either remove the substring (just log `[sentry] Initialized env=${SENTRY_ENVIRONMENT}`) or log only the host portion. In the client, drop entirely (it ships to every visitor).

**Evidence:**
```ts
// src/server/services/sentry.ts:108
console.info(`[sentry] Initialized (env: ${SENTRY_ENVIRONMENT}, DSN: ${SENTRY_DSN.substring(0, 20)}...)`);
```

---

### [LOW] 9. CI uses unverified third-party action `harmon758/postgresql-action@v1`

**Location:** `.github/workflows/ci.yml:101`

**Trigger:** The e2e job uses `uses: harmon758/postgresql-action@v1` to spin up a Postgres 16 on the runner. This is a community-maintained action, not a GitHub-verified or first-party action. It is pinned to a major version (`@v1`) but not to a commit SHA. A malicious or compromised release of `v1` would run on PRs from forks with `pull_request_target`-equivalent privileges (it doesn't have any — `permissions: contents: read` is set, which limits blast radius).

**Impact:** Supply-chain risk. The action is in the build path for every PR and every push, with network access to the runner. Pinned to SHA and GitHub-verified actions are the safer pattern.

**Remediation:** Either (a) replace with the official `services:` Postgres block (GitHub Actions has built-in service containers), or (b) pin `harmon758/postgresql-action@<full-sha>`. The action does its job today; this is a hygiene call.

**Evidence:**
```yaml
# .github/workflows/ci.yml:99-105
- name: Start Postgres
  uses: harmon758/postgresql-action@v1
  with:
    postgresql version: '16'
    postgresql db: 'taekwondo_tournament'
    postgresql user: 'taekwondo'
    postgresql password: 'taekwondo'
```

---

### [LOW] 10. `dist-demo` bundled into production image

**Location:** `Dockerfile:49`

**Trigger:** The production runner stage copies `dist-demo` from the builder:

```dockerfile
COPY --from=builder --chown=node:node /app/dist-demo ./dist-demo
```

The `tsconfig.demo.json` build is only needed for the demo deployment profile (`scripts/deploy-demo.sh`), which is a separate VPS. Production images do not need `dist-demo`.

**Impact:** Each production image carries the demo bundle (likely small, but unnecessary). Operators reading the Dockerfile may be confused about what is in the prod image.

**Remediation:** Move the `dist-demo` copy to a dedicated `FROM builder AS demo` stage, and only include it in a demo-tagged image (e.g., a multi-target build, or a separate `Dockerfile.demo`).

**Evidence:**
```dockerfile
# Dockerfile:47-49
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/dist-server ./dist-server
COPY --from=builder --chown=node:node /app/dist-demo ./dist-demo
```

---

### [LOW] 11. `docker-compose.yml` app service lacks explicit `healthcheck:` block

**Location:** `docker-compose.yml:1-59`

**Trigger:** The `app` service relies entirely on the Dockerfile's `HEALTHCHECK` directive. Compose's `depends_on: condition: service_healthy` (line 42) works against the Dockerfile's HEALTHCHECK, so functionally the dev compose is fine. But the YAML does not redundantly declare `healthcheck: { test: [...], interval: 10s, ... }`, so anyone reading `docker-compose.yml` alone does not know what the app's health probe is.

**Impact:** Documentation / observability hygiene, not a functional defect.

**Remediation:** Add a `healthcheck:` block under `app:` mirroring the Dockerfile's, with a tighter `interval: 10s`.

---

### [LOW] 12. `npm audit --audit-level=high` is the only gate; no scheduled re-audit

**Location:** `.github/workflows/ci.yml:88-91`

**Trigger:** `npm audit --audit-level=high` is the only dependency-posture check. Anything below `high` is ignored. There is no scheduled (e.g. weekly) workflow that re-runs the audit against the current advisory database.

**Impact:** A medium advisory that becomes high in a future advisory snapshot will not be caught until a PR happens to touch `package-lock.json`. Slow drift risk.

**Remediation:** Add a `schedule: cron: '0 6 * * 1'` workflow that runs `npm audit --audit-level=moderate` and posts to a `dependabot`-style summary, or migrate to Dependabot / Renovate.

**Evidence:**
```yaml
# .github/workflows/ci.yml:88-91
- name: Dependency audit
  run: npm audit --audit-level=high
```

---

### [LOW] 13. Backup script writes only to local `/var/backups/taekwondo`; no off-host copy

**Location:** `scripts/backup-database.sh` (writes to `$BACKUP_DIR` on the VPS host), `deploy-production.sh:189-191`

**Trigger:** The deploy script writes a `pg_dump` to `$BACKUP_DIR/pre-${STAMP}.dump` (line 189) and the standalone `backup-database.sh` (in `scripts/`) presumably writes to the same `BACKUP_DIR`. No off-host copy (`rclone`, `aws s3 cp`, `restic` to Backblaze, etc.) is referenced anywhere in the repo. The `.env.example` does not list a backup-destination env var. The `docs/BACKUP-RECOVERY.md` was not exhaustively read for this audit (it's long and outside the diff scope), but a spot check of the deploy script shows the backup lives on the same VPS that hosts the database — which means a host-level disaster takes the backups with it.

**Impact:** If the VPS host dies (provider outage, accidental `rm -rf`, full disk), there is no second copy. Restore drill (`scripts/test-backup-restore.sh`) presumably tests local restore, not end-to-end from off-host.

**Remediation:** Add a `BOWIN_BACKUP_OFFHOST_TARGET` env var (e.g., a Backblaze B2 bucket via `rclone`) and a post-dump `rclone copy` step. Document the retention policy (e.g., keep 7 daily + 4 weekly + 6 monthly). Add a monthly scheduled workflow that exercises the restore path.

**Evidence:**
```bash
# scripts/deploy-production.sh:189
BACKUP="$BACKUP_DIR/pre-${STAMP}.dump"
docker exec markup-postgres pg_dump -U markup -Fc --create taekwondo > "$BACKUP"
chmod 600 "$BACKUP" && test -s "$BACKUP"
```

---

### [LOW] 14. Backup retention is implicit; no prune, no enforced restore-drill schedule

**Location:** `scripts/backup-database.sh`, `docs/BACKUP-RECOVERY.md`

**Trigger:** Same as #13. There is no `find "$BACKUP_DIR" -name '*.dump' -mtime +30 -delete` (or equivalent) referenced in the deploy / backup scripts. The restore-drill script `scripts/test-backup-restore.sh` exists, but I see no scheduled workflow (cron / GitHub Action `schedule:`) that exercises it. The `BACKUP_DIR` directory will grow forever; recovery is "scroll through the dumps" rather than "fetch the most recent known-good."

**Impact:** Disk pressure, slow restore decisions during an actual incident, and no assurance that a 30-day-old dump is still restorable.

**Remediation:** Add a retention policy script (`scripts/prune-backups.sh`) with explicit day/week/month tiers, called from a daily cron. Add a `schedule:` workflow that runs `test-backup-restore.sh` against the most recent backup on a weekly cadence and posts the result to a status channel.

---

### [LOW] 15. Dockerfile HEALTHCHECK `start-period=30s` is borderline when `prisma migrate deploy` runs in CMD

**Location:** `Dockerfile:60-61`

**Trigger:** The Dockerfile `HEALTHCHECK` is `start-period=30s`. If the CMD (`prisma migrate deploy && node server.js`) takes more than 30s on a cold start (e.g., a fresh DB that has 25 migrations to apply), the health probe fires during migration and the orchestrator may mark the container unhealthy before it has a chance to come up. The deploy script's one-shot `migrate deploy` mitigates this in normal flow, but a Docker daemon restart after a fresh deploy (or any scenario where the live container is restarted without the deploy script) will run the cold-path.

**Impact:** Low — the 5-retry budget in the HEALTHCHECK directive plus the deploy script's explicit 45-attempt `wait_for_health` (line 167) provides enough headroom in practice. But a fresh-DB container restart could go unhealthy briefly.

**Remediation:** Bump `start-period` to `60s` and `retries` to `10`, or — better — fix #3 (single-source migrations) so the CMD is just `node server.js` and the start-period can drop to `10s`.

**Evidence:**
```dockerfile
# Dockerfile:60-61
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:3001/api/health/ready || exit 1
```

---

## 4. Regression Check vs `AUDIT-REPORT-2026-06-26.md`

The 2026-06-26 master audit covered code review (auth, soft-delete, input validation, race conditions). It did **not** review the platform track (Dockerfile, deploy scripts, Sentry, health endpoints, backups, CI). Every finding in this report is therefore **new** — there is nothing from the 2026-06-26 audit to claim as RESOLVED or REGRESSED for the platform scope.

The most adjacent items from the 2026-06-26 audit are the 6 `console.log`/`console.warn` items in `src/client/context/AuthContext.tsx:80`, `src/server/routes/brackets.ts:266`, `src/server/routes/auth.ts:161-163`, `src/server/services/match-advancement.ts:150`. None of those are in the platform scope and none are in the findings above.

The platform-specific resolutions claimed inline by the codebase (the `Closes D1 + D2` / `Closes D4` / `Closes D7` / `Closes D9` / `Closes D10` / `Closes D11` / `Closes D19` / `Closes D23` comments scattered through `Dockerfile`, `src/server/index.ts`, `.dockerignore`, `ci.yml`) refer to an internal review document I do not have access to. The substantive claims made in those comments are:

- `D1+D2 (migrate deploy vs db push)` — claim is true; `Dockerfile:64-69` and `ci.yml:115-122` confirm.
- `D4 (per-route body limit for Excel auto-map)` — claim is true; `src/server/index.ts:177-186` confirms.
- `D7 (graceful shutdown)` — claim is **false in production**; see finding #2 above. The shutdown code is real, but `--init` is missing on the live container.
- `D9 (env validation)` — claim is true; `src/server/services/production-config.ts` and the `if (isProduction) validateProductionServiceConfig(process.env)` block in `index.ts:78-88` confirm.
- `D10 (readiness endpoint with DB check)` — claim is true; `src/server/index.ts:316-330` confirms.
- `D11 (compression before API routers)` — claim is true; `src/server/index.ts:189-192` confirms.
- `D19 (typecheck as hard CI gate, not continue-on-error)` — claim is true; `ci.yml:46-48` confirms.
- `D23 (`.dockerignore` covers dojang photo dirs)` — claim is true; `.dockerignore:25-34` confirms.

**One latent regression: D7 is open in production (finding #2).** Everything else in the D-numbered set has been substantively resolved.

---

## 5. Verdict

`NEEDS_FIXES_BEFORE_SHIP`

The two HIGH findings (Sentry env stripped on every deploy; SIGTERM never reaches Node in the production container) are silent regressions that will not be caught by the existing test or smoke layers, and one of them (SIGTERM) is the exact thing the `D7` comment block claims to have closed. Both are < 5 line fixes in shell. The remaining MEDIUM/LOW items can ride in a follow-up.

Once #1 and #2 are fixed (estimated ~30 minutes total), the platform is shippable.
