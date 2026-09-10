# Staging Environment Validation Guide

**Purpose:** Pre-release validation workflow for Bowin releases using an isolated staging stack without requiring new paid infrastructure.

**Audience:** Developers and Cameron for release validation before production deploy.

---

## Overview

The Bowin staging environment is an **isolated stack** running on the same VPS host as production, with:
- Separate Docker containers (`bowin-staging-app`, `bowin-staging-db`)
- Isolated Docker network (`bowin-staging-net`)
- Separate PostgreSQL database (`bowin_staging`)
- Separate data volume (`bowin-staging-pgdata`)
- Public URL: `https://staging-tkd.ashbi.ca`
- Internal port: `18302` (vs production `18301`)

**Key principle:** Staging is **agent-safe** for code/script/docs work. Infrastructure provisioning (VPS setup, domain DNS, TLS certs) remains **Cameron-gated**.

---

## Current State (2026-09-10)

### ✅ Agent-Complete
- `scripts/deploy-staging.sh` — automated staging deploy with rollback
- `scripts/staging-smoke.mjs` — browser-based smoke tests (Chromium/Firefox/WebKit)
- Isolated staging identity proof in deploy script
- Database backup/restore on failure
- Rollback-safe cutover with health checks
- Demo data reset after migration

### ⚠️ Cameron-Gated
- **Staging VPS/container provisioning** — requires one-time setup:
  - Create `bowin-staging-db` container (postgres:16-alpine on `bowin-staging-net`)
  - Create `bowin-staging-app` container (initial placeholder, replaced by deploys)
  - Create `bowin-staging-pgdata` Docker volume
  - Configure Caddy for `staging-tkd.ashbi.ca` reverse proxy
  - Provision staging environment variables in `/etc/taekwondo.d/` (JWT secret, DB URL, offline capability keys)
- **Staging domain DNS** — `staging-tkd.ashbi.ca` A record → VPS IP
- **TLS certificate** — Let's Encrypt via Caddy

---

## Staging Deploy Workflow

### Prerequisites
1. Clean git worktree (no uncommitted changes)
2. SSH access to VPS (`BOWIN_STAGING_VPS` env var or default `root@187.77.26.99`)
3. SSH key at `BOWIN_STAGING_SSH_KEY` or default path
4. Staging infrastructure provisioned by Cameron (see "Cameron-Gated" above)

### Deploy Steps

```bash
# From repo root, on any commit you want to validate
./scripts/deploy-staging.sh
```

**What it does:**
1. **Archives exact commit** — creates immutable `.tar.gz` from `git archive`
2. **Uploads to VPS** — secure transfer to `/opt/bowin-staging-releases/{SHA}.tar.gz`
3. **Verifies artifact** — SHA256 checksum validation
4. **Builds Docker image** — `bowin-release:{SHA}` with embedded offline capability public key
5. **Stops staging writes** — current container → `bowin-staging-rollback`
6. **Captures pre-migration backup** — encrypted dump to `/opt/bowin-staging-backups/`
7. **Runs migrations** — `prisma migrate deploy` in private candidate container
8. **Resets demo data** — `npm run demo:reset:production` with confirm flag
9. **Health checks** — internal + public URL validation
10. **Publishes release** — candidate → `bowin-staging-app`, listens on port `18302`

**Automatic rollback** on any failure after step 6:
- Restores database from pre-migration backup
- Swaps containers back (`bowin-staging-rollback` → `bowin-staging-app`)
- Exits with status `90` (CRITICAL) if rollback fails

**Rollback artifacts:**
- Container: `bowin-staging-rollback` (previous release, stopped)
- Backup: `/opt/bowin-staging-backups/bowin-staging-pre-{SHA}.*.dump`

### Failure Injection (Testing)
```bash
# Test rollback after container rename
BOWIN_STAGING_INJECT_FAILURE=after-rename ./scripts/deploy-staging.sh

# Test rollback after database mutation
BOWIN_STAGING_INJECT_FAILURE=after-demo-reset ./scripts/deploy-staging.sh
```

---

## Smoke Test Suite

After staging deploy completes, validate the release:

```bash
STAGING_BASE_URL=https://staging-tkd.ashbi.ca node scripts/staging-smoke.mjs
```

**What it tests (per browser engine):**
1. **Demo login** — `POST /api/auth/demo` returns admin JWT
2. **Auth verification** — `GET /api/auth/me` confirms admin role
3. **Tournament list** — `GET /api/tournaments` includes fabricated seed data
4. **Key pages render** — `/tournaments`, `/tournaments/{id}`, `/checkin/{id}`, `/scorekeeper/{id}`
5. **No page errors** — captures and reports JS console errors
6. **No auth redirects** — confirms protected routes stay accessible

**Browser engines tested:**
- Chromium (primary)
- Firefox
- WebKit (Safari equivalent)

