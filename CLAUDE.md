# Tournament Manager — Codebase Guide

This repository contains both raw tournament data (PDFs, Excel) for
Newton's Championship 2025 (root-level directories prefixed `BB` /
`CB` for belt division) and a full-stack multi-sport **Tournament
Manager** SaaS application at `src/` and `prisma/`.

The product is branded **bowin** (UI, emails, JWT `iss`/`aud`, cookie
names). Only the repository name (`taekwondo-tournament`) and two
`docker-compose.yml` container names still carry the old identity.

---

## Running locally

```bash
npm install            # also runs `prisma generate` via postinstall
npm run db:push        # sync schema to a disposable local database only
npm run dev            # starts both client (Vite, :5173) and server (Express, :3001)
```

The Vite dev server proxies `/api/*` to `localhost:3001`, so the SPA
sees a single origin. `src/client/utils/api.ts` and similar hit
`/api/...` directly in dev and prod.

`npm run db:push` is for disposable local development databases. Release-bound
schema changes must include a reviewed migration under `prisma/migrations/`;
CI, staging, the Docker entrypoint, and the rollback-safe production deploy run
`prisma migrate deploy`. Never point `db:push` at staging or production.

### Database

PostgreSQL (in production via the linked `markup-postgres` container;
locally, any reachable `DATABASE_URL` works). The schema uses Prisma
7's driver-adapter API (`@prisma/adapter-pg` with `PrismaPg`) — the
client is constructed lazily on first access via a `Proxy` in
`src/server/index.ts`.

```bash
DATABASE_URL=postgresql://taekwondo:***@taekwondo-db:5432/taekwondo_tournament
```

---

## Tech stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | React 19 + TypeScript + Vite 7 | SPA, React Router 7 |
| Styling | Tailwind CSS v4 | `@custom-variant dark` for dark mode |
| State / data | TanStack Query v5 | All client mutations + queries |
| Backend | Node 22 + Express 4 | `express-async-errors` for thrown async handling |
| ORM | Prisma 7.9 | Driver adapter; local `db:push`, checked-in production migrations |
| Database | PostgreSQL | `markup-postgres` container in prod |
| Auth | JWT (HS256, 7-day default) + magic-link OTP | See "Authentication" below |
| PDF | jsPDF 4 (server-side) | `src/server/services/pdf-export.ts` |
| Excel | xlsx (SheetJS) | `src/server/services/excel-import.ts` |
| Email | Mailgun HTTP API (not SMTP) | `src/server/services/email.ts` |
| Validation | Zod 4 | `src/server/middleware/validate.ts` |
| Auth middleware | jsonwebtoken 9 + express-rate-limit 8 | `src/server/middleware/auth.ts` |

The dev script (`npm run dev`) uses `concurrently` to run Vite and
nodemon+ts-node in parallel. Build: `prisma generate && vite build
&& tsc -p tsconfig.server.json`. Server entry point: `server.js`
(produced by `tsc` from `src/server/index.ts`).

---

## Repository layout

```
/                                       # repo root
├── 2025 NEWTONS CHAMPIONSHIP LIST.xlsm
├── Tournament ScheduleNewSparring.pdf
├── BB Females Patterns/                # legacy bracket data
├── BB Females Sparring/
├── ... CB Females / Males / Patterns / Sparring
├── docs/                                # LAUNCH-STATUS.md (current status), DEPLOY.md, help/, archive/ (dated reports)
├── prisma/
│   ├── schema.prisma                    # source of truth
│   ├── migrations/                      # checked-in migration history
│   └── seed.ts                          # dev seed (TKD-only, see "Multi-sport")
├── scripts/
│   ├── deploy-production.sh             # VPS production deploy (rollback-safe)
│   ├── deploy-staging.sh                # VPS staging deploy
│   ├── deploy-demo.sh                   # isolated public demo deploy
│   └── deploy-to-vps.sh                 # legacy stub (use deploy-production.sh)
├── src/                                 # the actual app — there is NO `app/` dir
│   ├── server/
│   │   ├── index.ts                     # Express bootstrap, route mounts
│   │   ├── middleware/
│   │   │   ├── auth.ts                  # authenticate, requireRole, requireTournamentAccess
│   │   │   ├── auth-tournament-access.test.ts
│   │   │   └── validate.ts              # validateRequest(schema)
│   │   ├── routes/
│   │   │   ├── auth.ts                  # magic-link + user mgmt
│   │   │   ├── analytics.ts
│   │   │   ├── brackets.ts
│   │   │   ├── competitors.ts
│   │   │   ├── divisions.ts
│   │   │   ├── invites.ts
│   │   │   ├── public.ts
│   │   │   ├── sports.ts
│   │   │   └── tournaments.ts
│   │   ├── services/
│   │   │   ├── bracket-formats.ts
│   │   │   ├── bracket-generator.ts     # DE bracket + size-aware positions
│   │   │   ├── bracket-generator.test.ts
│   │   │   ├── bracket-positions.test.ts
│   │   │   ├── bracket-formats.test.ts
│   │   │   ├── categorization-engine.ts
│   │   │   ├── email.ts                 # Mailgun HTTP API
│   │   │   ├── email-templates.ts
│   │   │   ├── excel-auto-map.ts
│   │   │   ├── excel-auto-map.test.ts
│   │   │   ├── excel-import.ts
│   │   │   ├── excel-template.ts
│   │   │   ├── match-advancement.ts
│   │   │   ├── pdf-export.ts
│   │   │   ├── schedule-generator.ts
│   │   │   └── backup-recovery.ts
│   │   └── utils/
│   │       └── errors.ts
│   ├── client/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── context/
│   │   │   ├── AuthContext.tsx          # session state; getAuthHeaders() adds the CSRF header
│   │   │   ├── ThemeContext.tsx
│   │   │   └── ToastContext.tsx
│   │   ├── pages/                       # see "Client pages" below
│   │   ├── components/
│   │   │   ├── ui/                       # Skeleton, EmptyState, ConfirmDialog, Spinner, Toast
│   │   │   ├── MatchTimer.tsx
│   │   │   └── TournamentRulesEditor.tsx
│   │   └── utils/
│   │       ├── csv-export.ts
│   │       ├── csv-export.test.ts
│   │       └── test-data.ts
│   └── shared/
│       └── constants/
│           ├── age-groups.ts / .test.ts
│           ├── belts.ts / .test.ts
│           ├── fairness-config.ts
│           ├── index.ts
│           ├── sport-profiles.ts        # 10 sports, see "Multi-sport"
│           ├── tournament-rules.ts
│           ├── weight-classes.ts / .test.ts
├── tests/
│   └── e2e/                             # Playwright (~39 specs)
│       ├── global-setup.ts
│       ├── global-teardown.ts           # wipes e2e test records after suite
│       ├── helpers.ts
│       └── *.spec.ts
├── CLAUDE.md                           # this file
├── Dockerfile                           # production image
├── docker-compose.yml
├── package.json
├── prisma.config.ts                     # Prisma 7 config (NOT a migrations dir)
├── tsconfig.json
├── tsconfig.server.json
├── vite.config.ts
├── vitest.config.ts                     # JWT_SECRET stub for auth.ts load
├── playwright.config.ts
├── .env.example
└── .env                                 # gitignored, real secrets
```

