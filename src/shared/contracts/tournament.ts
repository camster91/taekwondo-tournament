/**
 * Tournament-related API response contracts.
 * 
 * These schemas define the canonical shape of tournament summary and detail data
 * used across dashboard, detail pages, public registration, and list endpoints.
 */

import { z } from 'zod';

/**
 * Tournament lifecycle status.
 */
export const tournamentStatusSchema = z.enum([
  'draft',
  'registration',
  'in_progress',
  'completed',
]);

export type TournamentStatus = z.infer<typeof tournamentStatusSchema>;

/**
 * Minimal tournament summary used by list endpoints and dashboards.
 * 
 * Used by:
 * - GET /api/tournaments (authenticated list)
 * - GET /api/public/tournaments (open registration list)
 * - Dashboard aggregations
 */
export const apiTournamentSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: tournamentStatusSchema,
  date: z.string().datetime(),
  location: z.string().nullable().optional(),
  sportProfileSlug: z.string().default('taekwondo'),
  // Settings is a JSON string; most endpoints don't include it
  settings: z.string().nullable().optional(),
  // Counts are included when endpoints fetch _count relations
  _count: z.object({
    registrations: z.number().int().min(0).optional(),
    divisions: z.number().int().min(0).optional(),
  }).optional(),
  // Branding fields (resolved with org fallback in responses)
  brandName: z.string().nullable().optional(),
  brandPrimaryColor: z.string().nullable().optional(),
  brandLogoUrl: z.string().url().max(2048).nullable().optional(),
  // Public scoreboard controls
  publicSlug: z.string().length(16).nullable().optional(),
  publicScoreboardRefreshMs: z.number().int().min(1000).max(60000).nullable().optional(),
  // Capacity management (PR #267)
  maxCapacity: z.number().int().min(1).nullable().optional(),
  waitlistEnabled: z.boolean().default(false).optional(),
});

export type ApiTournamentSummary = z.infer<typeof apiTournamentSummarySchema>;

/**
 * Extended tournament detail response, used by:
 * - GET /api/tournaments/:id
 * - Detail pages that need rules, weight classes, or registration settings
 */
export const apiTournamentDetailSchema = apiTournamentSummarySchema.extend({
  organizationId: z.string().uuid().nullable().optional(),
  rules: z.string().nullable().optional(), // JSON string of tournament rules
  deletedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export type ApiTournamentDetail = z.infer<typeof apiTournamentDetailSchema>;

/**
 * Tournament summary array — standard list response.
 */
export const apiTournamentSummaryArraySchema = z.array(apiTournamentSummarySchema);
export type ApiTournamentSummaryArray = z.infer<typeof apiTournamentSummaryArraySchema>;
