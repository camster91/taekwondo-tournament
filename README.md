# Martial Arts Tournament Management System

**A real-time tournament operations platform for independent Taekwondo schools, covering registration, categorization, brackets, check-in, scoring, schedules, and public results.**

Bowin is currently being prepared as an approval-based managed pilot. Taekwondo is the only market-supported discipline: its workflows and Newton's Championship-style rules have automated coverage and pilot data-fit evidence. Configurable profiles for other martial arts exist in the codebase, but they are experimental until each ruleset is reviewed and validated with qualified organizers.

## Discipline Status

| Status | Discipline | Scope |
|--------|------------|-------|
| Managed-pilot candidate | Taekwondo | Sparring and patterns; organizer review of the event rules remains mandatory |
| Experimental profiles | Karate, Judo, BJJ, Wrestling, Muay Thai, Boxing, Kickboxing, MMA, Kung Fu | Configuration starting points only; not commercially supported or federation-certified |

## What it does

- **Registration**: staff entry, Excel/CSV import with column auto-mapping, and a public self-registration form with parental consent, waitlist, optional entry-fee checkout, and confirmation emails.
- **Divisions**: automatic categorization by belt, gender, age, event and weight class, with manual moves, splits and merges.
- **Brackets**: double and single elimination with byes, seeding and school separation; correctable results with a full audit trail; PDF brackets, certificates and school reports.
- **Event day**: check-in with weigh-in, an offline-capable scorekeeper, a director control room, ring schedules with delay propagation, and a public scoreboard for TVs and parents.
- **Organizations**: multi-tenant organizations, staff invitations with roles, per-tournament access grants, branded public pages and custom domains, and Stripe billing (optional).

## Tech stack

| Category | Technology |
|----------|------------|
| Frontend | React 19 + Vite 7 + TypeScript, Tailwind CSS v4, TanStack Query |
| Backend | Node.js 22 + Express 4 |
| Database | PostgreSQL 16 via Prisma 7 (checked-in migrations) |
| PDF / Excel | jsPDF, SheetJS |
| Email | Mailgun HTTP API |
| Deployment | One Docker image (serves the SPA and `/api`) + PostgreSQL |

## Local development

Requires Node.js 22 and a reachable PostgreSQL 16.

```bash
git clone https://github.com/camster91/taekwondo-tournament.git
cd taekwondo-tournament
cp .env.example .env          # set DATABASE_URL and JWT_SECRET
npm install                   # also runs prisma generate
npm run db:migrate:deploy     # apply the checked-in migrations
npm run seed                  # optional sample tournament
npm run dev                   # Vite on :5173, API on :3001
```

Without Mailgun configured, sign-in links and codes are printed to the server console.

Useful scripts: `npm run typecheck`, `npm run lint`, `npm test` (unit), `npm run test:e2e` (Playwright), `npm run build`.

Schema changes need a migration (`npm run db:migrate` creates one against a local database). Never run `db:push` against staging or production.

## Deployment

The app ships as a single Docker image built from `Dockerfile`. On start the container runs `prisma migrate deploy` and then the server; `/api/health/ready` is its health check. Any Docker host works:

- **Coolify** (or any platform that builds from a Dockerfile): see [docs/DEPLOY.md](docs/DEPLOY.md#coolify) for the settings and environment variables.
- **VPS script**: `scripts/deploy-production.sh` performs a verified, rollback-safe deploy to the Ashbi VPS.

Before real events, work through [docs/LAUNCH-STATUS.md](docs/LAUNCH-STATUS.md) (what is done and the operator checklist).

## Documentation

- [CLAUDE.md](CLAUDE.md): codebase guide, API reference, security model
- [docs/DEPLOY.md](docs/DEPLOY.md): configuration, deployment and rollback
- [docs/LAUNCH-STATUS.md](docs/LAUNCH-STATUS.md): current status and launch checklist
- [docs/OPERATOR-QUICKSTART.md](docs/OPERATOR-QUICKSTART.md): running an event
- [docs/help/](docs/help/): end-user help articles
- [CONTRIBUTING.md](CONTRIBUTING.md): branch, PR and CI rules

## License

Bowin is proprietary software, copyright 2026 Cameron Ashley. The repository is marked `UNLICENSED`; hosted access does not grant source-code copying, modification, or redistribution rights. Third-party components remain subject to their own licenses and attribution requirements.