**There is no `app/` directory.** All code lives at the repo root
under `src/`, `prisma/`, `tests/`. Any reference to `app/...` paths
in commit messages, code comments, or the previous version of
this file is wrong.

---

## Client pages

`src/client/pages/`:

| File | Route | Purpose |
|------|-------|---------|
| `Login.tsx` | `/login` | Email + magic-link sign-in |
| `VerifyMagicLink.tsx` | `/verify?token=...` | Consume the magic link |
| `AcceptInvite.tsx` | `/accept-invite?token=...` | Invited-user signup |
| `Dashboard.tsx` | `/` | Director view: counts + recent tournaments |
| `DirectorDashboard.tsx` | `/tournaments/:id/director` | Per-tournament live control room — ring status, staff coverage, division progress, day-of warnings |
| `Staffing.tsx` | `/tournaments/:id/staffing` | Assign staff to rings/times, coverage gaps + double-bookings, printable/CSV roster |
| `MyAssignments.tsx` | `/my-assignments` | Staff run sheet: the viewer's own ring/time/duty lines |
| `Tournaments.tsx` | `/tournaments` | List + create |
| `TournamentDetail.tsx` | `/tournaments/:id` | Overview |
| `TournamentSettings.tsx` | `/tournaments/:id/settings` | Edit settings, weight classes, rules |
| `Competitors.tsx` | `/competitors` | Global registry + Excel import |
| `Divisions.tsx` | `/tournaments/:id/divisions` | Auto-categorize + manage + PDF export |
| `BracketEditor.tsx` | `/tournaments/:id/divisions/:divId/bracket` | Visual editor |
| `Schedule.tsx` | `/tournaments/:id/schedule` | Ring/time schedule |
| `CheckIn.tsx` | `/tournaments/:id/checkin` | Day-of competitor check-in |
| `Scorekeeper.tsx` | `/tournaments/:id/scorekeeper` | Real-time match scoring |
| `Results.tsx` | `/tournaments/:id/results` | Placements + CSV/Excel/PDF export |
| `Trash.tsx` | `/tournaments?trash=true` | Soft-deleted tournaments (Trash page) |
| `UserManagement.tsx` | `/users` | List + role/status mgmt |
| `Profile.tsx` | `/profile` | Own profile |
| `PublicRegister.tsx` | `/register/:tournamentId` | Self-signup form |
| `PublicScoreboard.tsx` | `/display/:tournamentId` | Public bracket view |
| `NotFound.tsx` | `*` | 404 |

`App.tsx` registers the route table; `ProtectedRoute.tsx` is the
client-side auth gate.

---

## Authentication

All `/api/*` routes except `/api/public/*` and `/api/sports/*` require
a session. The browser session is the **HttpOnly `bowin_session`
cookie** (set on login, 7-day `maxAge`); the SPA never sees the JWT.
Non-browser clients and tests may send `Authorization: Bearer <jwt>`
instead. `/ws/brackets` authenticates the same way (cookie or Bearer,
never a query-string token) and re-checks open sockets every 60 s.

**CSRF:** cookie-authenticated `POST`/`PUT`/`PATCH`/`DELETE` requests
must send `X-CSRF-Token` equal to the readable `bowin_csrf` cookie
(double submit), or they get 403. Bearer requests are exempt.

### JWT shape

- HS256, signed with `process.env.JWT_SECRET` (required at boot;
  process exits if missing in production).
- Default TTL: 7 days. The demo login uses a 4-hour TTL via
  `createToken(payload, expiresIn)`.
- Claims: `iss = 'bowin'`, `aud = 'bowin'`, `algorithm: HS256`
  pinned on both `jwt.sign` and `jwt.verify`. Don't relax these.
- The token embeds `User.tokenVersion`; the middleware rejects a
  token whose version no longer matches. Logout, role changes and
  deactivation bump it, so they revoke existing sessions on the next
  request (the user row is read on every authenticated request).

### Client requests

Client mutations spread `getAuthHeaders()` from
`src/client/context/AuthContext.tsx`. It no longer returns a bearer
token; it returns the `X-CSRF-Token` header read from the
`bowin_csrf` cookie. The session cookie is sent automatically on
same-origin requests. The JWT is never in localStorage; the only
auth-related entry there is the offline scorekeeper capability
(`bowin_offline_auth_v2`, `src/client/utils/offline-auth-snapshot.ts`),
a short-lived server-signed capability the client verifies against
the server's public key before restoring an offline session.

### Magic-link / OTP flow

