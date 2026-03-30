# Tournament Manager — Codebase Guide

This repository contains both raw tournament data (PDFs, Excel) for Newton's Championship 2025 and a full-stack multi-sport **Tournament Manager** SaaS application.

---

## Repository Layout

```
/
├── app/                             # Full-stack web application
├── 2025 NEWTONS CHAMPIONSHIP LIST.xlsm
├── Tournament ScheduleNewSparring.pdf
├── BB Females Patterns/             # Black Belt female patterns brackets
├── BB Females Sparring/
├── BB Males Patterns/
├── BB Males Sparring/
├── CB Females Patterns/
├── CB Females Sparring/
├── CB Males Patterns/
└── CB Males Sparring/
```

---

## Application (`app/`)

### Running Locally

```bash
cd app
npm install
npm run db:push     # Sync Prisma schema → SQLite (no migrations needed)
npm run dev         # Start Vite dev server (http://localhost:5173)
```

**IMPORTANT**: Always use the local Prisma binary, not global:
```bash
./node_modules/.bin/prisma db push --accept-data-loss
./node_modules/.bin/prisma generate
```
The globally installed `npx prisma` may be a different version (v7.x) and will fail. The project uses Prisma **v5.22.0**.

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript + Vite |
| Styling | Tailwind CSS v4 |
| State/Data | TanStack Query v5 (React Query) |
| Backend | Node.js + Express |
| ORM | Prisma v5.22.0 |
| Database | SQLite (`prisma/tournament.db`) |
| Auth | JWT + Magic Link (email OTP) |
| PDF | jsPDF (server-side generation) |
| Excel | SheetJS (xlsx) |

---

## Project Structure

```
app/
├── prisma/
│   ├── schema.prisma              # Database schema (source of truth)
│   └── seed.ts                    # Development seed data
├── src/
│   ├── server/
│   │   ├── index.ts               # Express app setup, route registration
│   │   ├── middleware/
│   │   │   └── auth.ts            # JWT authentication middleware
│   │   ├── routes/
│   │   │   ├── auth.ts            # Magic link auth, JWT issue/verify
│   │   │   ├── brackets.ts        # Bracket generation + PDF export
│   │   │   ├── competitors.ts     # Competitor CRUD + Excel import
│   │   │   ├── divisions.ts       # Division management + auto-categorize
│   │   │   ├── public.ts          # Public registration (no auth)
│   │   │   ├── sports.ts          # Sport profiles API
│   │   │   ├── tournaments.ts     # Tournament CRUD + registrations
│   │   │   ├── analytics.ts       # Dashboard analytics
│   │   │   ├── fairness.ts        # Fairness/rating system
│   │   │   └── invites.ts         # User invitations
│   │   ├── services/
│   │   │   ├── categorization-engine.ts  # Auto-division logic
│   │   │   ├── bracket-generator.ts      # Double-elimination bracket
│   │   │   ├── pdf-export.ts             # PDF generation (brackets, certs)
│   │   │   ├── excel-import.ts           # Excel parsing + mapping
│   │   │   ├── backup-recovery.ts        # Division state snapshots
│   │   │   └── email.ts                  # SMTP email sender
│   │   └── utils/
│   │       └── errors.ts          # Typed error helpers
│   ├── client/
│   │   ├── main.tsx               # React entry point
│   │   ├── App.tsx                # Router, layout, navigation
│   │   ├── context/
│   │   │   ├── AuthContext.tsx    # Auth state + getAuthHeaders()
│   │   │   ├── ThemeContext.tsx   # Dark/light mode
│   │   │   └── ToastContext.tsx   # Toast notifications
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Competitors.tsx    # Competitor registry
│   │   │   ├── Tournaments.tsx    # Tournament list + create
│   │   │   ├── TournamentDetail.tsx
│   │   │   ├── TournamentSettings.tsx
│   │   │   ├── Divisions.tsx      # Division management + PDF export
│   │   │   ├── BracketEditor.tsx  # Visual bracket editor
│   │   │   ├── Schedule.tsx       # Ring/time schedule
│   │   │   ├── CheckIn.tsx        # Day-of check-in
│   │   │   ├── Scorekeeper.tsx    # Real-time match scoring
│   │   │   ├── Results.tsx        # Results + export (CSV/Excel/PDF)
│   │   │   ├── PublicRegister.tsx # Public self-registration form
│   │   │   ├── PublicScoreboard.tsx
│   │   │   ├── Analytics.tsx
│   │   │   ├── UserManagement.tsx
│   │   │   ├── Profile.tsx
│   │   │   ├── Login.tsx
│   │   │   └── VerifyMagicLink.tsx
│   │   └── components/
│   │       ├── ui/                # Shared UI primitives
│   │       │   ├── Skeleton.tsx
│   │       │   ├── EmptyState.tsx
│   │       │   ├── ConfirmDialog.tsx
│   │       │   ├── Spinner.tsx
│   │       │   └── Toast.tsx
│   │       ├── MatchTimer.tsx
│   │       └── ProtectedRoute.tsx
│   └── shared/
│       └── constants/
│           ├── sport-profiles.ts  # Multi-sport configuration
│           ├── belts.ts           # Belt normalization
│           ├── age-groups.ts      # Age group definitions
│           ├── weight-classes.ts  # Default weight classes
│           └── fairness-config.ts
```

