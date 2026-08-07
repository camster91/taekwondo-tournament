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
| Deployment | Docker / Coolify |

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

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tournaments` | List tournaments |
| POST | `/api/tournaments` | Create tournament |
| GET | `/api/tournaments/:id` | Get tournament details |
| POST | `/api/tournaments/:id/import` | Import Excel roster |
| GET | `/api/tournaments/:id/brackets` | Get brackets |
| POST | `/api/brackets/:id/score` | Submit score |
| GET | `/api/displays/:ring` | Get ring display data |

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

### Docker

```bash
# Build image
docker build -t tournament-app .

# Run container
docker run --env-file .env.production -p 3001:3001 tournament-app
```

### Docker Compose

```bash
POSTGRES_PASSWORD="replace-with-a-strong-password" \
JWT_SECRET="replace-with-at-least-32-random-characters" \
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

The repository's license metadata is not release-ready: `LICENSE` is an unfilled MIT template while `package.json` declares ISC. The legal operator must choose one license, insert the correct owner/year, and make all three locations agree before distribution.

---
Developed by Cameron Ashley / Nexus AI.