**Output:**
- Screenshots in `test-results/staging-smoke/{browser}-tournaments.png`
- Pass/fail per browser with tournament ID
- Exit code `0` if all browsers pass

**Common failures:**
- Staging not provisioned → connection refused on `staging-tkd.ashbi.ca`
- Demo login disabled → 404 on `/api/auth/demo` (requires `ENABLE_DEMO_LOGIN=1` in staging env)
- Seed data missing → fabricated tournament "Spring Championship 2026" not found

---

## Staging vs Production Differences

| Aspect | Staging | Production |
|--------|---------|------------|
| URL | `staging-tkd.ashbi.ca` | `tkd.ashbi.ca` |
| Database | `bowin-staging-db:5432/bowin_staging` | `taekwondo-db:5432/taekwondo_tournament` |
| Container | `bowin-staging-app` | `taekwondo-tournament` |
| Network | `bowin-staging-net` | `markup-net` |
| Port | `18302` | `18301` |
| Data | Demo/fabricated | Real customer data |
| Demo login | Required (`ENABLE_DEMO_LOGIN=1`) | Optional (disabled in prod) |
| Demo isolated | Required (`DEMO_ISOLATED_DATA=1`) | N/A |
| Demo rate limit | Higher (`DEMO_RATE_LIMIT_MAX=30`) | Lower (default `20`) |

**Critical safety check in deploy script:**
```bash
# Refuses to deploy if DATABASE_URL points to production
DATABASE_TARGET=${DATABASE_URL#*@}
case "$DATABASE_TARGET" in
  bowin-staging-db:5432/bowin_staging*) ;;  # OK
  *) echo "Refusing non-staging DATABASE_URL" >&2; exit 1 ;;
esac
```

---

## Manual Validation Checklist

After automated smoke tests pass, perform these manual checks:

### 1. Core Auth Flow
- [ ] Demo login button visible and works
- [ ] Admin dashboard loads with correct role
- [ ] Demo data visible (Spring Championship 2026 tournament)

### 2. Registration
- [ ] Public registration form accessible via organizer portal
- [ ] Self-registration submits successfully
- [ ] Confirmation email logs to console (if no Mailgun configured)

### 3. Tournament Operations
- [ ] Create new tournament
- [ ] Import competitors (Excel upload)
- [ ] Auto-generate divisions
- [ ] Generate brackets
- [ ] Check-in competitor
- [ ] Score a match in scorekeeper view

### 4. Public Pages
- [ ] Public scoreboard by slug loads
- [ ] Scoreboard auto-refresh works (default or tournament-specific interval)
- [ ] Tenant branding visible (org logo, colors)
- [ ] **NO "Powered by Bowin" watermark** on public scoreboard

### 5. PDF Exports
- [ ] Bracket PDF downloads with print-shop layout improvements (fold marks, larger match numbers, ring assignments)
- [ ] Certificate PDF generates with tenant branding
- [ ] School report PDF includes tenant branding
- [ ] **NO Bowin watermark** on any PDF

### 6. Performance & Errors
- [ ] No errors in browser console
- [ ] No 500 errors in network tab
- [ ] Pages load in < 2s (check Network timing)
- [ ] Offline capability loads correctly (if enabled)

---

## Health Check Endpoints

Staging exposes the same health endpoints as production:

### Internal Health (from VPS shell)
```bash
docker exec bowin-staging-app wget -q -O- http://127.0.0.1:3001/api/health/ready
# Should return: {"status":"ok","db":"ok"}
```

### Public Health (from any machine)
```bash
curl https://staging-tkd.ashbi.ca/api/health/ready
# Should return: {"status":"ok","db":"ok"}
```

### Database Connection
```bash
docker exec bowin-staging-db psql -U bowin_staging -d bowin_staging -c 'SELECT 1;'
# Should return: 1
```

---

## Troubleshooting

### Deploy Fails: "Refusing staging deploy from a dirty worktree"
**Cause:** Uncommitted changes in local git repo.
**Fix:** Commit or stash changes, then redeploy.

### Deploy Fails: "Refusing non-staging DATABASE_URL"
**Cause:** Staging container's `DATABASE_URL` points to production DB.
**Fix:** Cameron must fix staging environment variables. DO NOT bypass this check.

### Smoke Tests Fail: Connection Refused
**Cause:** Staging containers not running or Caddy not configured.
**Fix:**
```bash
ssh root@187.77.26.99
docker ps | grep staging  # Check containers running
docker logs bowin-staging-app --tail 50  # Check application logs
```

### Smoke Tests Fail: 404 on /api/auth/demo
**Cause:** `ENABLE_DEMO_LOGIN` not set in staging environment.
**Fix:** Cameron must add to staging env file (inspected by deploy script):
```
ENABLE_DEMO_LOGIN=1
DEMO_ISOLATED_DATA=1
DEMO_RATE_LIMIT_MAX=30
```

