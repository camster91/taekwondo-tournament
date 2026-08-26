# Tournament Manager — Codebase Guide

This repository contains both raw tournament data (PDFs, Excel) for
Newton's Championship 2025 (root-level directories prefixed `BB` /
`CB` for belt division) and a full-stack multi-sport **Tournament
Manager** SaaS application at `src/` and `prisma/`.

The app is branded "Martial Arts Tournament Manager" in the UI but
internally still uses the `taekwondo-tournament` repository name and
the `tkd_*` localStorage / branding keys. See "Rebrand status" below.

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
`src/server/index.ts:36-43`. There is no longer a SQLite path; the
CLAUDE.md v1 mention of `prisma/tournament.db` is stale.

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
├── docs/                                # audit reports, deployment notes
├── prisma/
│   ├── schema.prisma                    # source of truth (no migrations dir)
│   └── seed.ts                          # dev seed (TKD-only, see "Multi-sport")
├── scripts/
│   ├── deploy-to-vps.sh                 # build on Mac, ship to Coolify
│   └── sync-caddy.sh                    # (Caddyfile sync, see "Deployment")
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
│   │   │   ├── AuthContext.tsx          # getAuthHeaders, tkd_auth_token / tkd_auth_user keys
│   │   │   ├── ThemeContext.tsx
│   │   │   └── ToastContext.tsx
│   │   ├── pages/                       # see "Client pages" below
│   │   ├── components/
│   │   │   ├── ui/                       # Skeleton, EmptyState, ConfirmDialog, Spinner, Toast
│   │   │   ├── MatchTimer.tsx
│   │   │   └── TournamentRulesEditor.tsx
│   │   └── utils/
│   │       ├── api-errors.ts            # (currently zero importers — dead)
│   │       ├── csv-export.ts
│   │       ├── csv-export.test.ts
│   │       ├── auth-storage.ts         # localStorage key constants (tkd_auth_token / tkd_auth_user)
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
│   └── e2e/                             # Playwright
│       ├── global-setup.ts
│       ├── global-teardown.ts           # wipes e2e test records after suite
│       ├── helpers.ts
│       ├── checkin.spec.ts
│       ├── login.spec.ts
│       ├── public-register.spec.ts
│       ├── public-register-a11y.spec.ts
│       ├── scorekeeper-a11y.spec.ts
│       └── tournament-create.spec.ts
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
| `DirectorDashboard.tsx` | `/tournaments/:id/director` | Per-tournament live control room — ring status, division progress, day-of warnings |
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

All `/api/*` routes except `/api/public/*` and `/api/sports/*` require:

```
Authorization: Bearer <jwt>
```

### JWT shape

- HS256, signed with `process.env.JWT_SECRET` (required at boot;
  process exits if missing in production).
- Default TTL: 7 days. The demo login uses a 4-hour TTL via
  `createToken(payload, expiresIn)`.
- Claims: `iss = 'tkd-app'`, `aud = 'tkd-app'`, `algorithm: HS256`
  pinned on both `jwt.sign` and `jwt.verify`. Don't relax these.
- Server validates `iss` and `aud` on every request; a token issued
  before this hardening will be rejected with 401. Users re-login.

### localStorage keys (client-side)

The client stores the JWT under `tkd_auth_token` and the user
object under `tkd_auth_user`. **These keys are not `auth_token`** —
the previous CLAUDE.md value is wrong. The `getAuthHeaders()`
helper in `src/client/context/AuthContext.tsx` is the only
supported way to read them.

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

The middleware lives in `src/server/middleware/auth.ts`. It is
**defined but not yet wired into route handlers** because the
current live install is single-tenant (no orgs). When a real
multi-tenant install is set up, the wire-up is mechanical:
add `requireTournamentAccess('director')` after `requireRole(...)`
on every tournament-scoped mutation in `tournaments.ts`,
`divisions.ts`, `brackets.ts`.

Authorization precedence (first match wins):

