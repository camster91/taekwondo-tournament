# Bowin Tournament OS — Backend Code Review (Track 2)

- **Reviewer:** backend-dev
- **Date:** 2026-09-10
- **Scope:** `src/server/**`, `prisma/schema.prisma`, `prisma/migrations/**`, `prisma/seed*.ts`
- **Mode:** READ-ONLY static analysis
- **Stack observed:** Express 4 + `express-async-errors` + Zod + helmet + cookie-parser + JWT (jsonwebtoken) + Sentry; Prisma 7 (PrismaPg adapter) over PostgreSQL 16; `ws` for live updates; `express-rate-limit` (in-memory); Stripe SDK 22.
- **Build script:** `prisma generate && vite build && tsc -p tsconfig.server.json && tsc -p tsconfig.demo.json` — i.e. schema is the source of truth, not migrations.

---

## 1. Executive Summary

The backend is well-organised at the route/middleware layer (helmet → request-id → JSON → cookie-parser → compression → custom-domain → routers; Zod everywhere; structured error handler; graceful SIGTERM). A lot of prior-audit findings have been fixed (the `console.log` of the magic-link code is now gated by `NODE_ENV !== 'production'`; analytics is now tenant-scoped via `buildTournamentAccessFilter`; `trust proxy` is on in prod; fail-fast startup validation exists).

There are, however, **two structural concerns that need a decision before merge**:

1. **The migration history does not match `schema.prisma`**, but the application code is written against the **migration** field names (`scheduledTime`, `ringNumber`, `notes`, `score1`, `score2`). With the build running `prisma generate && tsc -p tsconfig.server.json` the code should fail to compile if the schema were the source of truth — so either the dev DB is the actual source of truth (and the schema has been edited to drift) or the build is broken. Either way it is unsafe to deploy from this branch.
2. **The public registration path is not transactional** and has a TOCTOU window on `Competitor` (no uniqueness on `(tournamentId, firstName, lastName, dateOfBirth)`), and the Stripe-step failure leaves the registration stuck with `paymentStatus: 'pending'` and no payment URL returned to the user. Two callers — `public.ts` and `public-portal.ts` — both have the same bug.

On top of that, the **analytics dashboard loads every Competitor row into the Node process** to compute age buckets; the WebSocket layer has no per-division authorization and won't fan out across multiple app instances; and several write-heavy routes (`/api/brackets`, `/api/competitors`, `/api/divisions`, `/api/tournaments`, `/api/analytics`, `/api/organizations`, `/api/billing`) have **no rate limit at all** despite a healthy limiter being available in `middleware/rate-limit.ts`.

Verdict: **NEEDS_FIXES_BEFORE_SHIP** — the schema/migration drift and the registration path are blockers; the rest are HIGH/MEDIUM hardening.

---

## 2. Findings table

| # | Severity | Title | Location |
|---|----------|-------|----------|
| 1 | CRITICAL | Schema ↔ migration drift on `Match` (and others) | `prisma/schema.prisma:245-273` vs `prisma/migrations/20260710_init/migration.sql:128-150` |
| 2 | CRITICAL | Public registration: TOCTOU + non-atomic, Stripe-failure leaves user stranded | `src/server/routes/public.ts:320-585`, `src/server/routes/public-portal.ts:441-600` |
| 3 | CRITICAL | WebSocket broadcast state is in-memory; no cross-instance fan-out | `src/server/services/websocket.ts:21-35, 117-128` |
| 4 | HIGH | Analytics dashboard does an unbounded `findMany` over Competitor to compute age buckets | `src/server/routes/analytics.ts:83-100` |
| 5 | HIGH | Bracket / score write path has no rate limit | `src/server/routes/brackets.ts` (entire file) |
| 6 | HIGH | WebSocket `subscribe` does not check tournament/division authorization | `src/server/services/websocket.ts:55-93` |
| 7 | HIGH | Service code references schema-removed fields (`notes`, `score1`, `score2`, `ringNumber`, `scheduledTime`, `format` on Bracket) | `src/server/services/bracket-correction.ts:23-60, 247, 337`; `services/match-advancement.ts:247`; `routes/public.ts:1227-1411` |
| 8 | MEDIUM | Retention purge runs 4 sequential `deleteMany` outside a transaction | `src/server/services/retention-policy.ts:30-60, 88-95` |
| 9 | MEDIUM | `express-rate-limit` uses in-memory store — multi-replica deploy multiplies the effective limit | `src/server/middleware/rate-limit.ts:58-66` |
| 10 | MEDIUM | `customDomain` lookup is per-request without caching | `src/server/middleware/*` (resolveCustomDomainHost) and `src/server/index.ts:220` |
| 11 | MEDIUM | `competitors`, `divisions`, `tournaments`, `organizations`, `analytics`, `billing` write paths have no rate limit | route files (no `rateLimit` import in `competitors.ts`, `divisions.ts`, `tournaments.ts`, `organizations.ts`, `analytics.ts`, `billing.ts`) |
| 12 | MEDIUM | `Match` query hot-path missing composite indexes (`status, scheduledAt` / `bracketId, roundName, matchNumber`) | `prisma/schema.prisma:269-272` |
| 13 | MEDIUM | `$queryRawUnsafe` used for advisory lock — safe but should be `$queryRaw` template | `src/server/services/recommendation-contract.ts:58`; `services/bracket-correction.ts`; `services/schedule-correction.ts` |
| 14 | MEDIUM | WebSocket `subs.forEach(broadcast)` does not isolate per-socket send failures | `src/server/services/websocket.ts:121-128` |
| 15 | LOW | `console.log` (raw) in management-token audit-log path in production | `src/server/routes/public.ts:786` |
| 16 | LOW | Helmet CSP uses `'unsafe-inline'` for styles to accommodate Vite dev — acceptable but worth a follow-up nonce/hash | `src/server/index.ts:147-161` |
| 17 | LOW | `grace-period-job` exists but is not wired into `index.ts`; grace period downgrades will never run in prod | `src/server/services/grace-period-job.ts`; absent in `src/server/index.ts` |
| 18 | LOW | `competitor-deduplication` service is referenced in tests but the `Competitor` model has no uniqueness invariant for the dedup key | `src/server/services/competitor-deduplication.ts`; `prisma/schema.prisma` |

