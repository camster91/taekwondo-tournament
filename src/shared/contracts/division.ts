/**
 * Division-related API response contracts.
 * 
 * These schemas define the canonical shape of division data with embedded brackets
 * and matches, used by high-traffic endpoints like day-of operations, director
 * dashboard, and public scoreboard.
 */

import { z } from 'zod';
import { apiMatchSchema } from './match.js';

/**
 * Bracket format types supported by the system.
 */
export const bracketFormatSchema = z.enum([
  'double_elim',
  'single_elim',
  'round_robin',
  'pool_play',
]).nullable();

export type BracketFormat = z.infer<typeof bracketFormatSchema>;

/**
 * A bracket embedded in the division response.
 * Contains the match tree for one division.
 */
export const apiBracketSchema = z.object({
  id: z.string().uuid(),
  format: bracketFormatSchema,
  matches: z.array(apiMatchSchema),
});

export type ApiBracket = z.infer<typeof apiBracketSchema>;

/**
 * Division response schema with optional embedded bracket and matches.
 * 
 * Used by:
 * - GET /api/divisions/tournament/:tournamentId (with ?withMatches=true)
 * - GET /api/public/scoreboard/:publicSlug
 * - GET /api/tournaments/:id/day-of
 * 
 * This is a high-risk shape: incorrect includes break scorekeeper, director
 * dashboard, and public displays.
 */
export const apiDivisionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  eventType: z.string(),
  beltLevel: z.string().nullable().optional(),
  gender: z.string().nullable().optional(),
  ageMin: z.number().int().nullable().optional(),
  ageMax: z.number().int().nullable().optional(),
  weightClass: z.string().nullable().optional(),
  bracket: apiBracketSchema.nullable(),
  // displayOrder is used by schedule/ring assignment UI
  displayOrder: z.number().int().nullable().optional(),
  // Tournament context (when included)
  tournamentId: z.string().uuid().optional(),
});

export type ApiDivision = z.infer<typeof apiDivisionSchema>;

/**
 * Array of divisions — the standard list response shape.
 */
export const apiDivisionArraySchema = z.array(apiDivisionSchema);
export type ApiDivisionArray = z.infer<typeof apiDivisionArraySchema>;

/**
 * Extended division shape with assignment count, used by division
 * management endpoints that need to show competitor counts.
 */
export const apiDivisionWithCountSchema = apiDivisionSchema.extend({
  _count: z.object({
    assignments: z.number().int().min(0),
  }).optional(),
});

export type ApiDivisionWithCount = z.infer<typeof apiDivisionWithCountSchema>;
