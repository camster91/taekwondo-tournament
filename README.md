# Martial Arts Tournament Management System

**A real-time tournament operations platform for independent Taekwondo schools, covering registration, categorization, brackets, check-in, scoring, schedules, and public results.**

Bowin is currently being prepared as an approval-based managed pilot. Taekwondo is the only market-supported discipline: its workflows and Newton's Championship-style rules have automated coverage and pilot data-fit evidence. Configurable profiles for other martial arts exist in the codebase, but they are experimental until each ruleset is reviewed and validated with qualified organizers.

> **Looking for the codebase tour, route map, or auth model?** See [CLAUDE.md](./CLAUDE.md) — the AI-agent codebase guide.
> **Looking for the delivery workflow, PR template, or release policy?** See [CONTRIBUTING.md](./CONTRIBUTING.md).
> **Looking for what's shipped in v1.0.0-pilot.1?** See [CHANGELOG.md](./CHANGELOG.md).

## Discipline Status

| Status | Discipline | Scope |
|--------|------------|-------|
| Managed-pilot candidate | Taekwondo | Sparring and patterns; organizer review of the event rules remains mandatory |
| Experimental profiles | Karate, Judo, BJJ, Wrestling, Muay Thai, Boxing, Kickboxing, MMA, Kung Fu | Configuration starting points only; not commercially supported or federation-certified |

## Core Features

### Tournament Management
- **Multi-Sport Support:** Configure tournaments for any martial art with sport-appropriate scoring
- **Automated Bracket Generation:** Parse Excel `.xlsm` rosters to dynamically generate brackets
- **Division Management:** Handle divisions by rank, gender, age, and weight classes
- **Event Templates:** Pre-configured templates for each martial art

### Live Scheduling
- **Polling sync:** Schedule and scoreboard views poll the server every 5 seconds; the public scoreboard announces the cadence in the header
- **Multi-Ring Support:** Manage multiple rings/mats simultaneously
- **Digital Displays:** Clean, high-contrast UI for TV monitors
- **Director overrides:** Set the active ring or feature a specific match from the tournament settings UI

### Competitor Management
- **Registration:** Import from Excel, public self-signup form, or manual entry
- **Check-in System:** Track competitor arrival and readiness
- **Weight Verification:** Record verified weights for weight-class events
- **Belt Verification:** Confirm rank eligibility

### Scoring & Results
- **Custom Scoring:** Sport-specific scoring rules
- **Scorekeeper UI:** Real-time per-match rounds, penalties, undo, and bracket advancement on result confirmation
- **Public Results:** PDF, CSV, Excel, and per-medal certificate print
- **School Standings:** Track school/team standings

## Tech Stack

| Category | Technology |
|----------|------------|
| Frontend | React 19 + Vite 7 + TypeScript |
| Routing | React Router 7 |
| Data fetching | TanStack Query v5 |
| Backend | Node 22 + Express 4 |
| ORM | Prisma 7 (driver-adapter, no migrations) |
| Database | PostgreSQL 16 |
| Auth | JWT (HS256) + magic-link OTP (Mailgun) |
| Styling | Tailwind CSS v4 |
| PDF | jsPDF 4 (server) |
| Excel | xlsx / SheetJS |
| Email | Mailgun HTTP API |
| Validation | Zod 4 |
| Deployment | Docker on Coolify |
| CI | GitHub Actions (lint, typecheck, unit, E2E, build, migration smoke, container smoke) |

## Prerequisites

- **Node.js 22 LTS** (Node 20 is deprecated on GitHub-hosted runners as of Sept 2025 and is force-redirected to Node 24; pin to 22 explicitly)
- **npm 9+**
- **PostgreSQL 16** (the production image uses `postgres:16-alpine`; the dev workflow uses whatever you have running on `localhost:5432`)

## Quickstart (local dev)

```bash
# Clone
git clone https://github.com/camster91/taekwondo-tournament.git
cd taekwondo-tournament

# Install (postinstall runs `prisma generate` automatically)
npm install

# Create a local .env — see .env.example for the full list of keys
cp .env.example .env
# Edit .env and set DATABASE_URL, JWT_SECRET, NODE_ENV=development

# Sync the schema to your local Postgres (idempotent — see the
# "Migrations" section below for why we use db:push, not migrate)
npm run db:push

# Start the dev servers: Vite on :5173 + Express on :3001
npm run dev
```