---

## 3. Numbered findings

### [CRITICAL] 1. Schema ↔ migration drift on `Match` (and others)

**Location:** `prisma/schema.prisma:245-273` (Match model) vs `prisma/migrations/20260710_init/migration.sql:128-150` (Match CREATE TABLE).

**Trigger:** A code change that does a `prisma generate` (run on `postinstall` and on every `build`) and then a `tsc -p tsconfig.server.json` (the build command in `package.json:10`). The dev workflow also runs `prisma db push` rather than `prisma migrate deploy` (`package.json:19, 31`). The migration history is decorative; the schema is the source of truth used by the running Prisma client.

**Impact:** Massive drift between schema and the only init migration:

```sql
-- migration.sql:128-146  (what is actually in the DB if migrate was run)
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "bracketId" TEXT NOT NULL,
    ...
    "score1" TEXT,            --  <-- migration
    "score2" TEXT,            --  <-- migration
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scheduledTime" TIMESTAMP(3),   --  <-- migration
    "ringNumber" INTEGER,           --  <-- migration
    "notes" TEXT,                   --  <-- migration
    ...
);
```

```prisma
// schema.prisma:245-273  (what prisma generate uses for the client)
model Match {
  ...
  scores      String? // JSON     // <-- different name + different type
  ring        String? // Ring A, B, C...
  scheduledAt DateTime?           // <-- different name
  // no score1, no score2, no notes, no ringNumber
  ...
}
```

But the **application code is written against the migration names**:

```ts
// src/server/services/bracket-correction.ts:23-27  (the type contract)
score1?: string | null;
score2?: string | null;
...
notes?: string | null;
scheduledTime?: string | null;
ringNumber?: number | null;
```

```ts
// src/server/services/match-advancement.ts:247
notes: 'BYE',                                // <-- not in schema
```

```ts
// src/server/routes/brackets.ts:53-59  (the Zod schema)
score1: z.string().regex(/^\d{1,3}$/, 'Score must be 0-999').optional(),
score2: z.string().regex(/^\d{1,3}$/, 'Score must be 0-999').optional(),
notes: z.string().max(500, 'Notes must be 500 characters or fewer').optional(),
```

```ts
// src/server/routes/public.ts:1227-1307  (the SELECT and DTO)
ringNumber: true,
scheduledTime: true,
...
ringNumber: match.ringNumber,
scheduledTime: match.scheduledTime,
```

So either (a) `prisma generate` is broken / has been run against a different schema and the build is non-deterministic, (b) the dev DB has been mutated directly and the schema is what the app actually talks to (in which case the migration history is lying and a `prisma migrate deploy` on a fresh env would be a no-op plus reset), or (c) the build is currently broken and no one is running it on this branch.

**Remediation:** Pick one source of truth and reconcile. If the schema wins, generate a real migration that renames `scheduledTime → scheduledAt`, `ringNumber → ring` (TEXT), drops `score1/score2/notes`, and adds `scores JSONB`. If the migration wins, revert the schema to the migration column set. Either way, regenerate migrations from the current schema (`prisma migrate diff`) and stop the `prisma db push` shortcut for prod.

