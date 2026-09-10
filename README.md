# Martial Arts Tournament Management System

**A real-time tournament operations platform for independent Taekwondo schools, covering registration, categorization, brackets, check-in, scoring, schedules, and public results.**

Bowin is currently being prepared as an approval-based managed pilot. Taekwondo is the only market-supported discipline: its workflows and Newton's Championship-style rules have automated coverage and pilot data-fit evidence. Configurable profiles for other martial arts exist in the codebase, but they are experimental until each ruleset is reviewed and validated with qualified organizers.

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
- **Real-time Sync:** Schedules update across all devices instantly
- **Multi-Ring Support:** Manage multiple rings/mats simultaneously
- **Digital Displays:** Clean, high-contrast UI for TV monitors
- **Delay Propagation:** Automatically adjust schedules when delays occur

### Competitor Management
- **Registration:** Import from Excel or manual entry
- **Check-in System:** Track competitor arrival and readiness
- **Weight Verification:** Record verified weights for weight-class events
- **Belt Verification:** Confirm rank eligibility

### Scoring & Results
- **Custom Scoring:** Sport-specific scoring rules
- **Judge Interface:** Easy-to-use scoring panels
- **Live Results:** Real-time bracket updates
- **Medal Standings:** Track school/team standings

## Tech Stack

| Category | Technology |
|----------|------------|
| Frontend | React 19 + Vite + TypeScript |
| Backend | Node.js + Express |
| Database | Prisma ORM + PostgreSQL 16 |
| Styling | Tailwind CSS v4 |
| Charts | Recharts |
| PDF Export | jsPDF |
| Deployment | Docker + Traefik (VPS) |

## Prerequisites

- Node.js 20.19+ (Node.js 22 LTS recommended)
- npm 9+
- PostgreSQL 16

## Installation

```bash
# Clone the repository
git clone https://github.com/camster91/taekwondo-tournament.git
cd taekwondo-tournament

# Install dependencies
npm install

# Configure DATABASE_URL, then initialize the development database
npx prisma generate
npx prisma migrate dev

# Start development server
npm run dev
```

## Usage

### Development

```bash
# Run both frontend and backend
npm run dev

# Run frontend only
npm run dev:client

# Run backend only
npm run dev:server
```

### Production Build

```bash
# Build both frontend and backend
npm run build

# Start production server
npm run start
```

### Database Management

```bash
# Generate Prisma client
npm run db:generate

# Push schema changes
npm run db:push

# Run migrations
npm run db:migrate

# Open Prisma Studio
npm run db:studio

# Seed sample data
npm run seed
```

## Project Structure

```
src/
├── client/                 # React frontend
│   ├── components/        # UI components
│   ├── pages/             # Route pages
│   ├── hooks/             # Custom hooks
│   └── utils/             # Frontend utilities
├── server/                 # Express backend
│   ├── routes/            # API routes
│   ├── middleware/        # Express middleware
│   ├── services/          # Business logic
│   └── utils/             # Backend utilities
└── shared/                 # Shared types and utilities

prisma/
├── schema.prisma          # Database schema
└── seed.ts                # Seed data

public/
└── index.html             # Entry HTML

dist/                       # Production build (frontend)
dist-server/               # Production build (backend)
```

## API Endpoints

> This table is a quick-reference. The full API surface is documented in `CLAUDE.md` ("API reference") — every route is mounted under `/api/{auth,tournaments,competitors,brackets,divisions,public,analytics,invites,sports,rules,incidents,support,recommendations,organizations,billing,sos-alerts,custom-domains,tournament-templates}`. The four endpoints below were previously mis-listed (they 404'd); they have been corrected to the real mounted routes.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tournaments` | List tournaments |
| POST | `/api/tournaments` | Create tournament |
| GET | `/api/tournaments/:id` | Get tournament details |
| POST | `/api/competitors/import` | Import Excel roster (`src/server/routes/competitors.ts:643`) |
| GET | `/api/brackets/division/:divisionId` | Get a division's bracket (`src/server/routes/brackets.ts:329`) |
| PUT | `/api/brackets/match/:matchId` | Submit score for a match (`src/server/routes/brackets.ts:373`) |
| GET | `/api/public/scoreboard/:publicSlug` | Get public scoreboard data by per-tournament slug (`src/server/routes/public.ts:681`) |

## Excel Import Format

The system accepts `.xlsm` files with competitor rosters. Expected columns:
- Name
- Belt/Rank
- Age
- Weight
- Gender
- School/Affiliation
- Events (Sparring, Patterns, etc.)

## Deployment

**Production deployment** is performed via `scripts/deploy-production.sh`, which executes an immutable, rollback-safe deployment to the Ashbi VPS (187.77.26.99). The script:

1. Uploads a verified source archive to the VPS
2. Builds a Docker image on-host from the immutable source
3. Validates a private candidate container
4. Performs a stopped-write cutover with automatic database backup
5. Runs `prisma migrate deploy` to apply pending migrations
6. Automatically rolls back (DB + container) if health checks fail

**Reverse proxy:** Traefik on the VPS terminates TLS and routes `tkd.ashbi.ca` to the live container port.

**Rollback:** Manual rollback procedure is documented in `scripts/deploy-production.sh` with < 5 minute RTO.

See [docs/DEPLOY.md](docs/DEPLOY.md) for full deployment runbook and [scripts/deploy-production.sh](scripts/deploy-production.sh) for the deployment script.

### Local Docker (development/testing)

```bash
# Build image locally
docker build -t bowin-tournament .

# Run with environment file
docker run --env-file .env -p 3001:3001 bowin-tournament
```

### Docker Compose (local development)

```bash
POSTGRES_PASSWORD="strong-password" \
JWT_SECRET="at-least-32-random-characters" \
docker-compose up -d
```

## Testing

```bash
# Run tests
npm run test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## Roadmap

- [ ] White-label packaging for independent dojos/gyms
- [ ] GlowOS integration for voice-controlled schedule updates
- [ ] Payment gateway for registration fees
- [ ] Mobile app for judges
- [ ] Live streaming integration

## Release Status

The current release candidate is intended for a controlled, supervised pilot—not unattended self-service signup or a federation-scale event. See [the SaaS launch checklist](docs/SAAS-LAUNCH-CHECKLIST.md), [deployment runbook](docs/DEPLOY.md), and [operator quickstart](docs/OPERATOR-QUICKSTART.md) before using real competitor data.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push and open a Pull Request

## License

Bowin is proprietary software, copyright 2026 Cameron Ashley. The repository is marked `UNLICENSED`; hosted access does not grant source-code copying, modification, or redistribution rights. Third-party components remain subject to their own licenses and attribution requirements.

---
Developed by Cameron Ashley / Nexus AI.
