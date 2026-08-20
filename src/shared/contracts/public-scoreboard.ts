/**
 * Zod contract for `GET /api/public/scoreboard/:publicSlug`
 * (and the same shape returned by `/api/public/tournaments/:id/scoreboard`
 * once a director-issued key is verified — the public route only changes
 * the `tournament` lookup, not the payload).
 *
 * This is the single source of truth for the public scoreboard response.
 * The client (`src/client/pages/PublicScoreboard.tsx`) re-exports
 * `PublicScoreboardDivision` from this module so the page cannot drift
 * from the wire shape — adding, removing, or renaming a field here causes
 * a TypeScript error in the page (good) and a contract test failure (also
 * good).
 *
 * Why Zod instead of an OpenAPI generator:
 *  - We already depend on Zod for request validation (`src/server/middleware/validate.ts`).
 *  - Zod gives us runtime validation in tests *and* static types via `z.infer`,
 *    without an extra build step.
 *  - The set of "high-risk" endpoints is small; a per-route Zod schema is
 *    easier to maintain than a generated OpenAPI spec.
 *
 * If a future endpoint needs broader type guarantees, see
 * `docs/contracts.md` for the staged rollout plan to all 41 open-issue
 * candidate endpoints.
 */
import { z } from 'zod';

// Mirror the Prisma `Division` and `Match` string-enum columns. Keep these
// enums in lockstep with `prisma/schema.prisma`; the contract test will
// catch drift on the server side, and the page consumes them on the client.
export const MatchStatusSchema = z.enum([
  'pending',
  'ready',
  'in_progress',
  'completed',
  'bye',
]);
export type MatchStatus = z.infer<typeof MatchStatusSchema>;

export const BracketTypeSchema = z.enum(['winners', 'losers', 'finals']);
export type BracketType = z.infer<typeof BracketTypeSchema>;

/**
 * The trimmed competitor view included in public scoreboard matches.
 * `schoolDojang` is intentionally optional — historically `null` for
 * walk-in registrations and a string for pre-registered competitors.
 */
export const PublicCompetitorSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  schoolDojang: z.string().nullable().optional(),
});
export type PublicCompetitor = z.infer<typeof PublicCompetitorSchema>;

/**
 * `MatchCompetitor` is the join-row (a `Registration` with its competitor).
 * The public scoreboard only projects the competitor sub-object, so the
 * registration id is preserved for stable React keys but the rest of the
 * registration is omitted.
 */
const PublicMatchCompetitorSchema = z.object({
  id: z.string(),
  competitor: PublicCompetitorSchema,
});
export type PublicMatchCompetitor = z.infer<typeof PublicMatchCompetitorSchema>;

/**
 * A single match as returned by the public scoreboard. The optional fields
 * are nullable on the Prisma side (TBD slot, no score, no winner) so they
 * have to be `nullable()` rather than `optional()` here — `optional()` is
 * "field may be absent", `nullable()` is "field is present and may be null".
 */
export const PublicMatchSchema = z.object({
  id: z.string(),
  roundNumber: z.number().int(),
  matchNumber: z.number().int(),
  bracketType: BracketTypeSchema,
  status: MatchStatusSchema,
  ringNumber: z.number().int().nullable().optional(),
  scheduledTime: z.string().nullable().optional(),
  competitor1: PublicMatchCompetitorSchema.nullable(),
  competitor2: PublicMatchCompetitorSchema.nullable(),
  winner: PublicMatchCompetitorSchema.nullable().optional(),
  score1: z.string().nullable().optional(),
  score2: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  startedAt: z.string().nullable().optional(),
});
export type PublicMatch = z.infer<typeof PublicMatchSchema>;

export const PublicBracketSchema = z.object({
  id: z.string(),
  format: z.string().nullable().optional(),
  matches: z.array(PublicMatchSchema),
});
export type PublicBracket = z.infer<typeof PublicBracketSchema>;

/**
 * The public scoreboard only includes divisions whose bracket is published
 * (see `prisma.division.findMany` in `src/server/routes/public.ts`). The
 * payload is the full Prisma division row plus the bracket include — we
 * accept the extras here so a future server-side addition (e.g. `_count`)
 * doesn't break the contract test, but the public client only reads the
 * fields it needs.
 *
 * `.passthrough()` would be more permissive but masks accidental renames;
 * `.strict()` would be too brittle (every new server field is a breaking
 * change). The middle ground: list every field Prisma currently returns,
 * and add new fields here *and* in the consumer at the same time.
 */
export const PublicScoreboardDivisionSchema = z.object({
  id: z.string(),
  tournamentId: z.string(),
  name: z.string(),
  beltLevel: z.string(),
  gender: z.string(),
  eventType: z.string(),
  ageMin: z.number().int(),
  ageMax: z.number().int(),
  beltColors: z.string().nullable().optional(),
  danMin: z.number().int().nullable().optional(),
  danMax: z.number().int().nullable().optional(),
  weightClass: z.string().nullable().optional(),
  divisionNumber: z.number().int(),
  deletedAt: z.string().nullable().optional(),
  isSpecialNeeds: z.boolean().optional(),
  displayOrder: z.number().int().nullable().optional(),
  createdAt: z.string().optional(),
  bracketDifficulty: z.number().nullable().optional(),
  matchupQuality: z.number().nullable().optional(),
  avgSkillRating: z.number().nullable().optional(),
  bracket: PublicBracketSchema.nullable(),
});
export type PublicScoreboardDivision = z.infer<typeof PublicScoreboardDivisionSchema>;

/**
 * Top-level response: a JSON array of divisions. The route does not wrap
 * the result in `{ data: [...] }`; a wrapper is a future refactor that
 * should land here, not silently in the handler.
 */
export const PublicScoreboardResponseSchema = z.array(PublicScoreboardDivisionSchema);
export type PublicScoreboardResponse = z.infer<typeof PublicScoreboardResponseSchema>;