**Evidence:**
```ts
// prisma/schema.prisma:245-273
model Match {
  id           String    @id @default(uuid())
  ...
  status       String    @default("pending")
  scores       String? // JSON
  ring         String? // Ring assignment (A, B, C, etc.)
  scheduledAt  DateTime?
  startedAt    DateTime?
  completedAt  DateTime?
  ...
  @@index([bracketId])
  @@index([status])
  @@index([competitor1Id])
  @@index([competitor2Id])
}
```

```ts
// prisma/migrations/20260710_init/migration.sql:128-150
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    ...
    "score1" TEXT,
    "score2" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scheduledTime" TIMESTAMP(3),
    "ringNumber" INTEGER,
    "notes" TEXT,
    ...
);
```

---

### [CRITICAL] 2. Public registration: TOCTOU race + Stripe-failure stranded state

**Location:** `src/server/routes/public.ts:320-585` and `src/server/routes/public-portal.ts:441-600` (the two `/register` entry points).

**Trigger:** Two near-simultaneous POSTs from the same user (e.g. double-click, or the same person filling in the form on two devices), or any `Stripe.checkout.sessions.create` failure.

**Impact:**

- **Duplicate Competitor rows.** The handler does `findFirst(where firstName+lastName+dateOfBirth+tournamentId)` then `competitor.create` if missing. There is no DB-level uniqueness on `Competitor` (the schema only has `@@index([tournamentId, lastName, firstName])`). Two concurrent requests can both see `null` and both `create`, producing two competitor rows for the same person. The `Registration` table has the `@@unique([tournamentId, competitorId])` constraint, so one of the two registrations will fail with 500, but the duplicate Competitor persists.
- **Stranded registration on Stripe failure.** The flow is: (1) findFirst competitor, (2) create competitor, (3) findUnique existing registration, (4) create registration (with `paymentStatus: 'pending'` if a fee is required), (5) call `stripe.checkout.sessions.create` for the URL, (6) update registration with `paymentIntentId`. If step 5 throws, the registration already exists in `pending` state with no `paymentIntentId`, and the user gets a 500. The user is told to "complete payment later" but no checkout URL is ever stored. There is no compensating action, no retry, and the public-facing message is generic. The user has no path forward.
- **No transaction.** All four writes (competitor.create / registration.create / session.create / registration.update) are outside any `$transaction`. The Stripe call is also external, so a real wrap is impossible — but the *DB* side should be one transaction with the Stripe call sequenced after, and a compensating delete on Stripe failure.

**Remediation:** Wrap the DB portion in `prisma.$transaction`. Compute the Stripe session **before** writing the registration, or — better — split into two endpoints (`POST /register/init` → reservation, `POST /register/:id/pay` → Stripe URL) so the user gets a deterministic next step on every code path. Add a unique constraint on `Competitor(tournamentId, firstName, lastName, dateOfBirth)` (or hash) to defeat the race. Add a recovery job (or `idempotency-key`-based retry) for `pending` registrations older than N minutes.

**Evidence:**
```ts
// src/server/routes/public.ts:339-388  (simplified)
const existingCompetitor = await prisma.competitor.findFirst({ where: { ... } });
let competitor = existingCompetitor;
if (!competitor) {
  competitor = await prisma.competitor.create({ data: { ... } });
}
const existingRegistration = await prisma.registration.findUnique({ where: { ... } });
if (existingRegistration) return res.status(409).json({ ... });
const registration = await prisma.registration.create({ data: { ... } });   // no $transaction
if (fee.required) {
  const session = await stripe.checkout.sessions.create({ ... });           // can throw
  await prisma.registration.update({                                         // never reached on throw
    where: { id: registration.id },
    data: { paymentIntentId: session.payment_intent as string, paymentStatus: 'pending' },
  });
}
```

---

### [CRITICAL] 3. WebSocket subscription map is per-process; no cross-instance fan-out

**Location:** `src/server/services/websocket.ts:21-35, 117-128, 137-156`.

**Trigger:** A `prisma.match.update` (or any other broadcaster) runs on instance A. A client is connected to instance B (e.g. behind a load balancer, or two Coolify replicas, or the `mtls` Cloudflare Tunnel balancing to multiple `tsx` workers). The client never sees the update until it polls.

**Impact:** "Live scoreboard" / "public display" silently degrades to "refresh every N seconds" the moment the deployment has more than one node. Public displays configured to use the WebSocket (`prisma.recordPublicDisplayHeartbeat` upserts on every page load) will keep heartbeating but never display updates.

**Remediation:** Add a Redis pub/sub (or Postgres `LISTEN`/`NOTIFY`, or a webhook between instances) so any `broadcast*` helper publishes to a channel and every instance forwards to its connected sockets. Or run a single Socket.IO/Redis adapter. Alternatively, drive the public display off an HTTP poll (the `publicScoreboardRefreshMs` field already exists, default 10s) and stop using the WebSocket for the public-display use case.