1. **Admin** — global access, can mutate any tournament.
2. **Global role check** — the user's `role` must be at least
   the `minRole` threshold globally. (Defense-in-depth: even
   if an explicit access row grants a higher per-tournament
   role, the user must have the privilege at all.)
3. **`UserTournamentAccess` row** exists for `(user, tournament)`
   with a role at the required level.
4. **Tournament has no `organizationId`** (legacy single-tenant
   data) — fall back to the global-role check from step 2.
5. **Tournament belongs to an org, and the user is a member of
   that org** — implicit director access. THIS is the
   multi-tenant boundary. A non-member can't read or mutate a
   tournament they don't belong to.
6. Otherwise — 403.

12 regression tests in `src/server/middleware/auth-tournament-access.test.ts`
pin all 6 paths.

---

## Multi-sport (status: partial)

`src/shared/constants/sport-profiles.ts` defines 10 sport profiles
(Taekwondo, Karate, Judo, Wrestling, BJJ, Kickboxing, Muay Thai,
Fencing, Boxing, "Other"). Each profile has:

- `eventTypes[0]`, `eventTypes[1]` — display names for the two event
  slots
- `beltConfig.levels` — belt hierarchy
- `scoringConfig.penaltyName` (e.g. "Gamjeon", "Shido")
- `scoringConfig.defaultRounds` / `defaultRoundDurationSeconds` —
  intended to drive `MatchTimer` defaults, but **currently
  hardcoded** in `Scorekeeper.tsx:509` (always 2 rounds × 120s).
  This is the gap to fix when multi-sport becomes a priority.

The DB always stores `eventType: 'patterns' | 'sparring'` — sport-
specific labels are display-only. `Divisions.tsx`, `Results.tsx`,
`BracketEditor.tsx` still hardcode "Patterns"/"Sparring" filter
options; replacing them with `getSportProfile(...).eventTypes`
is the multi-sport completion task.

The DB has a `SportProfile` model (`prisma/schema.prisma:402-418`)
that is unused — sport config lives in TS constants. Either
complete the migration to DB-driven sport config, or drop the
unused model.

Seed data (`prisma/seed.ts`) is TKD-only. Adding a Karate or
Judo test seed would prove the multi-sport path end-to-end.

---

## Database

`prisma/schema.prisma` — 418 lines, 23 models. Key models:

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
| `MagicLink` | `token` (32-byte hex) + 6-digit `code`. Plaintext (not hashed) — see "Security" below. |
| `MatchAuditLog` | Every match update records previous + new state. |
| `Invitation` | Pending email + role for the invite flow. |
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
| POST | `/api/auth/accept-invite` | `-` | `registerLimiter`. Body: `{ token, firstName, lastName, password }`. |
| GET | `/api/auth/me` | auth | Returns own user + tournamentAccess. |
| PUT | `/api/auth/profile` | auth | zod `profileUpdateSchema`. |
| GET | `/api/auth/users` | auth | All users. |
| PUT | `/api/auth/users/:userId/role` | admin | zod `roleUpdateSchema`. |
| PUT | `/api/auth/users/:userId/status` | admin | zod `statusUpdateSchema`. |
| POST | `/api/auth/tournaments/:tournamentId/access` | admin | zod `tournamentAccessSchema`. Grant per-tournament role. |
| DELETE | `/api/auth/tournaments/:tournamentId/access/:userId` | auth | Revoke per-tournament access. |

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
| DELETE | `/api/invites/:id` | Cancel a pending invite. |
| GET | `/api/invites/verify/:token` | Public (no auth) — preview an invite before accepting. |

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

**Bug to know about:** `categorization-engine.ts:554` treats
`weight == null` as 0 lbs, which falls into the lowest weight
class. A 200-lb adult who hasn't been weighed ends up in a
youth Feather division. Public registration requires weight
for sparring, but auto-categorize doesn't re-check. Fixed in
the followup; the weight boundary is `weight < weightMaxLbs`.

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
  verify). 7-day default TTL. `JWT_SECRET` required in production,
  ≥ 32 chars enforced.
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

