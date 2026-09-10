/**
 * Match-related API response contracts.
 * 
 * These schemas define the canonical shape of match data returned by the API,
 * used by public scoreboard, scorekeeper, director dashboard, and bracket endpoints.
 */

import { z } from 'zod';

/**
 * Match status state machine: pending → ready → in_progress → completed.
 * Byes skip to completed immediately.
 */
export const matchStatusSchema = z.enum(['pending', 'ready', 'in_progress', 'completed', 'bye']);
export type MatchStatus = z.infer<typeof matchStatusSchema>;

/**
 * Match bracket type categorization.
 */
export const bracketTypeSchema = z.enum(['winners', 'losers', 'finals']);
export type BracketType = z.infer<typeof bracketTypeSchema>;

/**
 * A competitor slot within a match — either populated with a competitor
 * or null when TBD (advancement not yet determined).
 */
export const matchCompetitorSlotSchema = z.object({
  id: z.string().uuid(),
  competitor: z.object({
    firstName: z.string(),
    lastName: z.string(),
    schoolDojang: z.string().nullable().optional(),
  }),
}).nullable();

export type MatchCompetitorSlot = z.infer<typeof matchCompetitorSlotSchema>;

/**
 * Full match response schema used by scorekeeper, public scoreboard,
 * director dashboard, and bracket endpoints.
 * 
 * This is the single source of truth for match shapes across the API.
 */
export const apiMatchSchema = z.object({
  id: z.string().uuid(),
  matchNumber: z.number().int().min(1),
  roundNumber: z.number().int().min(1),
  bracketType: bracketTypeSchema,
  status: matchStatusSchema,
  ringNumber: z.number().int().min(1).nullable().optional(),
  competitor1: matchCompetitorSlotSchema,
  competitor2: matchCompetitorSlotSchema,
  winner: matchCompetitorSlotSchema,
  score1: z.string().nullable().optional(),
  score2: z.string().nullable().optional(),
  startedAt: z.string().datetime().nullable().optional(),
  updatedAt: z.string().datetime().nullable().optional(),
  videoUrl: z.string().url().max(2048).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  // Internal client-side helpers used by DirectorDashboard after flatMap.
  // Not returned by server; marked optional for backward compat.
  _divisionId: z.string().uuid().optional(),
  _divisionName: z.string().optional(),
});

export type ApiMatch = z.infer<typeof apiMatchSchema>;

/**
 * Array of matches — used by /api/divisions/tournament/:id?withMatches=true
 * and public scoreboard feed.
 */
export const apiMatchArraySchema = z.array(apiMatchSchema);
export type ApiMatchArray = z.infer<typeof apiMatchArraySchema>;