---

## Authentication

All protected API routes require:
```
Authorization: Bearer <jwt_token>
```

**Client pattern** — every protected mutation must include auth headers:
```typescript
import { getAuthHeaders } from '../context/AuthContext';

// With body:
headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }

// DELETE (no body):
headers: getAuthHeaders()
```

`getAuthHeaders()` reads the JWT from `localStorage.getItem('auth_token')`.

Magic link flow: user enters email → receives 6-digit OTP → OTP verified → JWT issued.

---

## Multi-Sport Architecture

The app supports multiple sports via `SportProfile` constants:

**Supported sports**: Taekwondo, Karate, Judo, Wrestling, BJJ

```typescript
// app/src/shared/constants/sport-profiles.ts
import { getSportProfile, SPORT_PROFILES } from '../shared/constants/sport-profiles';

const profile = getSportProfile('taekwondo'); // or 'karate', 'judo', etc.
profile.eventTypes[0]  // first event type (e.g. Patterns/Kata/Randori)
profile.eventTypes[1]  // second event type (e.g. Sparring/Kumite)
profile.beltConfig.levels  // belt hierarchy
profile.scoringConfig.penaltyName  // e.g. "Gamjeon", "Shido"
```

Tournaments store `sportProfileSlug` (default: `'taekwondo'`). All UI pages derive labels from the sport profile:
- `Divisions.tsx` — event type labels and filter options
- `Scorekeeper.tsx` — event labels, penalty names
- `PublicRegister.tsx` — belt options, event checkboxes
- `categorization-engine.ts` — division names via `config.eventTypeLabels`

**Internal event key mapping**: The DB always stores `eventType: 'patterns' | 'sparring'` for the two event slots. Sport-specific labels are display-only.

---

## Database

Schema lives in `app/prisma/schema.prisma`. Key models:

| Model | Purpose |
|-------|---------|
| `User` | Auth users with role (`admin`, `director`, `scorekeeper`, `viewer`) |
| `Tournament` | Tournament record with `sportProfileSlug`, `status`, `settings` (JSON) |
| `Competitor` | Global competitor registry |
| `Registration` | Competitor ↔ Tournament link; `patterns`, `sparring` booleans; `checkedIn`, `checkInTime`, `checkInWeight` |
| `Division` | Auto-generated or manual division with `beltLevel`, `gender`, `eventType` |
| `DivisionAssignment` | Competitor ↔ Division seeding |
| `Bracket` | Double-elimination bracket; `structure` (JSON) |
| `Match` | Individual match with `status`, `score1/2`, `winnerId` |
| `WeightClass` | Per-tournament weight class config (overrides defaults) |
| `Organization` | Multi-tenant org (nullable FK on Tournament) |
| `OrganizationMember` | User ↔ Org role mapping |
| `MagicLink` | OTP codes for passwordless auth |

**To update schema:**
```bash
cd app
./node_modules/.bin/prisma db push --accept-data-loss
./node_modules/.bin/prisma generate
```

---

## Key Patterns

### React Query
All data fetching uses TanStack Query v5:
```typescript
const { data, isLoading } = useQuery({
  queryKey: ['tournament', id],
  queryFn: async () => {
    const res = await fetch(`/api/tournaments/${id}`);
    return res.json();
  },
});

const mutation = useMutation({
  mutationFn: async (payload) => {
    const res = await fetch('/api/...', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('...');
    return res.json();
  },
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['...'] }),
});
```

### EmptyState component
```typescript
// action only accepts onClick, not href
<EmptyState
  icon={Users}
  title="No items"
  description="..."
  action={{ label: 'Create', onClick: () => ... }}
/>
```

### Form validation (server)
All POST/PUT routes use Zod schemas via `validateRequest(schema)` middleware.

### Tournament Status Lifecycle
`draft` → `registration` (open for public signup) → `active` (tournament day) → `completed`

---

## API Reference

### Competitors
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/competitors` | Yes | List with `?search=&limit=&belt=` |
| POST | `/api/competitors` | Yes | Create |
| PUT | `/api/competitors/:id` | Yes | Update |
| DELETE | `/api/competitors/:id` | Yes | Delete |
| POST | `/api/competitors/import` | Yes | Bulk import from Excel |
| GET | `/api/competitors/template` | Yes | Download import template |

### Tournaments
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/tournaments` | Yes | List all |
| POST | `/api/tournaments` | Yes | Create (with `sportProfileSlug`) |
| GET | `/api/tournaments/:id` | Yes | Get with counts |
| PUT | `/api/tournaments/:id` | Yes | Update (status, settings, weight classes) |
| DELETE | `/api/tournaments/:id` | Yes | Delete |
| GET | `/api/tournaments/:id/registrations` | Yes | List registrations |
| POST | `/api/tournaments/:id/registrations` | Yes | Add single |
| POST | `/api/tournaments/:id/registrations/bulk` | Yes | Add multiple |
| PUT | `/api/tournaments/:id/registrations/:regId` | Yes | Update (checkedIn, patterns, sparring, weight) |
| DELETE | `/api/tournaments/:id/registrations/:regId` | Yes | Remove |
| GET | `/api/tournaments/:id/weight-classes` | Yes | List weight classes |
| PUT | `/api/tournaments/:id/weight-classes` | Yes | Replace all weight classes |