**Evidence:**
```ts
// src/server/services/websocket.ts:21-35
const divisionSubscriptions = new Map<string, Set<ClientState>>();
const tournamentSubscriptions = new Map<string, Set<ClientState>>();
const matchSubscriptions = new Map<string, Set<ClientState>>();

export function broadcastMatchUpdate(matchId: string, divisionId: string, tournamentId: string, payload: unknown) {
  const dispatch = (subs: Set<ClientState> | undefined) => { ... };
  dispatch(matchSubscriptions.get(matchId));
  dispatch(divisionSubscriptions.get(divisionId));
  dispatch(tournamentSubscriptions.get(tournamentId));
}
```

---

### [HIGH] 4. Analytics dashboard: unbounded `findMany` on `Competitor`

**Location:** `src/server/routes/analytics.ts:83-100`.

**Trigger:** Any user with `dashboard` access hits the endpoint on a tenant with > 10k competitors. The handler loads **every** `Competitor` row's `dateOfBirth` into the Node process to compute age buckets in JavaScript.

**Impact:** OOM at scale. With 100k competitors, each `dateOfBirth` is a `Date` (24 bytes header + 8 bytes payload ≈ ~100 bytes JS-side), so this is ~10 MB of JS object per request — multiplied by the per-request overhead, and the response can be 5–10× bigger. Multiple concurrent dashboard tabs will exhaust the heap. The query is also uncached and runs against the live DB on every poll.

**Remediation:** Compute the age groups in SQL using `date_part('year', age(now(), "dateOfBirth"))` and a `CASE` expression inside a `groupBy`, or precompute a `birthYear` column on the Competitor. The current shape is also vulnerable to `toJSON()` accidentally serialising the full competitor record — `select: { dateOfBirth: true }` does limit that, but the whole pattern is wrong.

**Evidence:**
```ts
// src/server/routes/analytics.ts:83-100
const competitors = await prisma.competitor.findMany({
  where: where.competitor,
  select: { dateOfBirth: true },
});
const ageGroups: Record<string, number> = { '4-7': 0, '8-11': 0, ... };
const now = new Date();
competitors.forEach((c) => {
  const age = Math.floor((now.getTime() - new Date(c.dateOfBirth).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  if (age >= 4 && age <= 7) ageGroups['4-7']++;
  ...
});
```

---

### [HIGH] 5. Bracket write path has no rate limit

**Location:** `src/server/routes/brackets.ts` (entire file). No `rateLimit` import in the file (verified by grep across `src/server`).

