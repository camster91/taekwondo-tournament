/**
 * Shared API response contracts.
 * 
 * This module exports Zod schemas that define the canonical shape of API responses
 * for high-risk workflows. These contracts serve as:
 * 
 * 1. Single source of truth for response shapes across server and client
 * 2. Runtime validation boundary (optional, see docs/contracts.md for rollout)
 * 3. Type inference source for TypeScript consumers
 * 4. Contract test anchors to catch Prisma include drift
 * 
 * ## Usage patterns
 * 
 * ### Server-side (response validation)
 * ```typescript
 * import { apiDivisionArraySchema } from '@/shared/contracts';
 * 
 * const divisions = await prisma.division.findMany({ ... });
 * // Optional: validate before sending (staged rollout per endpoint)
 * const validated = apiDivisionArraySchema.parse(divisions);
 * res.json(validated);
 * ```
 * 
 * ### Client-side (type imports)
 * ```typescript
 * import type { ApiDivision } from '@/shared/contracts';
 * 
 * const divisions: ApiDivision[] = await fetchDivisions();
 * ```
 * 
 * ### Contract tests
 * ```typescript
 * import { validatePublicScoreboardResponse } from '@/shared/contracts';
 * 
 * const result = await prisma.division.findMany({ include: { ... } });
 * expect(() => validatePublicScoreboardResponse(result)).not.toThrow();
 * ```
 * 
 * See docs/contracts.md for rollout stages and integration guidelines.
 */

// Match contracts
export {
  matchStatusSchema,
  bracketTypeSchema,
  matchCompetitorSlotSchema,
  apiMatchSchema,
  apiMatchArraySchema,
  type MatchStatus,
  type BracketType,
  type MatchCompetitorSlot,
  type ApiMatch,
  type ApiMatchArray,
} from './match.js';

// Division contracts
export {
  bracketFormatSchema,
  apiBracketSchema,
  apiDivisionSchema,
  apiDivisionArraySchema,
  apiDivisionWithCountSchema,
  type BracketFormat,
  type ApiBracket,
  type ApiDivision,
  type ApiDivisionArray,
  type ApiDivisionWithCount,
} from './division.js';

// Tournament contracts
export {
  tournamentStatusSchema,
  apiTournamentSummarySchema,
  apiTournamentDetailSchema,
  apiTournamentSummaryArraySchema,
  type TournamentStatus,
  type ApiTournamentSummary,
  type ApiTournamentDetail,
  type ApiTournamentSummaryArray,
} from './tournament.js';

// Public scoreboard contracts
export {
  publicScoreboardResponseSchema,
  validatePublicScoreboardResponse,
  type PublicScoreboardResponse,
} from './public-scoreboard.js';

// Day-of operations contracts
export {
  ringStatusSchema,
  divisionProgressSchema,
  dayOfWarningSchema,
  dayOfOperationsResponseSchema,
  type RingStatus,
  type DivisionProgress,
  type DayOfWarning,
  type DayOfOperationsResponse,
} from './day-of-operations.js';

// Results contracts
export {
  competitorPlacementSchema,
  divisionResultsSchema,
  tournamentResultsResponseSchema,
  schoolResultsSchema,
  type CompetitorPlacement,
  type DivisionResults,
  type TournamentResultsResponse,
  type SchoolResults,
} from './results.js';
