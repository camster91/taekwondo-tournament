# Bowin Pilot Ship Status

**Last updated:** 2026-09-09  
**Commit:** Ready for PR (expanded)  
**Status:** Ship-ready for managed pilot

This document provides a snapshot of what an organizer can do today with Bowin, known gaps for the pilot, and how to run/deploy the system.

## Product Positioning

**Bowin is SaaS for tournament organizers only.** Organizers pay for and use Bowin to run their tournaments. Competitors and the public interact with the organizer's branded tournament experience — not "Bowin" as the product face. 

Public-facing surfaces (registration, scoreboard, results) prioritize the **organizer's tournament brand** (event name, location, school/org colors and logo). Bowin remains invisible or shows a minimal "powered by" credit on public pages.

---

## What Works Today (Pilot-Ready)

### Authentication & Onboarding (Organizer-Only)
- **Clear Sign in / Sign out** UI with explicit session state in sidebar
- **Magic-link email auth** with 6-digit OTP fallback for organizers
- **Demo login** (gated by `ENABLE_DEMO_LOGIN=1`) for prospects evaluating the product
- **Invitation system** for staff onboarding (director/scorekeeper/viewer roles)
- **Setup flow** (`POST /api/auth/setup`) creates the first admin with `ADMIN_SETUP_KEY`
- **JWT sessions** (7-day default, httpOnly cookies in production)
- **No public sign-in confusion**: competitors never see Bowin login prompts on public pages

### Multi-Tenant Isolation
- **Tenant boundaries** via `requireTournamentAccess` middleware
- **12 regression tests** covering admin bypass, explicit access grants, orphan tournament fallback, org-scoped boundaries
- **Wired into 59+ route handlers** across tournaments, divisions, brackets, registrations, rules, schedule
- **Authorization precedence:** admin → explicit `UserTournamentAccess` → orphan fallback → org membership
- **Production-ready:** The multi-tenant boundary (org members can only mutate tournaments in their org) passes all tests

### Tournament Operations
- **Tournament CRUD** with soft-delete + restore
- **Public registration** flow with parent/guardian consent capture
- **Competitor import** from Excel with auto-column-mapping
- **Auto-categorization** engine (6-step pipeline: belt → gender → age → event type → weight → belt color/dan)
- **Double-elimination bracket generation** with positions map (1–16 competitors validated)
- **Check-in** with weight capture and weigh-in tracking
- **Scorekeeper** with real-time match scoring, swap, undo, reset, offline queue
- **Director Dashboard** with ring status, division progress, operational query, attention alerts
- **Public scoreboard** with auto-rotation and pinned ring/match modes
- **Results export** (PDF, CSV, Excel) plus school reports and certificates
- **Schedule generator** with ring assignment and time estimation

### Tenant-Branded Public Experience (First Slice)
- **Public registration** shows tournament name and event details prominently, not "Bowin" branding
- **Public scoreboard** displays organizer's tournament as primary identity (event name + location in header)
- **Bowin logo removed** from public-facing pages (registration, scoreboard, parent finder)
- **Tournament context** preserved across all public surfaces (name, date, location visible)
- **Ready for organizer logo/colors**: architecture supports tenant branding expansion (see "Known Gaps")
- **Atomic bracket operations** in transactions (generate, match update, advancement)
- **Match audit log** for every score/winner change
- **Offline operation support** with local queue + server reconciliation
- **Backup/restore** endpoints for division state
- **Connection-loss-safe** scoring with stale-state detection

### Accessibility & UX
- **WCAG 2.2 AA** critical journey acceptance signed (see `docs/DEVICE-ACCESSIBILITY-ACCEPTANCE.md`)
- **Responsive** across 375–1920px with 44px mobile touch targets
- **Dark mode** throughout
- **Keyboard navigation** and screen-reader support for IconButton primitive (80+ buttons)
- **Semantic HTML** with proper heading hierarchy (h1 → h2 → h3)

### Monitoring & Operations
- **Health endpoints** (`/api/health`, `/api/health/ready`) with database connectivity checks
- **Prometheus-compatible metrics** at `/api/internal/metrics` (bearer-protected)
- **Correlation IDs** in API responses and error logs
- **Graceful shutdown** and bounded Docker logs
- **Readiness-based deployment** (Coolify polls readiness before routing traffic)

