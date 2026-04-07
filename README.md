# Martial Arts Tournament Management System

**A robust, real-time web application designed to orchestrate martial arts tournaments across multiple disciplines, manage competitor brackets, and display live schedules.**

Originally developed for Taekwondo tournaments, this application has evolved into a multi-sport Martial Arts Tournament SaaS, allowing studio owners to seamlessly organize events for any martial art.

## Supported Disciplines

| Martial Art | Belt/Rank System | Event Types |
|-------------|------------------|-------------|
| Taekwondo | Yes | Sparring, Patterns |
| Karate | Yes | Kumite, Kata |
| Judo | Yes | Randori, Kata |
| Brazilian Jiu-Jitsu (BJJ) | Yes (Belts) | Gi, No-Gi |
| Wrestling | No | Folkstyle, Freestyle |
| Muay Thai | No | Full Contact |
| Boxing | No | Amateur, Pro |
| Kickboxing | No | Point, Full Contact |
| MMA | No | Amateur, Pro |
| Kung Fu | Yes | Forms, Sparring |

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
| Database | Prisma ORM + SQLite |
| Styling | Tailwind CSS v4 |
| Charts | Recharts |
| PDF Export | jsPDF |
| Deployment | Docker / Vercel |

## Prerequisites

- Node.js 18+
- npm 9+
- SQLite (included)

## Installation

```bash
# Clone the repository
git clone https://github.com/camster91/taekwondo-tournament.git
cd taekwondo-tournament

# Install dependencies
npm install

# Initialize database
npx prisma generate
npx prisma db push

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
docker run -p 3000:3000 tournament-app
```

### Docker Compose

```bash
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

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push and open a Pull Request

## License

Proprietary - All rights reserved.

---
Developed by Cameron Ashley / Nexus AI.