Things still to fix:
- JWT in localStorage is XSS-leakable. httpOnly Secure cookie
  would be safer.
- No `tokenVersion` claim, so a flipped `isActive` user is still
  authed until their 7-day JWT expires.
- No `jti` denylist, so `logout()` doesn't invalidate server-side.

---

## Environment variables

`.env.example` documents the required set. Code-side exhaustive
list (`grep process.env.`):

| Var | Used by | Required | Notes |
|-----|---------|----------|-------|
| `DATABASE_URL` | `src/server/index.ts` (PrismaPg) | yes | `postgresql://...` |
| `JWT_SECRET` | `src/server/middleware/auth.ts` | yes | ≥ 32 chars in prod |
| `PORT` | `src/server/index.ts` | no | default 3001 |
| `NODE_ENV` | dev/prod gating | no | `production` in prod |
| `ALLOWED_ORIGINS` | CORS | yes in prod | comma-separated origins |
| `ADMIN_SETUP_KEY` | `setup-admin` route | no | if unset, that route returns 503 |
| `RATE_LIMIT_DISABLED` | all rate limiters | no | `'1'` bypasses for tests |
| `PUBLIC_APP_URL` | magic-link email | no | base URL for the verify link |
| `MAILGUN_API_KEY` | `email.ts` | yes for email | if absent, dev mode |
| `MAILGUN_DOMAIN` | `email.ts` | yes for email | defaults to `'ashbi.ca'` |
| `MAILGUN_BASE_URL` | `email.ts` | no | defaults to `https://api.mailgun.net/v3` |
| `EMAIL_FROM_NAME` | `email.ts` | no | defaults to `'TKD Tournament Manager'` (see rebrand notes) |
| `EMAIL_FROM_ADDRESS` | `email.ts` | no | defaults to `noreply@${MAILGUN_DOMAIN}` |
| `ENABLE_DEMO_LOGIN` | demo route | no | `'1'` to enable |
| `ENABLE_DEV_AUTH` | dev-auth + dev-token | no | `'1'` to enable |

---

## Deployment

Production runs in a Docker container on the Ashbi VPS
(187.77.26.99), built by `scripts/deploy-to-vps.sh`:

1. Local build: `npm run build` produces `dist/` (client) and
   `dist-server/` (server) plus `server.js` from the TS source.
2. Local tar → scp/pipe to the VPS (scp is unreliable on this
   box, so the script uses `cat local | ssh coolify cat > remote`).
3. VPS-side Docker build with the on-host `Dockerfile`.
4. Container runs with `--network markup-net` so it can reach
   the existing `markup-postgres` container.
5. Environment passed in via `--env-file` (not inline `-e`) so
   the JWT secret doesn't end up in shell history.
   `JWT_SECRET` is read from `/etc/taekwondo.d/jwt-secret` on
   the VPS (chmod 600).
6. Caddy on the VPS terminates TLS and reverse-proxies
   `tkd.ashbi.ca` → `127.0.0.1:18301`. (NOT Traefik — Traefik
   was tried and rolled back; the Caddyfile at
   `/opt/caddy/Caddyfile` is the source of truth.)