**Trigger:** A logged-in scorekeeper (or an attacker who has obtained a director's JWT) hits `POST /api/brackets/division/:divisionId/match/:matchId` (or any of the other `updateMatchResult` variants) in a tight loop. There is no `express-rate-limit` middleware on any bracket route — the only rate limits in the project are on `/api/auth/*`, `/api/incidents/*`, `/api/invites/*`, `/api/support/*`, `/api/public/*`, and the Stripe webhook (no, webhook has none either, but Stripe signs its body).

**Impact:** Bracket state changes are non-idempotent (winnerId flips a match and writes to the `MatchAuditLog`). A flood of PATCHes will (a) spam the audit log, (b) increase contention on the same match row (each update takes a row lock), and (c) potentially corrupt downstream placements (the advancement service in `match-advancement.ts` reads match state, so a half-updated row can produce a weird bracket). The same applies to `POST /api/brackets/division/:divisionId/correction/apply`, which is a heavy write.

**Remediation:** Mount `createRateLimiter({ windowMs: 60_000, max: 120, keyGenerator: (req) => req.user!.id })` on the router and a tighter one (`max: 30`) on `correction/apply`. Match updates should also use the versioned `where: { id, updatedAt }` optimistic-lock pattern that already exists (line 634 area) so a stale PATCH 409s instead of silently overwriting.

**Evidence:**
```ts
// src/server/routes/brackets.ts:38-46  (no rate-limit import)
import { Router } from 'express';
import { ... } from '../services/bracket-generator.js';
import { ... } from '../services/match-advancement.js';
...
import { broadcastMatchUpdate, broadcastBracketRegenerated } from '../services/websocket.js';
const router = Router();
```

---

### [HIGH] 6. WebSocket `subscribe` message has no per-resource authorization

**Location:** `src/server/services/websocket.ts:55-93`.

**Trigger:** User A authenticates at WebSocket connect with a valid JWT for Org X. They send `{type:'subscribe', tournamentId:'T-yyy', divisionId:'D-zzz'}`. The server adds them to the subscription sets for `T-yyy` / `D-zzz` and starts pushing every match update for that tournament/division — even if A has no `UserTournamentAccess` row for `T-yyy`.

**Impact:** Information disclosure across tenants. A viewer in one org can subscribe to any other org's tournament/division and receive `match-update` and `bracket-regenerated` events. The same is true for the public display endpoint, but at least that one is documented as public.

**Remediation:** Look up the user's `UserTournamentAccess` for the requested `tournamentId` and reject the `subscribe` (close the socket with a 4xxx code) if they are not a `director`/`scorekeeper`. For the public display use case, route that traffic to a separate `wss://display.…` endpoint that does not require auth but only joins the public channel.

**Evidence:**
```ts
// src/server/services/websocket.ts:55-93
if (parsed.type === 'subscribe' && typeof parsed.tournamentId === 'string' && typeof parsed.divisionId === 'string') {
  const t = parsed.tournamentId;
  const d = parsed.divisionId;
  ensureSet(tournamentSubscriptions, t).add(client);
  ensureSet(divisionSubscriptions, d).add(client);
  // no prisma.userTournamentAccess.findUnique here
  ...
}
```

---

### [HIGH] 7. Service code references schema-removed fields

**Location:**
- `src/server/services/bracket-correction.ts:23-60, 247, 337`
- `src/server/services/match-advancement.ts:247`
- `src/server/routes/public.ts:1227-1411`
- `src/server/routes/brackets.ts:53-59` (Zod schema validates `score1`, `score2`, `notes`)
- `src/server/services/schedule-correction.ts` (uses `format`/migration field names on Bracket)

**Trigger:** Compilation. The fields are present in the migration, absent in the schema. `prisma generate` (run on `postinstall` and at build start) will emit a client without these fields. The TS compiler then rejects `prisma.match.update({ data: { score1, score2, notes } })` because those keys don't exist on `Prisma.MatchUpdateInput`.

**Impact:** This is a sibling to Finding #1 — it confirms the drift is real and the only way the current branch builds is if either (a) the schema used to generate the client is *not* the schema in the repo, or (b) the build is broken. Either way, this branch is not safe to ship.

**Remediation:** Reconcile schema vs migration (Finding #1). After reconciliation, all of these references resolve correctly because they line up with the migration.

**Evidence:**
```ts
// src/server/services/bracket-correction.ts:23-28
score1?: string | null;
score2?: string | null;
...
notes?: string | null;
scheduledTime?: string | null;
ringNumber?: number | null;

// src/server/services/match-advancement.ts:247
notes: 'BYE',
```

```ts
// src/server/routes/brackets.ts:53-59  (Zod, in the *route* layer — the field names in the body)
score1: z.string().regex(/^\d{1,3}$/, 'Score must be 0-999').optional(),
score2: z.string().regex(/^\d{1,3}$/, 'Score must be 0-999').optional(),
notes: z.string().max(500, 'Notes must be 500 characters or fewer').optional(),
```

```ts
// src/server/routes/public.ts:1227-1307
ringNumber: true,
scheduledTime: true,
...
ringNumber: match.ringNumber,
scheduledTime: match.scheduledTime,
```

---

### [MEDIUM] 8. Retention purge runs 4 sequential `deleteMany` outside a transaction

**Location:** `src/server/services/retention-policy.ts:30-60` and the `run()` at line 88-95.

**Trigger:** A 24-hour scheduled `setInterval` (line 99) calls `purgeExpiredSoftDeletes`, which performs 4 sequential `deleteMany` calls on `Incident`, `Division`, `Tournament`, `Competitor`. None of them are wrapped in `prisma.$transaction`. If the third `deleteMany` fails, the first two are committed and the third+fourth never run.

**Impact:** Partial state: incidents and divisions have been hard-deleted, but their parent tournaments and the competitors that referenced them have not. The next purge run (24h later) will retry and self-heal, but in the meantime the cascade graph is broken. FK violations may surface in unrelated read paths (`tournament.findMany` with `include: { divisions: true }` will not show the deleted divisions, but `division.findUnique` for a stale ID will return null and break any UI that didn't anticipate it).

**Remediation:** Wrap the four `deleteMany` calls in `prisma.$transaction(async (tx) => { ... })`. Or use `prisma.$transaction([tx.incident.deleteMany(...), tx.division.deleteMany(...), ...])` as a single batch. Also add a `result.failedAt` log so an operator can spot a stuck purge.

**Evidence:**
```ts
// src/server/services/retention-policy.ts:30-60
export async function purgeExpiredSoftDeletes(database, cutoff) {
  const [incidents, divisions, tournaments, competitors] = await Promise.all([
    database.incident.deleteMany({ where: { deletedAt: { lt: cutoff } } }),
    database.division.deleteMany({ where: { deletedAt: { lt: cutoff } } }),
    database.tournament.deleteMany({ where: { deletedAt: { lt: cutoff } } }),
    database.competitor.deleteMany({ where: { deletedAt: { lt: cutoff } } }),
  ]);
  return { total: incidents.count + divisions.count + tournaments.count + competitors.count };
}
```

```ts
// src/server/services/retention-policy.ts:88-95  (no error isolation between deletes)
const run = async () => {
  try {
    const cutoff = calculateRetentionCutoff(now(), retentionDays);
    const result = await purgeExpiredSoftDeletes(database, cutoff);
    logger.info(`[retention] purged ${result.total} expired soft-deleted records`);
  } catch (error) {
    logger.error('[retention] purge failed', error);
  }
};
```

---

### [MEDIUM] 9. `express-rate-limit` uses in-memory store

**Location:** `src/server/middleware/rate-limit.ts:58-66`.

**Trigger:** Production runs more than one app instance (Coolify, Kubernetes, Cloudflare load-balancing across multiple `tsx` workers). Each instance has its own `Map` of `{ip → count}`. The effective limit is `windowMs / max * N_instances`.

**Impact:** The `auth` limiter (5 attempts / 15 min) effectively becomes `5 * N` attempts / 15 min across the cluster. A targeted attacker round-robins IPs across instances to bypass the magic-link brute-force protection. Same issue for the `/api/public/portal/register` school-portal limiter and the `/api/support/chat` limiter.

**Remediation:** Switch to `rate-limit-redis` (or any shared store) when `REDIS_URL` is set. The library supports it via the `store` option. If Redis is not in the stack, an explicit single-instance constraint with a code comment is acceptable, but the deploy must be single-instance.

**Evidence:**
```ts
// src/server/middleware/rate-limit.ts:58-66
export function createRateLimiter(options: Partial<Options>): RateLimitRequestHandler {
  const shouldSkip = isTestEnvironment();
  return rateLimit({
    ...options,
    skip: options.skip || (() => shouldSkip),
    standardHeaders: options.standardHeaders ?? true,
    legacyHeaders: options.legacyHeaders ?? false,
  });
}
```

---

### [MEDIUM] 10. Custom domain lookup runs on every API request

**Location:** `src/server/index.ts:220` (`app.use(resolveCustomDomainHost())`).

**Trigger:** Every API call resolves the request's `Host` header against the `CustomDomain` table. The middleware is mounted globally, before all routers, so even a `/api/health` ping pays the cost.

**Impact:** Extra `SELECT` per request. With a hot tenant (e.g. an org running 10 rings of live scoreboards) at 100 RPS, that's an extra 100 QPS on `CustomDomain` for lookups that rarely change (a domain is verified once and then `disabledAt` / `revokedAt` only flip on rare admin actions). At 100k+ req/day this shows up in slow-query logs.

**Remediation:** Add a tiny in-process LRU (or Redis) cache keyed on `hostname` with a 60s TTL. Invalidate on `CustomDomain.upsert` and `CustomDomain.update` (the `custom-domains.ts` route handler). Acceptable to skip the cache in test env.

---

### [MEDIUM] 11. Write paths without rate limit

**Location:** Verified by grep across `src/server/routes/*.ts` for `rateLimit` / `rate-limit` / `limiter` imports. The following files have **no rate limit** despite doing writes that can be hammered:

- `competitors.ts` (incl. `POST /api/competitors/import` which can take 30s+)
- `divisions.ts` (incl. `POST /api/divisions/:id/regenerate`)
- `tournaments.ts` (incl. `POST /api/tournaments`, `DELETE /api/tournaments/:id`)
- `organizations.ts` (incl. `POST /api/organizations`, `DELETE /api/organizations/:id`)
- `analytics.ts` (the dashboard endpoint in Finding #4)
- `billing.ts` (the customer-facing checkout-creation endpoint — note the Stripe webhook is on a separate path with raw body parser, so it doesn't need a limiter)

**Trigger:** An attacker with a valid JWT for any role above `viewer` floods these endpoints.

**Impact:** A single director can DoS the DB by spamming tournament create/delete, or by hammering `POST /api/competitors/import` (which does a 5000-row transaction — see `excel-import.ts:74`).

**Remediation:** Mount a default write-rate-limiter on each of these routers (`createRateLimiter({ windowMs: 60_000, max: 60, keyGenerator: req => req.user!.id })`). Tighter for `tournaments` delete (`max: 10`) and for `analytics` (`max: 30/min/user`).

**Evidence:**
```sh
$ grep -l 'rateLimit' src/server/routes/competitors.ts
(no match)
$ grep -l 'rateLimit' src/server/routes/divisions.ts
(no match)
$ grep -l 'rateLimit' src/server/routes/tournaments.ts
(no match)
```

---

### [MEDIUM] 12. `Match` query hot-path missing composite indexes

**Location:** `prisma/schema.prisma:269-272`.

**Trigger:** The "next matches by ring" query (in `services/operational-query.ts` and `routes/public.ts:1227-1411`) filters by `status IN ('pending','ready','in_progress')` and orders by `scheduledAt` (or `scheduledTime` per migration). The schema has only `@@index([status])`, `@@index([bracketId])`, `@@index([competitor1Id])`, `@@index([competitor2Id])` — no `(status, scheduledAt)` composite and no `ring` index. A multi-ring tournament with 500 matches will sort the candidate set in memory.

**Impact:** Slow "next match" panel on the operator dashboard. As the tournament grows during a day, the response time creeps up from <50ms to 200ms+.

**Remediation:** Add `@@index([status, scheduledAt])` and `@@index([bracketId, roundName, matchNumber])`. The bracket reorder uses `(bracketId, roundName, matchNumber)`.

**Evidence:**
```prisma
// prisma/schema.prisma:269-272
@@index([bracketId])
@@index([status])
@@index([competitor1Id])
@@index([competitor2Id])
```

---

### [MEDIUM] 13. `$queryRawUnsafe` used where `$queryRaw` would do

**Location:** `src/server/services/recommendation-contract.ts:58`; also referenced in `services/bracket-correction.ts` and `services/schedule-correction.ts` for the `SELECT ... FOR UPDATE` pattern.

**Trigger:** Reviewer / linter pass.

**Impact:** Not a vulnerability in this case — the callsite passes `recommendationId` as a bound parameter (`$queryRawUnsafe(sql, recommendationId)`), so the unsafe API is used safely. But it trips a `grep` for raw SQL and is easy to copy-paste into a vulnerable position later.

**Remediation:** Replace with `prisma.$queryRaw\`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtext(${recommendationId}))\`` (template literal form). The lock acquisition logic in `bracket-correction.ts` (the `SELECT ... FOR UPDATE` on Match rows) can stay on `$queryRaw` template form for the same reason.

**Evidence:**
```ts
// src/server/services/recommendation-contract.ts:58
await db.$queryRawUnsafe('SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtext($1))', recommendationId);
```

---

### [MEDIUM] 14. WebSocket `subs.forEach(broadcast)` does not isolate per-socket send failures

**Location:** `src/server/services/websocket.ts:121-128`.

**Trigger:** A connected socket has been TCP-closed but the `close` event hasn't fired yet (or the socket is in CLOSE_WAIT). `ws.send(payload)` throws `ERR_SOCKET_CLOSED`. The throw propagates out of the `forEach` callback and aborts the broadcast loop, so the remaining 50 clients in the set don't get the update.

**Impact:** A single zombie socket can silence live updates for the rest of the division.

**Remediation:** Wrap each `ws.send` in a `try { ws.send(...) } catch { /* drop from set */ }` and `delete ws` from the set on failure. Or use the `ws.broadcast` style with a `ping` heartbeat that closes idle sockets before the send fails.

**Evidence:**
```ts
// src/server/services/websocket.ts:121-128
const dispatch = (subs: Set<ClientState> | undefined) => {
  if (!subs) return;
  for (const sub of subs) {
    sub.ws.send(payloadString);   // <-- no try/catch
  }
};
```

---

### [LOW] 15. `console.log` in management-token audit-log path

**Location:** `src/server/routes/public.ts:786` (and similar in the public-portal audit-log path).

**Trigger:** A user (or attacker with a valid management token) calls the PATCH endpoint. The server logs a structured JSON line via `console.log`. The token is truncated (`registrationId.slice(0,8)`) but the actor IP and user agent may be present.

**Impact:** No PII, but the prior audit (`AUDIT-REPORT-2026-06-26.md` Finding D-1) called out exactly this pattern. The structured log is fine — it just needs to go through the existing `httpMetrics` / Sentry / structured logger pipeline rather than `console.log`, so that log levels and redaction are uniform.

**Remediation:** Replace with a `logger.info(...)` that goes through the same observability pipeline as the rest of the server. The pipeline already exists (`createHttpMetrics` in `index.ts:76`).

**Evidence:**
```ts
// src/server/routes/public.ts:786 (approx)
console.log(JSON.stringify({
  event: 'management_token.used',
  registrationId: registration.id.slice(0, 8),
  ip: req.ip,
  ...
}));
```

---

### [LOW] 16. Helmet CSP uses `'unsafe-inline'` for styles

**Location:** `src/server/index.ts:147-161`.

**Trigger:** Code review. The CSP allows `style-src 'self' 'unsafe-inline'` to accommodate Vite's inline style hydration. The comment in the code already explains the trade-off (`'default-src 'self'` would break Vite).

**Impact:** Defense-in-depth gap. A future XSS finding has a bigger blast radius because style-src is permissive.

**Remediation:** Switch to a per-build nonce (`helmet({ contentSecurityPolicy: { directives: { styleSrc: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`] } } })`) and have Vite emit the nonce on its inline styles. Out of scope for "ship"; worth tracking.

**Evidence:**
```ts
// src/server/index.ts:147-161
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        ...
      },
    },
  }),
);
```

---

### [LOW] 17. `grace-period-job` exists but is not wired into `index.ts`

**Location:** `src/server/services/grace-period-job.ts`; `grep setInterval src/server` returns only `retention-policy.ts:85`.

**Trigger:** Code review. The job file exists, exports a runner, but `index.ts` does not call it on boot.

**Impact:** An organization whose billing fails (Stripe webhook returns `invoice.payment_failed`) and that enters a grace period will never be downgraded at the end of that period. The plan will sit in `past_due` indefinitely. The dashboard will show the org as "active" and feature flags will not flip.

**Remediation:** Either wire it into `index.ts` alongside `startRetentionPurgeJob` (with a `setInterval` + `timer.unref?.()`), or run it on a Cloudflare Worker cron / Coolify cron and document the schedule. Add a Sentry / metrics counter `grace_period_runs_total` so an operator can confirm it's running.

---

### [LOW] 18. `competitor-deduplication` has no DB-level invariant to enforce it

**Location:** `src/server/services/competitor-deduplication.ts`; `prisma/schema.prisma` (no unique constraint on Competitor natural key).

**Trigger:** The service presumably merges duplicate competitor rows based on `firstName + lastName + dateOfBirth` (+ maybe email). The DB has no constraint to back this up. As shown in Finding #2, the registration path is free to create new `Competitor` rows for the same person.

**Impact:** The dedup service is advisory only. It cannot prevent the duplicates — only clean them up after the fact.

**Remediation:** Add a partial unique index `@@unique([tournamentId, firstName, lastName, dateOfBirth], where: deletedAt IS NULL)` (or a deterministic hash column) so the `public.ts` and `public-portal.ts` register handlers can `upsert` instead of `findFirst`-then-`create`, and let the dedup service be a backstop for the legacy rows.

---

## 4. Regression check vs `AUDIT-REPORT-2026-06-26.md`

The prior audit had 6 backend findings. Status of each:

| Prior finding | Status | Note |
|---|---|---|
| D-1: `console.log` of magic-link code in prod | **FIXED** | `src/server/routes/auth.ts:217` and surrounding are now gated by `process.env.NODE_ENV !== 'production'`. No regression. |
| D-2: Stale closure in `Scorekeeper` (frontend) | Out of backend scope (frontend-only) | Not re-checked here. |
| D-3: `console.warn` noise in `match-advancement.ts` for "match not ready" | **PARTIALLY FIXED** | The noisy `console.warn` was removed from the main hot path. The successor file still uses the helper `validateMatchStatusTransition` which has internal logging — the volume is low. Not regressed, but worth a follow-up grep for `console.warn` if the audit ever needs to expand. |
| D-4: Default JSON body limit was unbounded (OOM) | **FIXED** | `index.ts:178-191` sets 1 MB global with a 40 MB per-route override for `auto-map`. No regression. |
| D-5: `/api/.../templates/import-mapping.json` leaks schema | **NOT REGRESSED** | Endpoint still exists by design (per prior audit). Not re-checked. |
| D-6: SIGTERM not handled (Prisma pool leak) | **FIXED** | `index.ts:367+` handles SIGTERM/SIGINT and closes the Prisma client. No regression. |
| D-7: env validation only at first DB call (silent boot) | **FIXED** | `index.ts:87-94` runs `validateProductionServiceConfig` and `process.exit(1)` on missing vars. No regression. |
| D-8: Billing webhook re-serialisation broke Stripe signature | **FIXED** | `index.ts:165` mounts `express.raw` on the webhook path before any other parser. No regression. |

**No regressions found in the previous findings. The new issues (Findings #1–#18) are net-new.**

---

## 5. Verdict

**`NEEDS_FIXES_BEFORE_SHIP`**

The two CRITICAL findings are non-negotiable:

1. Reconcile `prisma/schema.prisma` with `prisma/migrations/20260710_init/migration.sql` (Finding #1 + Finding #7). Stop using `prisma db push` in the deploy path. Regenerate the migration from the current schema with `prisma migrate diff`.
2. Make `/api/public/register` and `/api/public/portal/register` atomic and Stripe-failure-resilient (Finding #2).

After those, the HIGH-tier items (Findings #3, #4, #5, #6) should land in the same release because they affect the core live-event experience.

MEDIUM items can ship as follow-up tickets within a week. LOW items are nice-to-have.
