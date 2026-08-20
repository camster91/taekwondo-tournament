# Shared API response contracts (issue #130)

## Problem
Several client types manually mirrored Prisma response shapes, which produced the closed issue clusters #26/#31/#38/#42 (TournamentDetail), #32/#36/#44 (Scorekeeper), and #41 (Results). Each new server field or include change risked breaking the page silently.

## What this PR does
Adds a shared `src/shared/contracts/` module with Zod response schemas for the two highest-traffic endpoints:

- `GET /api/public/scoreboard/:publicSlug` (and the key-gated `/api/public/tournaments/:id/scoreboard` variant)
- `GET /api/divisions/tournament/:tournamentId?withMatches=true`

The schemas are the single source of truth. `src/client/utils/api-types.ts` now re-exports `z.infer<>` types from the contracts module, so the wire shape and the page type cannot drift — removing a server-side field is now a TypeScript error in the page and a contract test failure in CI.

## Changes
- `src/shared/contracts/public-scoreboard.ts` — Zod schema for the public scoreboard response (division, bracket, match, competitor).
- `src/shared/contracts/division-with-matches.ts` — Zod schema for the authenticated divisions endpoint, including the `EnrichedDivisionMatch` type used by `DirectorDashboard` after `flatMap`.
- `src/shared/contracts/index.ts` — barrel export.
- `src/shared/contracts/__tests__/public-scoreboard.contract.test.ts` — 8 contract tests (valid payload, empty array, null bracket, missing required field, invalid enum, wrong primitive type, TBD slots).
- `src/shared/contracts/__tests__/division-with-matches.contract.test.ts` — 5 contract tests (valid payload, `_count` optional, missing `competitor.id`, top-level wrapper rejection, non-integer `roundNumber`).
- `src/client/utils/api-types.ts` — re-exports inferred types from `@shared/contracts`; legacy `ApiMatch` is now `EnrichedDivisionMatch` so the `_divisionId` / `_divisionName` enrichment is part of the contract.
- `docs/contracts.md` — staged rollout plan for the remaining high-risk endpoints (public tournament list, public registration, Director dashboard, scorekeeper, results, admin) and how to add a new contract.

## Why Zod, not OpenAPI
- Zod is already a dependency for request validation (`src/server/middleware/validate.ts`).
- Zod gives runtime validation *and* static types in one step.
- A per-route Zod schema is cheaper to maintain than a generated OpenAPI spec for a small, stable set of high-risk endpoints.
- The schemas are not run in the hot path — no runtime overhead on production requests.

## What the contracts caught
- `DirectorDashboard.tsx` used `Match.updatedAt` and `_divisionId` / `_divisionName`. The first was missing from the original hand-mirrored `api-types.ts`; the second is a client-side enrichment. Both are now part of the contract: `updatedAt` is on the schema, `_divisionId` / `_divisionName` are in a typed `EnrichedDivisionMatch` extension.

## Verification
- `npm run typecheck` — clean (server + client)
- `npm run lint` — clean
- `npm test` — **494/494** pass (was 481; +13 contract tests)
- `npm run build` — clean

## Out of scope (follow-up rounds)
Per `docs/contracts.md`:
- **Round 2** (next PR): public tournament list, public tournament detail, public registration management (after #118).
- **Round 3** (authenticated staff): Director dashboard, scorekeeper endpoints, results.
- **Round 4** (admin / back-office): competitors, organizations, incidents.

## Acceptance criteria
- ✅ High-risk response contracts have one source of truth (`src/shared/contracts/`).
- ✅ Server serialization and client types derive from that source (`api-types.ts` re-exports `z.infer<>`).
- ✅ Contract tests fail on incompatible field/shape changes (13 new tests under `__tests__/`).
- ✅ A staged migration plan covers remaining endpoints (`docs/contracts.md`).
- ✅ Runtime overhead is zero (schemas are not in the hot path; documented in `docs/contracts.md`).