### Testing & Quality
- **796 unit/integration tests** pass (104 files)
- **120 browser workflows** (Chromium, Firefox, WebKit) via Playwright
- **Typecheck, lint, production build** all pass
- **Security headers** (CSP, HSTS, X-Frame-Options, etc.) in production
- **Rate limiting** on auth, registration, demo endpoints (5–30 req/15min)

---

## Known Gaps (Documented for Pilot)

### External Dependencies (Not Blocking Pilot, Must Be Configured)
1. **PostgreSQL** provisioning with encrypted backups + restore drill
2. **Mailgun** domain verification (SPF, DKIM, DMARC) + delivery testing
3. **TLS certificate** (trusted, not self-signed) + renewal automation
4. **External monitoring** for readiness, 5xx rate, email delivery, certificate expiry
5. **Stripe** test-mode end-to-end verification (or choose managed invoicing for pilot)

### Policy & Legal (Approval Required Before Live Pilot)
1. **Terms of service** and **privacy notice** approved by counsel
2. **Guardian consent/waiver** language for minors
3. **Tournament rules** approved by domain owner (scoring, tie-breaking, corrections)
4. **Retention schedule** and **incident response** process
5. **Support hours** and **escalation** contacts defined

### Operational Rehearsal (Required for Pilot)
1. **Physical device testing** (phone, tablet, laptop, venue TV) - see `docs/DEVICE-ACCESSIBILITY-ACCEPTANCE.md`
2. **Network-loss** and **offline reload/recovery** drills
3. **Printed fallback** procedures for connectivity failures
4. **Backup restore** drill with timestamped evidence
5. **Rollback** procedure rehearsal (see `docs/RELEASE-RUNBOOK.md`)

### Product Enhancements (Nice-to-Have, Not Blocking)
- **Full tenant branding** with custom organizer logos, colors, favicon on public pages
- **Custom domain per tournament** (e.g. `register.myschool.com` instead of `bowin.app/register/abc123`)
- **Multi-sport** expansion beyond Taekwondo (partial support exists via `sport-profiles.ts`)
- **Federation certification** claims
- **Native mobile apps**
- **Athlete rankings** and historical stats
- **Livestreaming** integration
- **Public marketing** SEO, analytics, heatmaps (add after privacy approval)

---

## How to Run Locally

### Prerequisites
- **Node.js 22+** (tested on 22.23.0)
- **PostgreSQL 16+** (or use Docker)
- **npm** (included with Node)

### Quick Start

1. **Clone and install dependencies:**
   ```bash
   git clone https://github.com/camster91/taekwondo-tournament
   cd taekwondo-tournament
   npm install  # also runs prisma generate via postinstall
   ```

2. **Set up environment:**
   ```bash
   cp .env.example .env
   # Edit .env:
   #   DATABASE_URL=postgresql://user:pass@localhost:5432/taekwondo_tournament
   #   JWT_SECRET=$(openssl rand -base64 48)
   #   NODE_ENV=development
   #   ENABLE_DEMO_LOGIN=1
   ```

3. **Start PostgreSQL:**
   ```bash
   # If using Docker:
   docker run -d --name tkd-postgres \
     -e POSTGRES_USER=taekwondo \
     -e POSTGRES_PASSWORD=taekwondo \
     -e POSTGRES_DB=taekwondo_tournament \
     -p 5432:5432 postgres:16
   
   # Or use your local PostgreSQL service
   ```

4. **Sync schema and seed (optional):**
   ```bash
   npm run db:push  # for disposable local dev only
   # Production uses: npx prisma migrate deploy
   ```

5. **Start dev servers:**
   ```bash
   npm run dev  # Vite (localhost:5173) + Express (localhost:3001)
   ```

6. **Open browser:**
   ```
   http://localhost:5173
   ```
   - Click "Try the demo" for instant admin access (demo@ashbi.ca, 4-hour JWT)
   - Or use magic-link flow (in dev mode, the OTP is logged to server console)

### Testing

```bash
# Unit/integration tests (796 tests, ~17s)
npm test

# Typecheck (client + server)
npm run typecheck

# Lint
npm run lint

# Production build
npm run build

# E2E tests (requires Chromium, Firefox, WebKit)
npm run test:e2e:install  # once
npm run test:e2e
```

---

## How to Deploy

### Docker Build (Local)

