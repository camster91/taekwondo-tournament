/**
 * Results and placements API response contracts.
 * 
 * Used by results pages, PDF exports, and certificate generation.
 */

import { z } from 'zod';

/**
 * Competitor placement in a division.
 */
export const competitorPlacementSchema = z.object({
  competitorId: z.string().uuid(),
  firstName: z.string(),
  lastName: z.string(),
  schoolDojang: z.string().nullable(),
  place: z.number().int().min(1).max(4), // 1st, 2nd, 3rd, 4th
  totalWins: z.number().int().min(0),
  totalLosses: z.number().int().min(0),
  // Pool play / round robin specific
  points: z.number().int().min(0).optional(),
  tiebreaker: z.string().nullable().optional(),
});

export type CompetitorPlacement = z.infer<typeof competitorPlacementSchema>;

/**
 * Division results with placements.
 */
export const divisionResultsSchema = z.object({
  divisionId: z.string().uuid(),
  divisionName: z.string(),
  eventType: z.string(),
  beltLevel: z.string().nullable(),
  gender: z.string().nullable(),
  ageMin: z.number().int().nullable(),
  ageMax: z.number().int().nullable(),
  weightClass: z.string().nullable(),
  format: z.enum(['double_elim', 'single_elim', 'round_robin', 'pool_play']).nullable(),
  placements: z.array(competitorPlacementSchema),
  isComplete: z.boolean(),
});

export type DivisionResults = z.infer<typeof divisionResultsSchema>;

/**
 * Tournament results response.
 * 
 * Used by:
 * - GET /api/brackets/tournament/:tournamentId/results
 * - Results page
 * - CSV/PDF export endpoints
 */
export const tournamentResultsResponseSchema = z.object({
  tournamentId: z.string().uuid(),
  tournamentName: z.string(),
  date: z.string().datetime(),
  divisions: z.array(divisionResultsSchema),
  totalDivisions: z.number().int().min(0),
  completedDivisions: z.number().int().min(0),
});

export type TournamentResultsResponse = z.infer<typeof tournamentResultsResponseSchema>;

/**
 * School-level results aggregation for school report PDF.
 */
export const schoolResultsSchema = z.object({
  schoolName: z.string(),
  totalCompetitors: z.number().int().min(0),
  goldMedals: z.number().int().min(0),
  silverMedals: z.number().int().min(0),
  bronzeMedals: z.number().int().min(0),
  fourthPlace: z.number().int().min(0),
  competitors: z.array(z.object({
    firstName: z.string(),
    lastName: z.string(),
    divisions: z.array(z.object({
      divisionName: z.string(),
      place: z.number().int().min(1).max(4),
    })),
  })),
});

export type SchoolResults = z.infer<typeof schoolResultsSchema>;