### Divisions
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/divisions/tournament/:id` | No | List divisions |
| POST | `/api/divisions/tournament/:id/auto-generate` | Yes | Auto-categorize |
| POST | `/api/divisions/tournament/:id/preview` | Yes | Preview (no DB write) |
| POST | `/api/divisions` | Yes | Create manual division |
| PUT | `/api/divisions/:id` | Yes | Update |
| DELETE | `/api/divisions/:id` | Yes | Delete |
| POST | `/api/divisions/:id/split` | Yes | Split large division |
| GET | `/api/divisions/tournament/:id/backup` | Yes | Get backup |
| POST | `/api/divisions/tournament/:id/restore` | Yes | Restore from backup |

### Brackets
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/brackets/division/:id/generate` | Yes | Generate bracket |
| GET | `/api/brackets/tournament/:id/generate-all` | Yes | Generate all |
| PUT | `/api/brackets/matches/:id/result` | Yes | Record match result |
| GET | `/api/brackets/division/:id/pdf` | No | Single bracket PDF |
| GET | `/api/brackets/tournament/:id/pdf` | No | All brackets PDF |
| GET | `/api/brackets/tournament/:id/results/pdf` | No | Results PDF |
| GET | `/api/brackets/tournament/:id/school-report` | No | School report PDF |

### Sports
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/sports` | No | List all sport profiles |
| GET | `/api/sports/:slug` | No | Get single sport profile |

### Public (no auth)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/public/tournaments` | Open tournaments (status=registration) |
| GET | `/api/public/tournaments/:id` | Tournament details for registration |
| POST | `/api/public/register` | Self-register (rate limited: 10/15min) |
| GET | `/api/public/check-registration` | Check if already registered |

---

## Categorization Engine

`app/src/server/services/categorization-engine.ts`

Splits registrations into divisions by:
1. Belt level (BB = isBlackBelt(), CB = everything else)
2. Gender (M/F)
3. Age group (uses `DEFAULT_AGE_GROUPS` or `BB_AGE_GROUPS`)
4. Event type (patterns = no weight class, sparring = grouped by weight)
5. Belt color groups (CB patterns only)
6. Dan rank groups (BB patterns only)

**Config options** (`CategorizationConfig`):
- `divisionThreshold` — max competitors per division (default 8, triggers split)
- `eventTypeLabels` — `{ patterns: 'Kata', sparring: 'Kumite' }` for sport-specific names
- `customWeightClasses` — DB weight classes (from `WeightClass` table); falls back to `DEFAULT_WEIGHT_CLASSES`
- `enableSmartSplitting/Merging` — balance-aware splits and adjacent-division merges

---

## PDF Export

All PDF generation is server-side in `pdf-export.ts` using jsPDF. The server sends the PDF as `application/pdf` response.

Client download pattern:
```typescript
const res = await fetch(`/api/brackets/division/${divisionId}/pdf`);
const blob = await res.blob();
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'bracket.pdf';
a.click();
URL.revokeObjectURL(url);
```

---

## Email Configuration

Set environment variables for SMTP:
```
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=user@example.com
SMTP_PASS=password
EMAIL_FROM_NAME=Tournament Manager
EMAIL_FROM_ADDRESS=noreply@example.com
```

When not configured, email functions log to console (dev mode). Magic link codes are printed to server console.

---

## Development Conventions

### TypeScript
- Zero TS errors enforced across the project
- `noEmit` check: `npx tsc --noEmit` (run from `app/`)
- Avoid `any` types; use proper interface definitions

### File modifications
- Read a file before editing it
- Server routes use `async/await` with try/catch or rely on Express error handler
- Client mutations always include auth headers via `getAuthHeaders()`

### Git branch
Active development branch: `claude/finalize-app-TbEVi`

### Database changes
After any `schema.prisma` modification:
```bash
cd app
./node_modules/.bin/prisma db push --accept-data-loss
./node_modules/.bin/prisma generate
```
Then restart the dev server.

---

## Newton's Championship Data (legacy)

The root directory contains static bracket data:
- **BB/CB**: Black Belt / Colored Belt
- **Patterns**: Forms/Poomsae
- **Sparring**: Fighting competition
- **Age Groups**: 4-5, 6-7, 8-9, 10-11, 12-14, 15-17, 18-35, 36+
- **Weight Classes**: Light, Middle, Heavy, Feather

PDF naming: `[Age Range] [Belt Level]-[Belt Rank] [Gender] [Event Type] [Weight Class].pdf`

Example: `10-11 CB-All Blue Belts Males Sparring Heavy.pdf`
