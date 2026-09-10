/**
 * Day-of operations API response contracts.
 * 
 * Used by the director dashboard live control room during active tournaments.
 * Shows real-time ring status, division progress, warnings, and match states.
 */

import { z } from 'zod';
import { apiDivisionSchema } from './division.js';
import { matchStatusSchema } from './match.js';

/**
 * Ring status summary for director dashboard.
 */
export const ringStatusSchema = z.object({
  ringNumber: z.number().int().min(1),
  currentMatchId: z.string().uuid().nullable(),
  currentDivisionId: z.string().uuid().nullable(),
  currentDivisionName: z.string().nullable(),
  status: z.enum(['idle', 'active', 'delayed', 'blocked']),
  matchesCompleted: z.number().int().min(0),
  matchesRemaining: z.number().int().min(0),
  estimatedCompletionMs: z.number().int().nullable(),
});

export type RingStatus = z.infer<typeof ringStatusSchema>;

/**
 * Division progress summary for day-of operations.
 */
export const divisionProgressSchema = z.object({
  divisionId: z.string().uuid(),
  divisionName: z.string(),
  totalMatches: z.number().int().min(0),
  completedMatches: z.number().int().min(0),
  inProgressMatches: z.number().int().min(0),
  pendingMatches: z.number().int().min(0),
  percentComplete: z.number().min(0).max(100),
  assignedRing: z.number().int().min(1).nullable(),
  isComplete: z.boolean(),
});

export type DivisionProgress = z.infer<typeof divisionProgressSchema>;

/**
 * Day-of warning/alert for director attention.
 */
export const dayOfWarningSchema = z.object({
  id: z.string(),
  severity: z.enum(['info', 'warning', 'critical']),
  category: z.enum(['ring', 'division', 'competitor', 'schedule', 'other']),
  message: z.string(),
  divisionId: z.string().uuid().nullable(),
  ringNumber: z.number().int().nullable(),
  timestamp: z.string().datetime(),
});

export type DayOfWarning = z.infer<typeof dayOfWarningSchema>;

/**
 * Full day-of operations response.
 * 
 * Used by:
 * - GET /api/tournaments/:id/day-of
 * - Director dashboard live control room
 * 
 * Includes divisions with matches, ring status, progress tracking, and warnings.
 */
export const dayOfOperationsResponseSchema = z.object({
  divisions: z.array(apiDivisionSchema),
  ringStatus: z.array(ringStatusSchema),
  divisionProgress: z.array(divisionProgressSchema),
  warnings: z.array(dayOfWarningSchema),
  tournamentStatus: z.enum(['draft', 'registration', 'in_progress', 'completed']),
  totalMatches: z.number().int().min(0),
  completedMatches: z.number().int().min(0),
  activeRings: z.number().int().min(0),
});

export type DayOfOperationsResponse = z.infer<typeof dayOfOperationsResponseSchema>;