The production deployment uses `scripts/deploy-to-vps.sh` which:
1. Builds locally: `npm run build` → `dist/` (client) + `dist-server/` (server)
2. Tars the build artifacts
3. SCPs to VPS (or pipes via `ssh ... cat` to avoid unreliable scp)
4. Builds Docker image on VPS with `Dockerfile`
5. Runs container with `--network markup-net` to reach `markup-postgres` container
6. Passes env via `--env-file` (not inline `-e`) to avoid leaking secrets in shell history

### Coolify Deployment (Recommended for Pilot)

1. **Point Coolify at this repo** (main branch or a tagged release)
2. **Configure environment variables** in Coolify's secret store:
   ```
   DATABASE_URL=postgresql://...
   JWT_SECRET=<openssl rand -base64 48>
   NODE_ENV=production
   ADMIN_SETUP_KEY=<openssl rand -hex 32>
   ALLOWED_ORIGINS=https://bowin.example.com
   PUBLIC_APP_URL=https://bowin.example.com
   MAILGUN_API_KEY=...
   MAILGUN_DOMAIN=...
   EMAIL_FROM_NAME=bowin
   EMAIL_FROM_ADDRESS=noreply@example.com
   METRICS_TOKEN=<32+ random chars>
   ```
3. **Link PostgreSQL service** or point `DATABASE_URL` at external Postgres
4. **Enable GitHub environment protection** (`production`) with required reviewers
5. **Run deployment** via GitHub Actions workflow or manual Coolify trigger
6. **Verify readiness:** `curl https://bowin.example.com/api/health/ready` → `{"status":"ok","db":"ok"}`
7. **Smoke-test:** sign-in, tournament creation, public registration, check-in, scoring, results export

### Production Checklist (Before First Live Pilot)
- [ ] Trusted TLS certificate (not self-signed)
- [ ] Encrypted PostgreSQL backups off-host
- [ ] Mailgun domain verified (SPF, DKIM, DMARC)
- [ ] External monitoring + alerts configured
- [ ] Terms/privacy/rules approved by counsel
- [ ] Backup restore drill completed
- [ ] Rollback procedure rehearsed
- [ ] Physical device + venue TV testing done
- [ ] On-call contact named and paged (test alert)
- [ ] Stripe test-mode verified or managed invoicing chosen
- [ ] One fabricated-data rehearsal completed
- [ ] Written consent obtained for first customer pilot

---

## Architecture Summary

- **Frontend:** React 19 + Vite 7 + TypeScript, TanStack Query v5, Tailwind CSS v4
- **Backend:** Node 22 + Express 4 + `express-async-errors`
- **ORM:** Prisma 7.9 with driver adapter (`@prisma/adapter-pg`)
- **Database:** PostgreSQL 16
- **Auth:** JWT (HS256, 7-day default) + magic-link OTP
- **PDF:** jsPDF 4 (server-side)
- **Excel:** xlsx (SheetJS)
- **Email:** Mailgun HTTP API (not SMTP)
- **Deployment:** Docker + Coolify (or manual VPS script)

See `CLAUDE.md` for full codebase guide (routes, models, conventions).

---

## Next Steps for Full Launch

1. **Complete Phase 1–4 from `docs/APP-COMPLETION-ROADMAP-2026-08-17.md`:**
   - Isolated public demo (Phase 1)
   - Production operations + recovery (Phase 2)
   - Venue/device/accessibility rehearsal (Phase 3)
   - Policy/rules/support approval (Phase 4)

2. **External evidence gates from `docs/DEPLOYMENT-READINESS-2026-08-07.md`:**
   - TLS, PostgreSQL, Mailgun, monitoring, legal, Stripe, rehearsals, pilot consent

3. **Run 3 successful supervised events** with no unrecoverable scoring/bracket/privacy incidents

4. **Consider general availability** only after Phases 5–6 (product completion, CI maintenance) pass

---

## Support & Contact

- **Repository:** https://github.com/camster91/taekwondo-tournament
- **Preview:** https://taekwondo-tournament-pi.vercel.app
- **Operator/support:** (set `SUPPORT_ALERT_EMAIL` in `.env` for incident routing)

---

**Ship Status:** ✅ Ready for managed pilot with explicit consent, rehearsal, and monitoring setup. Not yet ready for unattended general-availability SaaS.