### Health Check Fails After Deploy
**Cause:** Application crash or database migration failure.
**Check logs:**
```bash
docker logs bowin-staging-app --tail 100
```
**Manual rollback:**
```bash
docker stop bowin-staging-app
docker rename bowin-staging-rollback bowin-staging-app
docker start bowin-staging-app
# Restore DB if migrations ran:
BACKUP=/opt/bowin-staging-backups/bowin-staging-pre-{SHA}.*.dump
docker exec -i bowin-staging-db pg_restore -U bowin_staging -d postgres --clean --create < $BACKUP
```

### Demo Data Missing After Deploy
**Cause:** `npm run demo:reset:production` failed or skipped.
**Fix:** Run manually in staging container:
```bash
docker exec -e DEMO_RESET_CONFIRM=bowin-resettable-showcase-v1 bowin-staging-app npm run demo:reset:production
```

---

## Cameron Setup Checklist (One-Time)

Before the first staging deploy, Cameron must:

1. **Create staging Docker network:**
   ```bash
   docker network create bowin-staging-net
   ```

2. **Create staging database:**
   ```bash
   docker run -d \
     --name bowin-staging-db \
     --restart unless-stopped \
     --network bowin-staging-net \
     -e POSTGRES_USER=bowin_staging \
     -e POSTGRES_PASSWORD={secure_password} \
     -e POSTGRES_DB=bowin_staging \
     -v bowin-staging-pgdata:/var/lib/postgresql/data \
     postgres:16-alpine
   ```

3. **Create staging environment file:**
   ```bash
   # Generate staging JWT secret
   openssl rand -base64 32 > /etc/taekwondo.d/jwt-secret-staging

   # Generate offline capability keys for staging
   openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 \
     -out /etc/taekwondo.d/offline-capability-staging-private-key
   openssl rsa -in /etc/taekwondo.d/offline-capability-staging-private-key \
     -pubout -out /etc/taekwondo.d/offline-capability-staging-public-key
   chmod 600 /etc/taekwondo.d/*-staging*
   ```

4. **Configure Caddy for staging subdomain:**
   Add to `/opt/caddy/Caddyfile`:
   ```
   staging-tkd.ashbi.ca {
       reverse_proxy 127.0.0.1:18302
       encode gzip
   }
   ```
   Reload: `docker exec caddy caddy reload --config /etc/caddy/Caddyfile`

5. **Create placeholder staging app container:**
   ```bash
   # Will be replaced by first deploy, but needed for deploy script isolation checks
   docker run -d \
     --name bowin-staging-app \
     --restart unless-stopped \
     --network bowin-staging-net \
     -p 127.0.0.1:18302:3001 \
     -e DATABASE_URL=postgresql://bowin_staging:{password}@bowin-staging-db:5432/bowin_staging \
     -e JWT_SECRET=$(cat /etc/taekwondo.d/jwt-secret-staging) \
     -e NODE_ENV=production \
     -e PUBLIC_APP_URL=https://staging-tkd.ashbi.ca \
     -e ALLOWED_ORIGINS=https://staging-tkd.ashbi.ca \
     -e ENABLE_DEMO_LOGIN=1 \
     -e DEMO_ISOLATED_DATA=1 \
     alpine:latest sleep infinity
   ```

6. **Verify DNS:**
   ```bash
   dig +short staging-tkd.ashbi.ca  # Should return VPS IP
   ```

7. **Test TLS:**
   ```bash
   curl -I https://staging-tkd.ashbi.ca  # Should return 200 (or 404 from placeholder)
   ```

---

## Future Enhancements (Agent-Delegable)

Ideas for improving the staging workflow (do NOT implement without explicit task):

1. **Automated staging deploy on PR merge to `main`** (currently manual `workflow_dispatch` only)
2. **Staging smoke test as GitHub Actions job** (currently manual script execution)
3. **Slack/email notification on staging deploy success/failure**
4. **Staging DB snapshot before each deploy** (currently only on failure path)
5. **Staging container resource limits** (memory/CPU caps to prevent runaway processes)
6. **Staging access token for API testing** (non-demo, specific test user)
7. **Staging data seeding beyond demo reset** (diverse test scenarios)

---

## Related Documentation

- `scripts/deploy-production.sh` — production deploy with similar rollback-safe pattern
- `scripts/production-smoke.mjs` — production smoke tests (no demo login, real data)
- `docs/DESTRUCTIVE-MIGRATION-POLICY.md` — migration testing policy
- `docs/END_TO_END_SHIP_PLAN.md` — Appendix #8 (staging environment status)

---

**Last Updated:** 2026-09-10  
**Status:** Scripts complete, Cameron setup pending
