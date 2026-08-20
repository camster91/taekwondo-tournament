/**
 * Shared API response contracts (issue #130).
 *
 * Every Zod schema in this folder is the single source of truth for a
 * server response shape. The client derives its types via `z.infer<typeof
 * Schema>` so the wire and the page cannot drift — see
 * `src/client/utils/api-types.ts` for the re-exports.
 *
 * Adding a new contract:
 *   1. Create `src/shared/contracts/<endpoint>.ts` with a Zod schema.
 *   2. Add a contract test under `__tests__/`.
 *   3. If the response shape is consumed by the client, re-export the
 *      inferred type from `src/client/utils/api-types.ts`.
 *   4. Document the endpoint in `docs/contracts.md`.
 */
export * from './public-scoreboard.js';
export * from './division-with-matches.js';