The app is at `http://localhost:5173`. The Vite dev server proxies `/api/*` to the Express backend on `:3001`. Health check: `curl http://localhost:3001/api/health/ready` returns `{"status":"ok","db":"ok"}` once the DB is up.

### Migrations

This repo does **not** have a `prisma/migrations/` directory and uses `db:push` exclusively for schema sync. The trade-off: every `schema.prisma` change is applied directly to the database (no migration history). This is appropriate for the current single-tenant pilot; when real migrations are added, the migration workflow will switch to `prisma migrate dev` / `prisma migrate deploy` and the Docker entrypoint will move to the deploy path.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite (`:5173`) + Express (`:3001`) concurrently, with HMR |
| `npm run dev:client` | Vite only |
| `npm run dev:server` | `tsx watch src/server/index.ts` only |
| `npm run build` | `prisma generate` + Vite build + server `tsc` |
| `npm run start` | Production server (`NODE_ENV=production node server.js`) |
| `npm run build:manifest` | Capture per-chunk sizes into `dist/bundle-manifest.json` + `docs/bundle-sizes.md`; enforces bundle budgets |
| `npm run analyze` | Build with `ANALYZE=1` to emit `dist/stats.html` (treemap) |
| `npm run typecheck` | `tsc` for server and client |
| `npm run lint` | `eslint src` |
| `npm test` | Vitest unit suite |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:coverage` | Vitest with coverage report |
| `npm run test:e2e` | Playwright (needs Postgres + Chromium) |
| `npm run test:e2e:install` | One-time browser install |
| `npm run db:generate` | `prisma generate` (also runs in `postinstall`) |
| `npm run db:push` | `prisma db push` (idempotent schema sync) |
| `npm run db:studio` | Prisma Studio |
| `npm run seed` | `tsx prisma/seed.ts` (TKD-only seed data) |

## Project Structure

```
src/
├── client/                 # React 19 SPA
│   ├── pages/              # Route pages (PublicRegister, Scorekeeper, ...)
│   ├── components/         # UI + brand
│   ├── context/            # Auth, Theme, Toast
│   └── utils/              # Frontend utilities (api, csv-export, ...)
├── server/                 # Express + Prisma
│   ├── routes/             # auth, public, tournaments, divisions, brackets, ...
│   ├── middleware/         # auth, validate
│   ├── services/           # bracket-generator, pdf-export, email, ...
│   └── utils/              # errors, registration-management-token, ...
└── shared/                 # cross-cut constants (belts, age-groups, sport-profiles, ...)

prisma/
├── schema.prisma          # 23 models, single source of truth
└── seed.ts                # TKD-only dev seed

tests/
└── e2e/                   # Playwright

docs/                      # audit reports, bundle-sizes, deployment notes

dist/                      # vite build (client)
dist-server/              # tsc -p tsconfig.server.json (server)
```

For the full API route table, see [CLAUDE.md](./CLAUDE.md#api-reference).

## API Endpoints (overview)

| Group | Routes |
| --- | --- |
| `/api/auth` | magic-link request/verify, demo login, user management, profile |
| `/api/tournaments` | CRUD, registrations, weight classes, rules, divisions |
| `/api/divisions` | create, assign competitors, PDF export |
| `/api/brackets` | generate, score, advance, undo |
| `/api/competitors` | list, search, history |
| `/api/invites` | staff invitation lifecycle |
| `/api/public` | unauthenticated: tournament detail, public scoreboard, registration, management |
| `/api/sports` | sport profile enumeration |

The full table (with auth requirements, rate limits, and rate-limit details) lives in [CLAUDE.md](./CLAUDE.md#api-reference).

## Excel Import Format

The system accepts `.xlsm` files with competitor rosters. The server-side parser auto-maps column headers case-insensitively; common headers (name, belt, age, weight, gender, school, events) are recognized out of the box, and the column-mapping UI lets the director override any guess. See `src/server/services/excel-auto-map.ts` for the recognition rules.

## Deployment

This is a **Docker** app, deployed to **Coolify** (or any host that runs the published image). The full source of truth is `docker-compose.yml` + `Dockerfile` + `.github/workflows/build-and-push.yml`.

### Required runtime environment

| Variable | Required? | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string (set at deploy time, never baked in) |
| `JWT_SECRET` | yes | HS256 secret, ≥ 32 random chars; `auth.ts` hard-exits in production if unset |
| `NODE_ENV` | yes | `production` in the deployed image |
| `ALLOWED_ORIGINS` | yes | Comma-separated CORS origins |
| `PUBLIC_APP_URL` | yes | Public URL of the deployed app (used in email links, public scoreboard QR codes) |
| `METRICS_TOKEN` | yes | Token for the `/metrics` endpoint |
| `MAILGUN_API_KEY` | yes | For magic-link emails; can be omitted in dev-mode (codes logged to console) |
| `MAILGUN_DOMAIN` | yes | Mailgun sending domain |
| `EMAIL_FROM_ADDRESS` | yes | e.g. `noreply@bowin.example` |
| `REGISTRATION_CONSENT_VERSION` | yes | The consent version string parents accept at registration |
| `PRIVACY_NOTICE_URL` | yes | URL of the privacy notice linked from the registration form |
| `TOURNAMENT_TERMS_URL` | yes | URL of the tournament terms linked from the registration form |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_*_PRICE_ID` | optional | Only required if Stripe billing is enabled for the install |
| `ADMIN_SETUP_KEY` | optional | Gates the first-admin setup route |
| `ENABLE_DEMO_LOGIN` | optional | `1` enables the dev-only demo login (NEVER set in production) |
| `RETENTION_PURGE_ENABLED`, `SOFT_DELETE_RETENTION_DAYS` | optional | Destructive retention stays off until the operator's policy is approved |

