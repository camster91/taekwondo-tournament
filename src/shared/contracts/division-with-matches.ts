/**
 * Zod contract for `GET /api/divisions/tournament/:tournamentId?withMatches=true`.
 *
 * This is the highest-traffic authenticated endpoint: the TournamentDetail,
 * Director, and Results pages all consume it. Issue clusters #26/#31/#38/#42
 * (TournamentDetail), #32/#36/#44 (scorekeeper), and #41 (Results) were
 * shape-drift bugs — see issue #130 for the full history.
 *
 * Schema is the single source of truth: the server handler builds the
 * Prisma `include` that produces this shape, and the contract test
 * (`__tests__/division-with-matches.contract.test.ts`) locks the wire
 * shape so a future Prisma upgrade or `include` change cannot silently
 * break the consumers.
 */
import { z } from 'zod';
import {
  BracketTypeSchema,
  MatchStatusSchema,
  PublicCompetitorSchema,
} from './public-scoreboard.js';

/**
 * Division + bracket with matches, as returned to authenticated staff
 * (TournamentDetail, Director dashboard, Results page). The fields here
 * are a superset of the public scoreboard division — authenticated staff
 * see the registration ids and the assignment count, which the public
 * scoreboard intentionally omits.
 */
const DivisionMatchCompetitorSchema = z.object({
  id: z.string(),
  competitor: PublicCompetitorSchema.extend({
    // Staff need a stable competitor id for the scorekeeper UI (linking
    // to competitor detail). Public scoreboard strips this on purpose.
    id: z.string(),
  }),
});
export type DivisionMatchCompetitor = z.infer<typeof DivisionMatchCompetitorSchema>;

export const DivisionMatchSchema = z.object({
  id: z.string(),
  roundNumber: z.number().int(),
  matchNumber: z.number().int(),
  bracketType: BracketTypeSchema,
  status: MatchStatusSchema,
  ringNumber: z.number().int().nullable().optional(),
  scheduledTime: z.string().nullable().optional(),
  competitor1: DivisionMatchCompetitorSchema.nullable(),
  competitor2: DivisionMatchCompetitorSchema.nullable(),
  winner: DivisionMatchCompetitorSchema.nullable().optional(),
  score1: z.string().nullable().optional(),
  score2: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  startedAt: z.string().nullable().optional(),
});
export type DivisionMatch = z.infer<typeof DivisionMatchSchema>;

/**
 * `DivisionMatch` enriched with the parent division's id and name. The
 * `DirectorDashboard` flattens matches across divisions and tags each
 * one with its origin so a single match list can be filtered back to
 * its division without an extra lookup.
 *
 * This shape lives in the contract module (not the page) so any
 * consumer that needs the same enrichment gets the same type and
 * contract tests assert the enrichment is structurally compatible
 * with the wire match.
 */
export type EnrichedDivisionMatch = DivisionMatch & {
  _divisionId: string;
  _divisionName: string;
};

export const DivisionBracketSchema = z.object({
  id: z.string(),
  structure: z.string(), // JSON string — bracket tree; parsed lazily by client
  format: z.string().nullable().optional(),
  matches: z.array(DivisionMatchSchema),
  // Computed by the handler from winnerId of finals — see
  // `getBracketPlacementsFromLoaded` in `src/server/routes/divisions.ts`.
  // Kept as `unknown` here because the placement shape is local to the
  // handler; the contract only asserts `placements` is an array when
  // `withMatches=true`. Consumers narrow the array element type.
  placements: z
    .array(z.unknown())
    .optional(),
});
export type DivisionBracket = z.infer<typeof DivisionBracketSchema>;

export const DivisionWithMatchesSchema = z.object({
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
  _count: z
    .object({
      assignments: z.number().int(),
    })
    .optional(),
  bracket: DivisionBracketSchema.nullable(),
});
export type DivisionWithMatches = z.infer<typeof DivisionWithMatchesSchema>;

export const DivisionWithMatchesResponseSchema = z.array(DivisionWithMatchesSchema);
export type DivisionWithMatchesResponse = z.infer<typeof DivisionWithMatchesResponseSchema>;
