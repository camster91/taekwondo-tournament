# API Response Contracts

**Status**: Partial rollout (Phase 1 complete)  
**PR**: #XXX  
**Issue**: #130

This document describes the shared API response contract system that establishes a single source of truth for high-risk API endpoint shapes.

## Overview

API response contracts use Zod schemas in `src/shared/contracts/` to define canonical response shapes for endpoints that feed critical workflows:

- **Public scoreboard** (`GET /api/public/scoreboard/:publicSlug`)
- **Divisions with matches** (`GET /api/divisions/tournament/:id?withMatches=true`)
- **Day-of operations** (`GET /api/tournaments/:id/day-of`)
- **Results and placements** (`GET /api/brackets/tournament/:id/results`)
- **Tournament summaries** (dashboard aggregations)

### Why contracts matter

Before this system, the client mirrored API shapes in `src/client/utils/api-types.ts` with hand-written TypeScript interfaces. Drift between server Prisma includes and client types caused:

1. **Public scoreboard blank screens** when match include shapes changed
2. **Director dashboard crashes** when division queries evolved
3. **Type mismatches** that silently broke at runtime
4. **Manual synchronization burden** across 15+ API endpoints

Shared Zod schemas solve this by:

- **Single source of truth**: Server and client import the same types
- **Contract tests**: Fail if Prisma queries drift from documented shapes
- **Runtime validation (opt-in)**: Catch shape bugs before prod
- **Type inference**: TypeScript types automatically match runtime shape

## Architecture

```
src/shared/contracts/
├── index.ts                    # Barrel export
├── match.ts                    # Match + competitor slot schemas
├── division.ts                 # Division + bracket schemas
├── tournament.ts               # Tournament summary + detail schemas
├── public-scoreboard.ts        # Public scoreboard feed contract
├── day-of-operations.ts        # Director dashboard live data
└── results.ts                  # Placements + results exports

src/server/contracts/
├── public-scoreboard.contract.test.ts
├── divisions-with-matches.contract.test.ts
└── day-of-operations.contract.test.ts
```

### Contract test pattern

Contract tests instantiate a real Prisma client, run the actual query used by a route handler, and validate against the schema:

```typescript
import { validatePublicScoreboardResponse } from '@/shared/contracts';

it('validates GET /api/public/scoreboard/:publicSlug shape', async () => {
  // Copy-paste the ACTUAL Prisma query from the route handler
  const divisions = await prisma.division.findMany({
    where: { tournamentId: testId },
    include: {
      bracket: {
        include: {
          matches: {
            include: {
              competitor1: { include: { competitor: true } },
              competitor2: { include: { competitor: true } },
              winner: { include: { competitor: true } },
            },
          },
        },
      },
    },
  });

  // If this throws, either the query or the contract is wrong
  expect(() => validatePublicScoreboardResponse(divisions)).not.toThrow();
});
```

These tests **fail early** when:
- A migration changes the DB schema
- A refactor changes Prisma includes
- The documented contract drifts from reality

## Rollout stages

### ✅ Phase 1: Foundation (PR #XXX — this PR)

**Status**: Complete

- [x] Create `src/shared/contracts/` with 6 schema modules
- [x] Define high-risk contracts: match, division, tournament, public-scoreboard, day-of, results
- [x] Write 3 contract test suites covering public scoreboard + divisions + day-of
- [x] Migrate `PublicScoreboard.tsx` to use shared contracts (proof-of-concept)
- [x] Document rollout plan (this file)

**Scope**: No runtime validation yet; no server-side changes. Contracts are types-only with test coverage.

### 🚧 Phase 2: Client migration (next PR)

**Planned scope**:

- [ ] Migrate remaining pages from `api-types.ts` to `@/shared/contracts`:
  - `DirectorDashboard.tsx` (day-of operations)
  - `Scorekeeper.tsx` (divisions-with-matches)
  - `Results.tsx` (results contract)
  - `Divisions.tsx` (division management)
  - `BracketEditor.tsx` (match updates)
- [ ] Deprecate `src/client/utils/api-types.ts` (add deprecation comment)
- [ ] Add contract test for scorekeeper endpoint shape