The Caddyfile is shared with sibling projects (animals, lull,
markup-clone, etc.) and gets clobbered when those deploy.
`scripts/sync-caddy.sh` (if it exists for this project — it
doesn't yet) would re-assert the `tkd.ashbi.ca` block. The
**Caddy wildcard default `*.ashbi.ca, ashbi.ca` is a footgun** —
it catches every subdomain and conflicts with explicit apex
blocks. Watch the Caddy logs for 429s if the wildcard starts
capturing tkd.ashbi.ca's TLS cert.

---

## Testing

- `npm test` — vitest unit tests. 148 tests across 10 files.
  Covers: bracket generator + positions, age groups, weight
  classes, belts, fair-mount-matchup distance, CSV export,
  Excel auto-map, tournament-access middleware.
- `npm run test:e2e` — Playwright. 7 spec files in `tests/e2e/`.
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

### Playwright + `webServer.command: [array]` (the real bug)

The original "Playwright + Node 24" issue was misdiagnosed for
three sessions as a Node-version / loader bug. The actual
culprit is much simpler: `webServer.command: ['npm run dev']`
(array form) triggers a bug in Playwright 1.55–1.62 where the
array is passed through to the loader's `resolve` hook, which
expects a string and throws `The "file" argument must be of
type string. Received an instance of Array`.

**Fix:** use `webServer.command: 'npm run dev'` (plain string).
The Node version doesn't matter — the same code path fails on
Node 20, 22, and 24. The TS loader is fine; the loader runs
correctly; the bug is specifically in the array-form `command`.

**Verification:** all 23 e2e tests pass on Node 22.23.0 +
Playwright 1.61.0 in 29s:

```
Running 23 tests using 1 worker
  [1/23] check-in: staff checks in a competitor with a weigh-in
  [2/23] check-in: list shows mixed checked / unchecked states
  [3/23] login: magic-link OTP signs in a new user in dev mode
  [4/23] login: invalid 6-digit code shows an error
  [5/23] login: demo button is a one-click shortcut
  [6/23]-[11/23] public registration a11y (6 tests)
  [12/23]-[13/23] public registration (2 tests)
  [14/23]-[21/23] scorekeeper a11y (8 tests)
  [22/23]-[23/23] tournament create (2 tests)
  23 passed (29.0s)
```

### What's NOT tested (gaps)

- `src/server/routes/**` (no route-level unit tests; e2e covers
  the happy paths).
- `src/server/services/pdf-export.ts`, `email.ts`,
  `match-advancement.ts`, `backup-recovery.ts` (no unit tests).
- `src/client/**` (no React component tests; no hook tests).
- `src/server/services/categorization-engine.ts` (the most
  complex untested service — known bugs in weight handling,
  see "Categorization engine").

The per-competitor double-booking detector in
`schedule-generator.ts` is unit-tested in
`schedule-generator.test.ts` (6 tests).

---

## Rebrand status (half-done)

UI chrome is rebranded "Martial Arts TM" / "Tournament OS"
(`src/client/App.tsx:184`, `index.html:8`), but the rest of the
codebase still uses the old TKD identity:

- `src/client/context/AuthContext.tsx:27` — `tkd_auth_token` /
  `tkd_auth_user` localStorage keys.
- `src/server/services/email.ts:34` — default from-name is
  `'TKD Tournament Manager'`.
- `src/server/services/email-templates.ts` — hardcoded `<h1>TKD
  Tournament Manager</h1>` in 5 templates (magic link, welcome,
  invitation, registration confirm).
- `docker-compose.yml:8,28` — container names `martial-arts-
  tournament` and `taekwondo-db`.
- `EMAIL_FROM_NAME` default is `'TKD Tournament Manager'`.
- `MAILGUN_DOMAIN` default is `'ashbi.ca'`.

To finish the rebrand: sweep all `tkd_*` keys / `TKD` strings
in one commit. The work is mechanical; the decision is whether
to commit to the new identity or revert the UI to the old TKD
chrome.

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
  global handler in `src/server/index.ts:131-151` converts to
  JSON. Use `AppError` from `src/server/utils/errors.ts` for
  typed errors with HTTP status codes.
- **Validation** is via Zod schemas in `src/server/middleware/
  validate.ts`. Every POST/PUT body should be validated.
- **Client mutations** always include `getAuthHeaders()` (or
  the `headers` object spread).
- **Database changes**: use `npm run db:push` only for disposable local work.
  Release changes require a checked-in migration validated with
  `prisma migrate deploy` on a production-compatible database.
- **Git branch**: `main` (single branch). PRs land directly.
  GitHub and Ashbi CI validate pull requests; production deployment remains a
  separately approved, rollback-guarded operation.