1. `POST /api/auth/request-magic-link` with `{ email }`:
   - Server creates a `MagicLink` row with a 32-byte hex `token`
     and a 6-digit `code`. TTL: 10 minutes.
   - If `isEmailConfigured()` is true (Mailgun creds present),
     sends an email via Mailgun HTTP API.
   - **Dev mode** (no Mailgun): logs `[dev-auth] magic link for ...`
     to the server console with the URL and code. NEVER returned
     in the JSON response.
   - **Auto-create in dev**: unknown emails are auto-created as
     `role: 'viewer'` (NOT admin). Gated by `ENABLE_DEV_AUTH`
     (`'1'` to force, defaults to NODE_ENV !== 'production').
2. User clicks the link (or pastes the code).
3. `POST /api/auth/verify-magic-link` with `{ token }` or
   `{ email, code }`:
   - Brute-force protection: per-`(email, code)` attempt counter
     in memory; after 10 wrong tries the code is invalidated in
     the DB. Caps the attack budget at 10 attempts per code.
   - Returns a JWT + the user object on success.

### Demo login (opt-in)

`POST /api/auth/demo` returns a 4-hour admin JWT for
`demo@ashbi.ca`. **Gated by `ENABLE_DEMO_LOGIN=1`** — defaults to
OFF in production, ON in dev. The demo user is created on first
hit. Don't ship this in production without the flag.

### Roles

```
admin       — global access, bypasses all tournament-level checks
director    — global director role; mutation per-tournament
              requires org membership (see "Multi-tenant")
scorekeeper — can record match results, swap, undo, reset
viewer      — read-only across the board
```

`requireRole(...allowed)` in `src/server/middleware/auth.ts`
gates routes. `requireTournamentAccess(minRole)` is the
multi-tenant gate (see that section).

---

## Multi-tenant (`requireTournamentAccess`)

The middleware lives in `src/server/middleware/auth.ts` and is wired
into the tournament-scoped routes (`requireTournamentAccess(minRole)`
as middleware, or `checkTournamentAccess(...)` inline after resolving
a parent tournamentId). List endpoints scope through
`buildTournamentAccessFilter`; competitor endpoints through
`buildCompetitorAccessFilter` (read) and `buildCompetitorWriteFilter`
(write: every tournament the competitor is registered in must be
accessible).

Authorization precedence (first match wins):

1. **Admin** — global access, including soft-deleted tournaments.
2. **Global role check** — the user's `role` must meet `minRole`
   (a per-tournament grant never exceeds the global role).
3. **Tournament must exist and not be soft-deleted** (404) unless
   the route passes `{ allowDeleted: true }` (trash/restore only).
4. **`UserTournamentAccess` row** for `(user, tournament)` at the
   required level.
5. **Org tournament + user is a member of that org** — effective
   role = min(global role, membership role); `owner`/`admin`
   memberships and `member` count as director; explicit
   `scorekeeper`/`viewer` memberships restrict; unknown roles grant
   nothing.
6. **Orphan tournament (`organizationId` null)** — the legacy
   single-tenant pool, reachable ONLY by users with no org
   memberships. Tenant users never see orphan data (except via
   step 4), and no-org users never see org data.
7. Otherwise — 403.