**Success criteria**: Client imports contracts; `api-types.ts` is unused (but not deleted yet for rollback safety).

### 🔮 Phase 3: Server-side validation (staged rollout)

**Planned scope** (requires performance testing):

1. **Test-only validation**: Validate in tests but not in production handlers (de-risk)
2. **Read-only endpoints**: Add `.parse()` to public scoreboard + day-of (low write volume)
3. **Mutation endpoints**: Add validation to scorekeeper match updates (hot path — benchmark first)
4. **Full rollout**: Enable on all contract-covered endpoints

**Performance gating**: If `.parse()` adds >5ms p99 latency on hot paths (scorekeeper, public scoreboard), document that contracts are types + tests only, and skip runtime validation.

### 🔮 Phase 4: Expansion (future)

Add contracts for remaining endpoints:

- Competitor imports (`POST /api/competitors/import`)
- Schedule generation (`POST /api/tournaments/:id/schedule`)
- Registration APIs (`POST /api/public/register`)
- Bracket operations (`PUT /api/brackets/match/:id`)

## Usage patterns

### Server-side (route handlers)

```typescript
import { apiDivisionArraySchema } from '@/shared/contracts';

router.get('/divisions/tournament/:id', async (req, res) => {
  const divisions = await prisma.division.findMany({ ... });

  // Optional: validate before sending (Phase 3)
  // const validated = apiDivisionArraySchema.parse(divisions);

  res.json(divisions);
});
```

### Client-side (pages and hooks)

```typescript
import type { ApiDivision, PublicScoreboardResponse } from '@/shared/contracts';

export function PublicScoreboard() {
  const { data } = useQuery<PublicScoreboardResponse>({
    queryKey: ['scoreboard', publicSlug],
    queryFn: () => fetch(`/api/public/scoreboard/${publicSlug}`).then(r => r.json()),
  });

  return <DivisionList divisions={data} />;
}
```

### Contract tests

```typescript
import { validatePublicScoreboardResponse } from '@/shared/contracts';

it('validates scoreboard shape after migration', async () => {
  await runMigration('20260101_add_video_url');
  const result = await prisma.division.findMany({ include: { ... } });
  expect(() => validatePublicScoreboardResponse(result)).not.toThrow();
});
```

## Migration guide for new endpoints

When adding a new high-risk endpoint:

1. **Define the contract** in `src/shared/contracts/` (follow existing patterns)
2. **Export from `index.ts`** so consumers import from `@/shared/contracts`
3. **Write a contract test** that runs the actual Prisma query and validates
4. **Use the type** in client pages/hooks
5. **Document** in this file (add to Phase 4 list)

## FAQ

### Why Zod instead of TypeScript-only types?

Zod provides runtime validation + type inference. Contract tests use Zod `.parse()` to catch shape bugs at test time. TypeScript alone can't validate runtime Prisma query results.

### Should we validate every endpoint?

No. Focus on high-risk shapes:
- High traffic (public scoreboard)
- Complex includes (divisions-with-matches)
- Day-of critical (director dashboard)
- Hard-to-debug failures (blank screens, type errors)

Low-risk endpoints (user profile, settings) don't need contracts.

### What if validation is too slow?

Benchmark `.parse()` on hot paths. If p99 latency increases >5ms, skip runtime validation and keep contracts as types + test anchors only.

### Can we use contracts for request validation too?

Yes, but that's a separate concern. Request validation uses `src/server/middleware/validate.ts` with route-specific Zod schemas. Contracts are specifically for *response* shapes.

### What about Prisma type drift?

Prisma generates TypeScript types from `schema.prisma`. When you add a field to the DB, Prisma types automatically include it. Contracts are *narrower* — they document only the fields actually returned by the API. Contract tests catch when Prisma includes don't match the documented contract.

## Related

- **Issue #130**: Original contract proposal
- **PR #183**: Previous contract attempt (closed, stale)
- `src/server/middleware/validate.ts`: Request validation (not responses)
- `src/client/utils/api-types.ts`: Legacy client-side mirror types (deprecated in Phase 2)
