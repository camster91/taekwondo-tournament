/**
 * Public scoreboard API response contract.
 * 
 * This is the highest-risk API shape in the system: it feeds the public
 * scoreboard display that thousands of parents/spectators watch during
 * live tournaments. Any drift between server include shape and this schema
 * causes blank screens or stale data.
 * 
 * Contract tests in public-scoreboard.contract.test.ts verify this shape
 * matches what Prisma includes actually return.
 */

import { z } from 'zod';
import { apiDivisionSchema } from './division.js';

/**
 * Public scoreboard feed response.
 * 
 * Used by:
 * - GET /api/public/scoreboard/:publicSlug
 * - GET /api/public/tournaments/:id/scoreboard (legacy UUID-based)
 * 
 * Returns divisions with embedded brackets and matches. The client polls
 * this endpoint every N seconds (controlled by publicScoreboardRefreshMs).
 */
export const publicScoreboardResponseSchema = z.array(apiDivisionSchema);

export type PublicScoreboardResponse = z.infer<typeof publicScoreboardResponseSchema>;

/**
 * Validates that a Prisma query result matches the public scoreboard contract.
 * 
 * Used in contract tests to catch drift between Prisma includes and the
 * documented response shape.
 * 
 * @throws ZodError if the shape doesn't match
 */
export function validatePublicScoreboardResponse(data: unknown): PublicScoreboardResponse {
  return publicScoreboardResponseSchema.parse(data);
}