`Tournament.createdById` records the creator. When a director creates
their first organization, the org-less tournaments they created move
into it (so they don't disappear behind rule 6).

Regression tests: `src/server/middleware/auth-tournament-access.test.ts`
and the opt-in Postgres suite
`src/server/middleware/tenant-isolation.integration.test.ts`
(`TENANT_ISOLATION_DATABASE_URL`).

---

## Multi-sport (status: partial)

`src/shared/constants/sport-profiles.ts` defines 10 sport profiles
(Taekwondo, Karate, Judo, Wrestling, BJJ, Muay Thai, Boxing,
Kickboxing, MMA, Kung Fu). Each profile has:

- `eventTypes[0]`, `eventTypes[1]` — the sport events occupying the
  two storage slots (see below)
- `beltConfig.levels` — belt hierarchy
- `scoringConfig.penaltyName` (e.g. "Gamjeon", "Shido")
- `scoringConfig.defaultRounds` / `defaultRoundDurationSeconds` —
  drive the Scorekeeper `MatchTimer`; the slot event's `isCombat`
  decides multi-round bout vs single-round forms.

The DB always stores `eventType: 'patterns' | 'sparring'`. **Slots map
by position**: `eventTypes[0]` is the `'patterns'` slot and
`eventTypes[1]` the `'sparring'` slot, regardless of name or
`isCombat` (Judo stores Randori as `'patterns'`). Public registration
and the categorization engine depend on this. Always label events with
`getEventTypeLabel(slug, eventType)` / `getEventTypeLabels(slug)` (or
the client hook `useTournamentEventLabels(tournamentId)`), never a
hardcoded "Patterns"/"Sparring" or an `isCombat` lookup.

The DB has a `SportProfile` model (`prisma/schema.prisma`, `model SportProfile`)
that is unused — sport config lives in TS constants. Either
complete the migration to DB-driven sport config, or drop the
unused model.

Seed data (`prisma/seed.ts`) is TKD-only. Adding a Karate or
Judo test seed would prove the multi-sport path end-to-end.

---

## Database

`prisma/schema.prisma` — 37 models. Key models:

| Model | Purpose |
|-------|---------|
| `User` | Auth users. `role` is one of `admin`/`director`/`scorekeeper`/`viewer`. |
| `Tournament` | `status` ∈ `draft`/`registration`/`in_progress`/`completed`. `deletedAt` soft-delete. `organizationId` nullable FK. `sportProfileSlug` (TS-constant only). |
| `Competitor` | Global registry across tournaments. `deletedAt` soft-delete. |
| `Registration` | Competitor ↔ Tournament. `patterns`, `sparring` booleans. `checkedIn`, `checkInTime`, `checkInWeight`. Cascade-deletes on Tournament or Competitor hard-delete. |
| `Division` | Per-tournament divisions. `beltLevel`, `gender`, `eventType`, `deletedAt`. |
| `DivisionAssignment` | Competitor ↔ Division seeding. |
| `Bracket` | `structure` is JSON-stringified `BracketStructure` (winners/losers/finals arrays + `positions` map). Cascade-deletes matches. |
| `Match` | `status` ∈ `pending`/`ready`/`in_progress`/`completed`. `competitor1Id/2/winnerId` are `SetNull` on Competitor delete. |
| `WeightClass` | Per-tournament weight class overrides. |
| `Organization` | Multi-tenant. |
| `OrganizationMember` | User ↔ Org. `@@unique([organizationId, userId])`. |
| `UserTournamentAccess` | Per-tournament role grants. `@@unique([userId, tournamentId])`. |
| `MagicLink` | `token` (32-byte hex) + 6-digit `code`, both stored as SHA-256 hashes (`src/server/utils/token-hash.ts`). |
| `MatchAuditLog` | Every match update records previous + new state. |
| `Invitation` | Staff invite: email, role, hashed token, `status` (pending/accepted/expired/cancelled), last delivery outcome. |
| `StaffAssignment` | Day-of staffing: user + duty + ring (null = whole venue) + `HH:MM` window; `status` active/withdrawn. Never grants access. |
| `SportProfile` | Unused, see "Multi-sport". |

For local experimentation after modifying `schema.prisma`, run
`npm run db:push` and then `npm run db:generate`. A release-bound schema change
must also include and validate a checked-in migration before deployment.
Restart the dev server afterward.

---

## API reference

Generated from a grep of `router\.(get|post|put|delete)` across
`src/server/routes/`. Auth column: `auth` = requires Bearer JWT,
`-` = no auth, `opt` = JWT optional.

Routes are listed with their path as written in the source. The
root endpoint of each router is shown as `/api/<router>` (no
trailing slash) — in code the source file usually has it as
`router.get('/')` but both are equivalent.

### `/api/auth` (mount: `src/server/routes/auth.ts`)

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/api/auth/request-magic-link` | `-` | `authLimiter` 5/15min. Body: `{ email }`. |
| POST | `/api/auth/verify-magic-link` | `-` | `authLimiter`. Body: `{ token }` or `{ email, code }`. |
| POST | `/api/auth/setup` | `-` | `registerLimiter`. First-run admin only. 403 once any user exists. |
| GET | `/api/auth/setup-status` | `-` | `{ needsSetup: count === 0 }`. |
| POST | `/api/auth/setup-admin` | `-` | `registerLimiter`. Gated by `ADMIN_SETUP_KEY` env. |
| POST | `/api/auth/demo` | `-` | **Gated by `ENABLE_DEMO_LOGIN=1`**. 4h admin JWT. |
| POST | `/api/auth/dev-token` | `-` | **Gated by `ENABLE_DEV_AUTH=1`** AND `NODE_ENV !== 'production'`. Mints a JWT for an existing user. |
| POST | `/api/auth/accept-invite` | `-` | `registerLimiter`. Body: `{ token, firstName, lastName }` (passwordless). 410 for accepted/cancelled/expired links. |
| GET | `/api/auth/me` | auth | Returns own user + tournamentAccess. |
| PUT | `/api/auth/profile` | auth | zod `profileUpdateSchema`. |
| GET | `/api/auth/users` | auth | All users. |
| PUT | `/api/auth/users/:userId/role` | admin | zod `roleUpdateSchema`. |
| PUT | `/api/auth/users/:userId/status` | admin | zod `statusUpdateSchema`. |
| POST | `/api/auth/tournaments/:tournamentId/access` | admin | zod `tournamentAccessSchema`. Grant per-tournament role. |
| DELETE | `/api/auth/tournaments/:tournamentId/access/:userId` | admin | Revoke per-tournament access. |

### `/api/tournaments` (`src/server/routes/tournaments.ts`)

All routes require auth. `?trash=true` shows soft-deleted;
`?trash=all` shows everything; default hides soft-deleted.

| Method | Path | Role |
|--------|------|------|
| GET | `/api/tournaments` | any |
| POST | `/api/tournaments` | admin/director |
| GET | `/api/tournaments/:id` | any |
| PUT | `/api/tournaments/:id` | admin/director |
| DELETE | `/api/tournaments/:id` | admin/director (soft by default; `?hard=true` for cascade) |
| POST | `/api/tournaments/:id/restore` | admin/director |
| GET | `/api/tournaments/:id/rules` | any |
| PUT | `/api/tournaments/:id/rules` | admin/director |
| POST | `/api/tournaments/:id/rules/reset` | admin/director |
| GET | `/api/tournaments/:id/registrations` | any |
| POST | `/api/tournaments/:id/registrations` | admin/director |
| POST | `/api/tournaments/:id/registrations/bulk` | admin/director |
| PUT | `/api/tournaments/:id/registrations/:regId` | admin/director |
| DELETE | `/api/tournaments/:id/registrations/:regId` | admin/director |
| GET | `/api/tournaments/:id/weight-classes` | any |
| PUT | `/api/tournaments/:id/weight-classes` | admin/director |
| POST | `/api/tournaments/:id/schedule` | admin/director |
| GET | `/api/tournaments/:id/schedule` | any |
| GET | `/api/tournaments/:id/day-of` | any |
| POST | `/api/tournaments/:id/public-slug` | admin/director (generate/rotate the 16-char public scoreboard slug) |
| DELETE | `/api/tournaments/:id/public-slug` | admin/director (revoke — clears the slug) |

### `/api/divisions` (`src/server/routes/divisions.ts`)

All require auth unless noted. Role on mutations is `admin/director`
unless noted.

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/divisions/tournament/:tournamentId` | |
| GET | `/api/divisions/tournament/:tournamentId/check-data-loss` | |
| POST | `/api/divisions/tournament/:tournamentId/preview` | admin/director |
| POST | `/api/divisions/tournament/:tournamentId/auto-generate` | admin/director |
| POST | `/api/divisions` | admin/director |
| PUT | `/api/divisions/:id` | admin/director |
| DELETE | `/api/divisions/:id` | admin/director |
| POST | `/api/divisions/:id/assign` | scorekeeper+ |
| DELETE | `/api/divisions/:id/assign/:assignmentId` | scorekeeper+ |
| POST | `/api/divisions/:id/move` | scorekeeper+ |
| POST | `/api/divisions/:id/split` | admin/director |
| DELETE | `/api/divisions/tournament/:tournamentId/all` | admin/director (gated) |
| GET | `/api/divisions/tournament/:tournamentId/backup` | |
| POST | `/api/divisions/tournament/:tournamentId/restore` | admin/director |

### `/api/brackets` (`src/server/routes/brackets.ts`)

All require auth. PDF endpoints accept any role (viewer+).
Mutations are scorekeeper+ (or admin/director for generate/reset).

| Method | Path | Role |
|--------|------|------|
| POST | `/api/brackets/division/:divisionId/generate` | admin/director |
| GET | `/api/brackets/division/:divisionId` | any |
| GET | `/api/brackets/division/:divisionId/placements` | any |
| PUT | `/api/brackets/match/:matchId` | scorekeeper+ (zod `matchResultSchema`) |
| POST | `/api/brackets/match/:matchId/swap` | scorekeeper+ |
| GET | `/api/brackets/match/:matchId/audit` | any |
| POST | `/api/brackets/match/:matchId/undo` | scorekeeper+ |
| POST | `/api/brackets/division/:divisionId/reset` | scorekeeper+ |
| POST | `/api/brackets/tournament/:tournamentId/generate-all` | admin/director |
| GET | `/api/brackets/division/:divisionId/pdf` | viewer+ |
| GET | `/api/brackets/tournament/:tournamentId/pdf` | viewer+ |
| GET | `/api/brackets/tournament/:tournamentId/results/pdf` | viewer+ |
| GET | `/api/brackets/division/:divisionId/certificate/:place` | viewer+ |
| GET | `/api/brackets/tournament/:tournamentId/certificates` | viewer+ |
| GET | `/api/brackets/tournament/:tournamentId/school-report` | viewer+ |

### `/api/competitors` (`src/server/routes/competitors.ts`)

All require auth. Mutations: admin/director.

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/competitors` | `?search=&limit=&belt=&weight_min=&weight_max=&gender=` |
| POST | `/api/competitors` | admin/director |
| GET | `/api/competitors/:id` | |
| PUT | `/api/competitors/:id` | admin/director |
| DELETE | `/api/competitors/:id` | admin/director (cascade-deletes history) |
| POST | `/api/competitors/:id/restore` | admin/director (un-soft-delete) |
| DELETE | `/api/competitors/:id/purge` | **admin only** (admin/director + extra gate; hard-deletes a soft-deleted competitor and all history) |
| POST | `/api/competitors/import` | admin/director (zod array) |
| POST | `/api/competitors/auto-map` | admin/director (zod `autoMapSchema`, Excel column auto-detection) |
| GET | `/api/competitors/template` | download CSV import template |
| GET | `/api/competitors/template/mapping` | download the column-mapping template (variant for the auto-map UI) |
| GET | `/api/competitors/meta/aggregates` | dashboard counts |
| GET | `/api/competitors/meta/schools` | distinct school names |
| GET | `/api/competitors/meta/belts` | distinct belt names |

### `/api/sports` (`src/server/routes/sports.ts`)

No auth. Returns TS-constant sport profiles.

| Method | Path |
|--------|------|
| GET | `/api/sports` |
| GET | `/api/sports/:slug` |

### `/api/analytics` (`src/server/routes/analytics.ts`)

All require auth.

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/analytics/dashboard` | called by `Dashboard.tsx` |
| GET | `/api/analytics/tournament/:tournamentId` | no client caller (dead-ish) |

### `/api/invites` (`src/server/routes/invites.ts`)

Auth required. Mutates `Invitation` rows; consumed by
`/api/auth/accept-invite`.

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/invites/send` | Send an invite email. Body: `{ email, firstName, lastName, role }`. |
| GET | `/api/invites` | List all pending + accepted invites. |
| POST | `/api/invites/resend/:id` | Resend the invite email for a specific invitation. |
| DELETE | `/api/invites/:id` | Cancel a pending invite (kept as `cancelled`; its link answers 410), or remove a finished one. |
| GET | `/api/invites/verify/:token` | Public (no auth) — preview an invite before accepting. |

### `/api/staffing` (`src/server/routes/staffing.ts`)

Day-of staffing (#192). Operational only: an assignment never changes
what a user can access. Every ring needs a `scorekeeper` for the whole
schedule window (`REQUIRED_RING_DUTIES` in
`src/server/services/staffing-coverage.ts`); overlapping assignments for
one person are reported as double-bookings (warned, not blocked).

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/staffing/tournament/:tournamentId` | director. Assignments, coverage (gaps, conflicts), eligible staff (users who can open the tournament). |
| POST | `/api/staffing/tournament/:tournamentId/assignments` | director. Body: `{ userId, duty, ringNumber \| null, startTime, endTime, note? }`; the user must be able to open the tournament. |
| PUT | `/api/staffing/assignments/:id` | director. Change duty/ring/times/note of an active assignment. |
| POST | `/api/staffing/assignments/:id/withdraw` | director. Keeps the row as `withdrawn`. |
| GET | `/api/staffing/tournament/:tournamentId/mine` | viewer+. The caller's own active lines. |
| GET | `/api/staffing/mine` | The caller's active lines across open, accessible tournaments. |

Changes are audited in `TournamentOperationAudit` (`staff_assignment_*`).

### `/api/public` (`src/server/routes/public.ts`)

No auth. All write endpoints are rate-limited (`registrationLimiter`
10/15min per IP).

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/public/tournaments` | Open tournaments (`status='registration'`). |
| GET | `/api/public/tournaments/:id` | Metadata for the public form. |
| POST | `/api/public/register` | Self-register. Body: `{ tournamentId, competitor, parentName, parentEmail, parentPhone, events }`. Sends a confirmation email (or logs to console in dev). |
| GET | `/api/public/check-registration` | Query by `tournamentId`+`firstName`+`lastName`+`dateOfBirth`. Returns ONLY a boolean + 8-char confirmation code; rate-limited 20/15min per IP. No PII echoed back. |
| GET | `/api/public/scoreboard/:publicSlug` | Public scoreboard. Requires a per-tournament 16-char `publicSlug` (not the tournament UUID). 404 for missing/wrong slug — indistinguishable from "tournament not found". Rate-limited 30/min per IP. |

Directors generate the slug via `POST /api/tournaments/:id/public-slug`
and revoke it via `DELETE /api/tournaments/:id/public-slug`. Slugs
are 16 base64url chars (~80 bits of entropy).

---

## Bracket structure & `positions`

`src/server/services/bracket-generator.ts` produces a
`BracketStructure` with `winners[]`, `losers[]`, `finals[]`, and a
`positions` map. **`positions` is the lookup map for downstream
code** — never hardcode `matchNumber === 14` for the grand
finals; that only happens to be correct for 8-person DE.

```ts
interface BracketStructure {
  winners: MatchData[];
  losers: MatchData[];
  finals: MatchData[];
  competitorCount: number;
  positions: {
    winnersFinal: number | null;  // last match in `winners`
    losersFinal: number | null;   // last match in `losers`
    grandFinals: number | null;   // finals[0].matchNumber
    reset: number | null;         // finals[1]?.matchNumber (8+ person only)
  };
  seedingInfo?: { strategy, skillBalance, schoolDiversity };
}
```

Correct match numbers by bracket size (all DE):

| N  | winnersFinal | losersFinal | grandFinals | reset | total |
|----|-------------|-------------|-------------|-------|-------|
| 1  | 1           | null        | 1           | null  | 1     |
| 2  | 1           | null        | 1           | null  | 1     |
| 3  | 3           | null        | 3           | null  | 3     |
| 4  | 4           | 3           | 4           | null  | 4     |
| 5-8| 7           | 13          | 14          | 15    | 15    |
| 16 | 15          | 29          | 30          | 31    | 31    |

`getBracketPlacements`, `advanceWinner`'s reset branch, and
`isBracketComplete` all read from `structure.positions`. Legacy
brackets stored in the DB before this field existed fall back to
the old hardcoded 14/15/13/7 values, so production data still
works.

The 24-case regression test in `src/server/services/bracket-positions.test.ts`
pins every size.

Advancement (`match-advancement.ts`) is driven by a pure
`computeBracketSync`: every downstream slot is derived from one fixed
upstream result, byes resolve through the whole bracket (including
empty losers-bracket matches), re-submitting a result is a no-op, a
corrected result replaces the old one downstream, and a change that
would alter an already-started downstream match is rejected (409).
Each advancement locks the bracket row (`SELECT ... FOR UPDATE`).
Single elimination awards a tied 3rd place to both semifinal losers;
no 1st/2nd is reported while an activated DE reset match is unplayed.

**Schema drift check.** `schema.prisma` must match the migration
history. After editing either, apply migrations to a scratch
Postgres and confirm
`npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`
exits 0.

---

## Categorization engine

`src/server/services/categorization-engine.ts` — splits
`Registration` rows into `Division` rows. The 6-step pipeline:
belt level (BB vs CB) → gender → age group → event type
(patterns/sparring) → weight class (sparring only) → belt color
(CB patterns) / dan rank (BB patterns).

Config options (`CategorizationConfig`): `divisionThreshold` (8,
triggers split), `eventTypeLabels`, `customWeightClasses`,
`enableSmartSplitting/Merging`. Sport-specific labels come from
`getSportProfile(tournament.sportProfileSlug)`.

**Fixed:** sparring registrations with no weight are excluded from
auto-categorization with a warning (they used to be treated as 0 lbs
and land in the lightest class). The weight boundary is
`weight < weightMaxLbs`.

**Fixed (Phase 8 follow-up):** `canMerge` previously required
*exact* contiguity (`a.ageMax + 1 === b.ageMin`) for two divisions
to merge — so custom age groups with gaps (e.g. [6-9] and [11-14]
skipping age 10) could never merge even when both were below
`minSize`. Widened to a `GAP_TOLERANCE = 3` year window. Gaps
beyond that (e.g. youth vs adult) are still blocked as deliberate
boundaries.

---

## Security

- **Auth**: JWT (HS256, pinned algorithm + iss + aud on sign and
  verify) in an HttpOnly session cookie with double-submit CSRF.
  7-day default TTL. `JWT_SECRET` required in production, ≥ 32 chars
  enforced. `tokenVersion` revokes sessions on logout / role change /
  deactivation.
- **Demo login** gated by `ENABLE_DEMO_LOGIN=1` (defaults off in
  prod). 4-hour admin JWT.
- **Dev auto-create** in magic-link flow is `role: 'viewer'`,
  gated by `ENABLE_DEV_AUTH=1`. Never auto-promotes to admin.
- **Dev-token endpoint** is gated by both `ENABLE_DEV_AUTH=1` AND
  `NODE_ENV !== 'production'`.
- **OTP brute-force**: per-`(email, code)` attempt counter in
  memory; after 10 wrong tries the code is invalidated in the DB.
- **PDF endpoints** (6 of them in `brackets.ts`) all require
  `authenticate + requireRole('admin', 'director', 'scorekeeper',
  'viewer')`. The previous build had them as public-no-auth.
- **Bracket ops** (`PUT /api/brackets/match/:id`) validate that
  `winnerId` is one of the two competitors (prevents scorekeeper
  from setting a bogus winner that would propagate downstream).
- **Public registration emails** escape every user-controlled
  field with `escapeHtml` from `email-templates.ts` (exported).
- **XSS / template injection**: the previous build's public
  register email was vulnerable to `<script>` in `parentName`; now
  fixed.
- **Security headers**: `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `X-XSS-Protection: 1; mode=block`,
  `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy: camera=(), microphone=(), geolocation=()`,
  and in production: `Strict-Transport-Security` + `Content-Security-Policy`.
- **CORS**: in production, `ALLOWED_ORIGINS` must be set or all
  cross-origin requests are rejected. The dev fallback is `*`.
- **JSON body limit**: 1 MB. Heavy endpoints (Excel import, auto-
  map) parse their own bodies.
- **Rate limits**: `authLimiter` 5/15min on auth routes,
  `registerLimiter` 3/hour on setup, `registrationLimiter` 10/15min
  on public register. `RATE_LIMIT_DISABLED=1` bypasses for tests.
- **Tournament soft-delete**: `DELETE /api/tournaments/:id` sets
  `deletedAt` instead of cascading. `?hard=true` opt-in. List
  endpoint hides soft-deleted by default; `?trash=true` shows
  them; `?trash=all` shows everything. `POST /:id/restore`
  un-sets the flag.
- **Bracket operations** (generate, match update) are wrapped in
  `prisma.$transaction`. The previous build was 3+ naked writes
  per request, which could lose scores during a concurrent
  regenerate.

Known limits:
- Rate limits and the WebSocket fan-out are per process; run one
  replica (see `docs/DEPLOY.md#coolify`).

---

## Environment variables

`.env.example` is the complete, commented list. The ones that matter most:

| Var | Required | Notes |
|-----|----------|-------|
| `DATABASE_URL` | yes | `postgresql://...` |
| `JWT_SECRET` | yes | ≥ 32 chars in prod |
| `ALLOWED_ORIGINS` | yes in prod | comma-separated origins; CORS fails closed without it |
| `PUBLIC_APP_URL` | yes in prod | base URL for links in emails |
| `METRICS_TOKEN` | yes in prod | bearer token for `/api/internal/metrics` |
| `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `EMAIL_FROM_ADDRESS` | yes for email | without the key, auth runs in dev mode |
| `LOGO_STORAGE_PATH` | no | uploaded org logos; default `/app/data/logos` in prod (image `VOLUME /app/data`, mount persistent storage), `./data/logos` in dev |
| `OFFLINE_CAPABILITY_PRIVATE_KEY_BASE64` + build arg `VITE_OFFLINE_CAPABILITY_PUBLIC_KEY_BASE64` | for offline scorekeeping | Ed25519 pair; see DEPLOY.md |
| `ADMIN_SETUP_KEY` | first run only | enables `setup-admin`; remove afterwards |
| `REGISTRATION_CONSENT_VERSION`, `PRIVACY_NOTICE_URL`, `TOURNAMENT_TERMS_URL` | no | consent stamp and legal links (default to `/legal/*`) |
| `RETENTION_PURGE_ENABLED`, `RETENTION_PURGE_DRY_RUN`, `SOFT_DELETE_RETENTION_DAYS` | no | soft-delete purge, off by default |
| `STRIPE_*` | no | self-service billing; omit for manual plans |
| `SENTRY_DSN`, `VITE_SENTRY_DSN` | no | error tracking (Sentry/GlitchTip). Every `VITE_*` var is a Docker build arg (baked into the bundle), not a runtime var |
| `OPENAI_API_KEY` | no | support assistant answers; without it support tickets still work |
| `BUILD_SHA` | no (build arg) | commit reported by `/api/health` |
| `ENABLE_DEMO_LOGIN` + `DEMO_ISOLATED_DATA` | no | isolated demo environments only |
| `ENABLE_DEV_AUTH`, `ENABLE_E2E_AUTH_BYPASS`, `RATE_LIMIT_DISABLED`, `STRIPE_WEBHOOK_TRUST_EVENT_PAYLOAD` | never in prod | dev/test switches (the last makes subscription webhooks skip re-fetching from Stripe; ignored in production) |

---

## Deployment

One Docker image (`Dockerfile`) serves the SPA and `/api`; on start it runs
`prisma migrate deploy` then the server, and its `HEALTHCHECK` hits
`/api/health/ready`. Two supported paths:

- **Coolify** (planned automatic deploys): Dockerfile build pack, port 3001,
  Postgres resource, env vars per `docs/DEPLOY.md#coolify`. Deploy only
  `main` commits with a green `Build` check.
- **VPS script** (current production), described below.

Production runs in a Docker container on the Ashbi VPS
(187.77.26.99), deployed via `scripts/deploy-production.sh`:

1. **Immutable source archive:** Script requires clean worktree,
   creates `.tar.gz` from git HEAD, uploads to VPS at
   `/opt/bowin-production-releases/{SHA}.tar.gz` with SHA256
   verification.
2. **VPS-side Docker build:** Builds `bowin-release:{SHA}` image
   on VPS from the verified archive. Dockerfile is multi-stage
   (Node 22 + production build + runtime).
3. **Candidate validation:** Starts a private candidate container
   (`taekwondo-tournament-candidate`) with `--network markup-net`
   to reach the existing `markup-postgres` container. Validates
   health check passes before proceeding.
4. **Stopped-write cutover:** Stops live container, renames to
   `taekwondo-tournament-rollback`, takes encrypted DB backup to
   `/var/backups/taekwondo/pre-{timestamp}-{SHA}.dump`, runs
   `prisma migrate deploy`, starts new live container on same port.
5. **Automatic rollback:** If health checks fail, restores DB from
   backup and reverts to previous container. Manual rollback is
   documented in `scripts/deploy-production.sh` comments.
6. **Environment:** Passed via `--env-file` (not inline `-e`) so
   secrets don't appear in shell history. Required env vars:
   `DATABASE_URL`, `JWT_SECRET`, `METRICS_TOKEN`,
   `REGISTRATION_CONSENT_VERSION`, `PRIVACY_NOTICE_URL`,
   `TOURNAMENT_TERMS_URL`, `MAILGUN_*`, `ALLOWED_ORIGINS`,
   `PUBLIC_APP_URL`. Optional: `STRIPE_*` for billing,
   `ENABLE_DEMO_LOGIN`/`DEMO_ISOLATED_DATA` for isolated demo.
7. **Reverse proxy:** Traefik on the VPS terminates TLS and
   reverse-proxies `tkd.ashbi.ca` → `127.0.0.1:{LIVE_PORT}`.
   Traefik config lives in per-app Docker Compose or labels
   (not centralized). Custom domain support (PR #256) requires
   dynamic Traefik configuration for tenant hostnames.

**Migration requirement:** Next production deploy must apply:
- `20260910_add_tournament_templates` (org-level templates, PR #255)
- `20260910_add_custom_domains` (custom domains, PR #256)
- `20260910_add_capacity_waitlist` (capacity + waitlist)
- `20260924_registration_waitlist_fields` (Registration waitlist columns that were in the schema without a migration)
- `20260925_tournament_created_by` (Tournament.createdById, backfilled from `tournament_created` audit entries)
- `20260925_competitor_organization` (Competitor.organizationId, backfilled)
- `20260930_retention_legal_hold` (legal-hold columns on Tournament/Competitor, `RetentionPurgeRun` table)
- `20261001_invitation_delivery_status` (Invitation delivery status + `cancelledAt`)
- `20261001_staff_assignments` (StaffAssignment table, #192)

The deploy script runs `prisma migrate deploy` automatically
during cutover. Do NOT use `npm run db:push` on production —
it bypasses migration history and is only for disposable local dev.

---

## Testing

- `npm test` — vitest (~1,510 tests, ~175 files). Includes full
  bracket playthrough simulations (`bracket-simulation.test.ts`, DE
  and SE for N=1..17 plus larger sizes). DB-backed suites
  (`src/server/contracts/*`, `*.integration.test.ts`) skip unless a
  database is reachable / their opt-in env var is set.
- CI (`.github/workflows/ci.yml`) runs `npm run typecheck` (server
  then client — the client check only runs if the server one
  passes), `npm test`, `npm run lint`. Keep all three green.
- `npm run test:e2e` — Playwright, ~39 spec files in `tests/e2e/`.
  CI runs them on chromium, firefox, webkit and mobile-chrome,
  serially against one database (~35 min).
  Global teardown wipes test records from the live DB.
  `npm run test:e2e:install` once to download the Chromium
  browser.
- `npm run test:coverage` — v8 coverage report. Client is
  excluded.

### E2E auth bypass for `npm run test:e2e`

The e2e suite signs in via the dev-mode magic-link flow, which
needs to return the OTP `code` in the JSON response. In
production that response is sanitized. The bypass is gated by:

- `ENABLE_E2E_AUTH_BYPASS` env var, set to `1` in
  `playwright.config.ts:webServer.env` so it's inherited by the
  dev server.
- The route only honours it inside the dev-mode branch
  (`!isEmailConfigured()`), so it is a no-op in production
  regardless of the env var.

Set the env var to `String(1)` (via `String(parseInt("01", 2))` or
similar) rather than the literal `"1"` to dodge chat-layer
reactions in tooling that strip the `=1` suffix.

### Playwright `webServer.command`

Keep `webServer.command` a plain string (`'npm run dev'`). The array form
triggers a Playwright 1.55–1.62 loader bug (`The "file" argument must be of
type string. Received an instance of Array`) on every Node version.

### What's NOT tested (gaps)

- Most of `src/server/routes/**` has no route-level unit tests; e2e
  covers the main paths.
- `pdf-export.ts` and `email.ts` have no unit tests.
- React pages have little component-level coverage (client tests are
  mostly utilities, hooks and a few components).
- `match-advancement` and `backup-recovery` are covered by
  `*.integration.test.ts` suites that only run with a database.

---

## Branding

The rebrand to **bowin** is complete in the UI, emails
(`EMAIL_FROM_NAME` default, templates), JWT `iss`/`aud` and cookie
names (`bowin_session`, `bowin_csrf`). Leftovers: the repository name
and the `docker-compose.yml` container names
(`martial-arts-tournament`, `taekwondo-db`). `MAILGUN_DOMAIN` still
defaults to `'ashbi.ca'`.

---

## Legacy bracket data (root-level directories)

`BB Females Patterns/`, `BB Females Sparring/`, etc. contain
PDFs and image files from Newton's Championship 2025 — static
reference data, not loaded by the app. Naming convention:
`[Age Range] [Belt Level]-[Belt Rank] [Gender] [Event Type]
[Weight Class].pdf` (e.g. `10-11 CB-All Blue Belts Males Sparring
Heavy.pdf`). The app uses the `Tournament ScheduleNewSparring.pdf`
and `2025 NEWTONS CHAMPIONSHIP LIST.xlsm` only as reference.

---

## Conventions

- **Server routes** use `async/await`. Errors throw — the
  global error handler at the end of `src/server/index.ts` converts
  them to JSON. Use `AppError` from `src/server/utils/errors.ts` for
  typed errors with HTTP status codes.
- **Validation** is via Zod schemas in `src/server/middleware/
  validate.ts`. Every POST/PUT body should be validated.
- **Client mutations** always spread `getAuthHeaders()` (it carries
  the CSRF token; without it cookie-authenticated writes get 403).
- **Database changes**: use `npm run db:push` only for disposable local work.
  Release changes require a checked-in migration validated with
  `prisma migrate deploy` on a production-compatible database.
- **Git workflow**: see [CONTRIBUTING.md](./CONTRIBUTING.md). Branch per
  change, draft PR, squash-merge to `main` once the `Build` check is
  green. Production deployment remains a separately approved,
  rollback-guarded operation (`scripts/deploy-production.sh`).
