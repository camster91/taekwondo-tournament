# API Contracts — Shared Type Safety

**Created:** 2026-09-10  
**Owner:** Cameron (camster91)  
**Status:** Phase 2 COMPLETE (PR #279), Phase 3 DEFERRED  
**Goal:** Type-safe client-server communication with Zod schemas

---

## Overview

The `@/shared/contracts` layer provides shared TypeScript types and Zod schemas for API request/response contracts between the React client and Express server. This eliminates type mismatches, reduces runtime errors, and enables IDE autocomplete for API data shapes.

---

## Architecture

```
src/shared/contracts/
├── auth.ts              # Auth endpoints (login, magic-link, user mgmt)
├── tournaments.ts       # Tournament CRUD, rules, weight classes
├── divisions.ts         # Division generation, assignments, operations
├── brackets.ts          # Bracket generation, match updates, placements
├── competitors.ts       # Competitor registry, import, search
├── registrations.ts     # Public + staff registration
├── analytics.ts         # Dashboard stats, tournament metrics
└── index.ts             # Re-exports all contracts
```

Each contract file defines:
1. **Zod schemas** for request payloads and response bodies
2. **TypeScript types** inferred from Zod schemas (via `z.infer<>`)
3. **Endpoint descriptors** (method, path, request/response types)

---

## Usage

### Client (React Query)

```ts
import { useQuery, useMutation } from '@tanstack/react-query';
import type { TournamentListResponse, TournamentCreateRequest } from '@/shared/contracts';

// Type-safe query
const { data } = useQuery<TournamentListResponse>({
  queryKey: ['tournaments'],
  queryFn: async () => {
    const res = await fetch('/api/tournaments', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch tournaments');
    return res.json(); // TypeScript knows this is TournamentListResponse
  },
});

// Type-safe mutation
const createMutation = useMutation<Tournament, Error, TournamentCreateRequest>({
  mutationFn: async (payload) => {
    const res = await fetch('/api/tournaments', {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Failed to create tournament');
    return res.json();
  },
});
```

### Server (Express + Zod validation)

```ts
import { tournamentCreateSchema } from '@/shared/contracts';

router.post('/tournaments', authenticate, requireRole('admin', 'director'), async (req, res) => {
  const parsed = tournamentCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error });
  }

  const tournament = await prisma.tournament.create({
    data: { ...parsed.data, createdBy: req.user!.id },
  });

  res.status(201).json(tournament); // TypeScript knows this matches TournamentCreateResponse
});
```

---

## Migration Status

### Phase 1: Foundation (COMPLETE)

- [x] Create `src/shared/contracts/` directory structure
- [x] Define Zod schemas for core endpoints
- [x] Export TypeScript types via `z.infer<>`
- [x] Document usage patterns in this file

### Phase 2: Client Migration (COMPLETE — PR #279)

**Migrated surfaces** (use `@/shared/contracts` types):
- [x] **DirectorDashboard**: Tournament progress queries, day-of operations
- [x] **Scorekeeper**: Match scoring, division list, bracket updates
- [x] **Divisions**: Division CRUD, categorization, assignments
- [x] **BracketEditor**: Bracket generation, match updates, placements

**api-types.ts retained** (deprecated but not removed):
- Legacy types remain in `src/shared/api-types.ts` for surfaces not yet migrated
- Gradually replace with `@/shared/contracts` imports during feature work
- DO NOT add new types to `api-types.ts` — use `@/shared/contracts` instead

### Phase 3: Runtime Validation (DEFERRED)

**Scope**: Add `.parse()` calls on client and server to enforce contracts at runtime (not just compile-time).

**Why deferred**: Performance concerns. Zod `.parse()` on every API request/response could add 5-50ms latency per call. Need to benchmark:
1. Client-side: Does parsing 500-competitor division lists cause UI jank?
2. Server-side: Does parsing match updates on 8 concurrent rings slow down real-time scoring?
3. Production: What's the p95 latency impact on check-in, scorekeeper, public registration?

**DO NOT implement Phase 3 until benchmarked**. The type safety from TypeScript + IDE autocomplete is already a huge win. Runtime validation is nice-to-have, not a requirement for pilot launch.

When benchmarking is ready:
- Create isolated benchmark suite (not part of e2e tests)
- Measure `.parse()` overhead for representative payloads (100 competitors, 50 matches, etc.)
- If p95 < 10ms, proceed with Phase 3. If > 10ms, keep Phase 3 deferred.

---

## Conventions

### Naming

- **Request types**: `{Resource}{Action}Request` (e.g., `TournamentCreateRequest`, `MatchUpdateRequest`)
- **Response types**: `{Resource}{Action}Response` or just `{Resource}` for CRUD reads (e.g., `TournamentListResponse`, `Tournament`)
- **Zod schemas**: `{camelCase}Schema` (e.g., `tournamentCreateSchema`, `matchUpdateSchema`)

### File organization

- One file per resource domain (`tournaments.ts`, `divisions.ts`, etc.)
- Each file exports:
  1. Zod schemas first (source of truth)
  2. TypeScript types inferred from schemas
  3. Re-export common types from Prisma (e.g., `Tournament` from `@prisma/client`)

### Breaking changes

- When changing a contract, update BOTH server and client in the same PR
- Never deploy a server change that breaks the client (or vice versa)
- For additive changes (new optional fields), prefer `z.optional()` to avoid breaking existing clients

---

## Example: Adding a New Contract

**1. Define Zod schema + types in `src/shared/contracts/tournaments.ts`:**

```ts
import { z } from 'zod';

export const tournamentUpdateRulesSchema = z.object({
  scoringSystem: z.enum(['point', 'round']).optional(),
  matchDuration: z.number().int().positive().optional(),
  // ... other fields
});

export type TournamentUpdateRulesRequest = z.infer<typeof tournamentUpdateRulesSchema>;
export type TournamentUpdateRulesResponse = { success: boolean; rules: TournamentRules };
```

**2. Use schema in server route:**

```ts
import { tournamentUpdateRulesSchema } from '@/shared/contracts';

router.put('/tournaments/:id/rules', authenticate, async (req, res) => {
  const parsed = tournamentUpdateRulesSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid rules', details: parsed.error });
  }

  const rules = await updateTournamentRules(req.params.id, parsed.data);
  res.json({ success: true, rules });
});
```

**3. Use types in client mutation:**

```ts
import type { TournamentUpdateRulesRequest, TournamentUpdateRulesResponse } from '@/shared/contracts';

const updateRulesMutation = useMutation<TournamentUpdateRulesResponse, Error, TournamentUpdateRulesRequest>({
  mutationFn: async (rules) => {
    const res = await fetch(`/api/tournaments/${tournamentId}/rules`, {
      method: 'PUT',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(rules),
    });
    if (!res.ok) throw new Error('Failed to update rules');
    return res.json();
  },
});
```

---

## Rationale: Why Contracts?

**Before contracts** (ad-hoc types):
- Client and server define separate, duplicate types
- Easy to drift (server adds a field, client doesn't know about it)
- Runtime errors from shape mismatches (server returns `{ competitorId }`, client expects `{ competitor }`)
- No IDE autocomplete for API payloads

**After contracts** (shared Zod schemas):
- Single source of truth for request/response shapes
- TypeScript catches mismatches at compile time
- IDE autocomplete for API payloads (less typos, faster dev)
- Future: Optional runtime validation (Phase 3) for extra safety

---

## Status Summary

| Phase | Status | PR | Notes |
|-------|--------|----|-----------| 
| **Phase 1: Foundation** | ✅ COMPLETE | N/A | Zod schemas + types defined in `@/shared/contracts` |
| **Phase 2: Client migration** | ✅ COMPLETE | #279 | DirectorDashboard, Scorekeeper, Divisions, BracketEditor migrated. `api-types.ts` deprecated but retained. |
| **Phase 3: Runtime validation** | ⏸️ DEFERRED | N/A | Pending performance benchmarking. DO NOT implement until benchmarked. |

**Next action**: Continue migrating remaining surfaces (CheckIn, Results, Schedule, etc.) to `@/shared/contracts` during feature work. Remove `api-types.ts` once all surfaces migrated.
