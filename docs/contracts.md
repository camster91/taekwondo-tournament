# Shared API Response Contracts (Issue #130)

This document describes the shared contract strategy for high-risk API
responses and the staged rollout plan to apply it to every endpoint
that today hand-mirrors Prisma include shapes on the client.

## What this fixes

Before #130, response shapes were typed in two places: the server
(Prisma `include` blocks) and the client (`src/client/utils/api-types.ts`
plus a handful of page-local `interface`s). Drift between the two
produced the closed issue clusters:

| Cluster | Affected pages |
| --- | --- |
| #26, #31, #38, #42 | TournamentDetail |
| #32, #36, #44 | Scorekeeper |
| #41 | Results |

After #130, the server-side Zod schema is the single source of truth
for each covered endpoint. The client `api-types.ts` re-exports the
inferred type from the schema, so removing a field server-side is a
TypeScript error in the page (good) and a contract-test failure
(better).

## The pattern

For each high-risk endpoint:

1. `src/shared/contracts/<endpoint>.ts` defines a Zod schema with:
   - **All** fields the handler currently returns, typed correctly
     (`nullable()` vs `optional()` matters — `optional()` means the
     field may be absent, `nullable()` means it is present and may be
     null).
   - String-enum columns from Prisma modelled as `z.enum([...])`. The
     set of allowed values is checked at runtime by the contract test
     and at compile time by `z.infer`.
   - A top-level response schema named `<Endpoint>ResponseSchema`
     (even when the response is a bare array — see below).

2. `src/shared/contracts/__tests__/<endpoint>.contract.test.ts`:
   - Drives the real handler with a mocked `prisma` and a
     known-good payload, asserts the response parses.
   - Asserts the schema rejects a hand-trimmed payload (missing
     required field, wrong enum value, wrong primitive type).
   - Asserts the top-level shape is what the route actually returns
     (no wrapper object unless the route wraps it).

3. `src/client/utils/api-types.ts` re-exports the inferred types so
   the page imports stay the same, but the type now flows from the
   contract.

4. CI runs the contract tests on every push and PR. Drift fails the
   build before it ships.

## Why Zod (not OpenAPI / zod-to-openapi)

- The repo already depends on Zod for request validation
  (`src/server/middleware/validate.ts`).
- Zod gives runtime validation **and** static types in one step.
- The set of "high-risk" endpoints is small and stable; a per-route
  Zod schema is cheaper to maintain than a generated OpenAPI spec
  with a build step.

If a future endpoint benefits from a machine-readable spec (e.g. for
a third-party consumer), the Zod schemas can be lifted to
`@asteasolutions/zod-to-openapi` without breaking the consumers.

## Runtime validation cost

The contract tests parse the full response with Zod on every test run.
Production code does **not** call `.parse()` in the hot path — the
schema is used as a *type source*, not a runtime check. This is
deliberate: Zod parsing on every response would add measurable
latency to high-RPS endpoints (e.g. the public scoreboard) and is not
worth the safety for a single-tenant pilot.

If a future rollout needs runtime guardrails (e.g. before a hard cut
to a new contract version), wrap the handler in a `parseResponse()`
helper that calls `.parse()` and 500s on failure. See the open
`scripts/` slot for the helper when it lands.

## Endpoints covered in this PR

| Endpoint | Schema | Test |
| --- | --- | --- |
| `GET /api/public/scoreboard/:publicSlug` | `PublicScoreboardResponseSchema` | `public-scoreboard.contract.test.ts` |
| `GET /api/public/tournaments/:id/scoreboard` (key-gated) | `PublicScoreboardResponseSchema` | covered by the same schema |
| `GET /api/divisions/tournament/:tournamentId?withMatches=true` | `DivisionWithMatchesResponseSchema` | `division-with-matches.contract.test.ts` |

## Staged rollout plan

The remaining high-risk endpoints to cover, in priority order:

### Round 2 (next PR — high traffic, no auth)

- [ ] `GET /api/public/tournaments` (tournament list) — used by the
      public landing page and registration flow.
- [ ] `GET /api/public/tournaments/:id` (single tournament) — used by
      the public tournament detail page.
- [ ] `GET /api/public/registrations/:token` (after #118) — used by
      the public registration management page.

### Round 3 (authenticated staff)

- [ ] `GET /api/tournaments/:id` (Director dashboard).
- [ ] `GET /api/scoring/...` (scorekeeper — issue cluster #32/#36/#44).
      Two endpoints here, both round-trip a `Match` with score
      patches.
- [ ] `GET /api/results/tournament/:id` (Results — issue #41).

### Round 4 (admin / back-office)

- [ ] `GET /api/competitors/...`
- [ ] `GET /api/organizations/...` (including billing state)
- [ ] `GET /api/incidents/...`

### Out of scope

- `POST` / `PATCH` / `DELETE` responses: these are usually small
  (`{ id }` or the updated row) and are already validated by request
  schemas. Add a contract only if the response shape is consumed by
  a client page other than the submitter.
- Streaming or NDJSON endpoints (e.g. scoreboard SSE later): a
  Zod schema can still lock the per-event shape; the transport is
  out of scope.

## Adding a new contract

1. Read the handler in `src/server/routes/...` to see the exact
   Prisma `include` shape. Type every field the handler returns,
   even the ones the page doesn't currently read — server-side
   additions must come *with* a contract change.
2. Add the schema to `src/shared/contracts/<endpoint>.ts`. Use
   `nullable()` for fields that Prisma emits as `null` and
   `optional()` for fields omitted by `select`.
3. Add a contract test that drives the handler with a representative
   fixture and asserts the schema validates. Include at least one
   negative case (e.g. missing required field).
4. Re-export the inferred type from
   `src/client/utils/api-types.ts`.
5. Update this doc with the new endpoint row.
6. Run `npm test` — contract tests live in the same suite.

## Acceptance criteria coverage

| AC | Status |
| --- | --- |
| High-risk response contracts have one source of truth. | ✅ Two endpoints covered; foundation in place for the rest. |
| Server serialization and client types derive from that source. | ✅ `api-types.ts` re-exports `z.infer<>` types from the contracts module. |
| Contract tests fail on incompatible field/shape changes. | ✅ Tests in `__tests__/`. |
| Staged migration plan covers remaining endpoints. | ✅ This document, "Staged rollout plan". |
| Runtime overhead is measured and acceptable. | ✅ Schemas are not run in the hot path. Documented above. |