### Docker

```bash
# Build the image (the production Dockerfile is multi-stage; use buildx for ARM64)
docker build -t bowin-tournament-os:latest .

# Run with required env from a file
docker run --env-file .env.production -p 3001:3001 bowin-tournament-os:latest
```

### Docker Compose

`docker-compose.yml` is the **local + small-deploy** story. It wires the app to a Postgres service on a private `tkd-net` bridge network; the DB is **not** bound to the host. Production-shaped installs use Coolify's external Postgres service instead.

```bash
POSTGRES_PASSWORD="replace-with-a-strong-password" \
JWT_SECRET="replace-with-at-least-32-random-characters" \
docker-compose up -d
```

### CI / CD

- `.github/workflows/ci.yml` — lint, typecheck, unit, audit, build, migration smoke, E2E (chromium/firefox/webkit), container smoke. Required status checks (configured by repo admin).
- `.github/workflows/build-and-push.yml` — multi-arch (amd64 + arm64) image build + push to `ghcr.io/camster91/taekwondo-tournament`. Publishes on `main` and on `v*` tags.
- `.github/workflows/deploy-coolify.yml` — Coolify webhook trigger; this is the deploy target.

The release flow (PR → merge → image build → Coolify deploy) is documented in [CONTRIBUTING.md](./CONTRIBUTING.md).

## Testing

```bash
# Unit (no DB)
npm test

# Unit + coverage
npm run test:coverage

# E2E (needs Postgres + Chromium installed once)
npm run test:e2e:install
npm run test:e2e
```

The E2E suite covers login, public register, public register (a11y), scorekeeper (a11y), checkin, organization lifecycle, organization settings, billing webhooks, observability, and a responsive-matrix walkthrough. Per `playwright.config.ts`, Playwright starts its own dev server with `ENABLE_E2E_AUTH_BYPASS` + `RATE_LIMIT_DISABLED`; a manually-started `npm run dev` server lacks those flags, so stop it first.

## Release Status

The current release candidate is intended for a controlled, supervised pilot — not unattended self-service signup or a federation-scale event. See [the SaaS launch checklist](docs/SAAS-LAUNCH-CHECKLIST.md), [deployment runbook](docs/DEPLOY.md), and [operator quickstart](docs/OPERATOR-QUICKSTART.md) before using real competitor data.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full delivery guide: issue lifecycle, branching (`agent/<issue>-<short-description>`), Conventional Commits, draft-PR workflow, required PR sections, review checklist, closing-the-issue rule, and the emergency break-glass path.

## License

Bowin is proprietary software, copyright 2026 Cameron Ashley. The repository is marked `UNLICENSED`; hosted access does not grant source-code copying, modification, or redistribution rights. Third-party components remain subject to their own licenses and attribution requirements.

---
Developed by Cameron Ashley / Nexus AI.
