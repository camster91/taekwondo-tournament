/**
 * Prisma query shape for the unauthenticated public scoreboard endpoints
 * (GET /api/public/scoreboard/:publicSlug and
 * GET /api/public/tournaments/:id/scoreboard).
 *
 * Match.competitor1/competitor2/winner are Registration rows, which carry
 * parent contact details, special-needs notes, weights, payment state and
 * the management-token hash. Everything here is an explicit `select` so
 * only display fields can ever leave the server; adding a column to
 * Registration or Competitor cannot leak it through these endpoints.
 *
 * Shared with src/server/contracts/public-scoreboard.contract.test.ts so the
 * contract test exercises the real query.
 */
import type { Prisma } from '@prisma/client';

const publicSlotSelect = {
  id: true,
  competitor: {
    select: { firstName: true, lastName: true, schoolDojang: true },
  },
} satisfies Prisma.RegistrationSelect;

export const publicScoreboardDivisionSelect = {
  id: true,
  tournamentId: true,
  name: true,
  eventType: true,
  beltLevel: true,
  gender: true,
  ageMin: true,
  ageMax: true,
  weightClass: true,
  divisionNumber: true,
  displayOrder: true,
  bracket: {
    select: {
      id: true,
      format: true,
      matches: {
        select: {
          id: true,
          matchNumber: true,
          roundNumber: true,
          bracketType: true,
          status: true,
          ringNumber: true,
          scheduledTime: true,
          score1: true,
          score2: true,
          winnerId: true,
          competitor1Id: true,
          competitor2Id: true,
          competitor1: { select: publicSlotSelect },
          competitor2: { select: publicSlotSelect },
          winner: { select: publicSlotSelect },
        },
        orderBy: { matchNumber: 'asc' },
      },
    },
  },
} satisfies Prisma.DivisionSelect;

export function publicScoreboardDivisionArgs(tournamentId: string) {
  return {
    where: { tournamentId, deletedAt: null },
    select: publicScoreboardDivisionSelect,
    orderBy: { displayOrder: 'asc' },
  } satisfies Prisma.DivisionFindManyArgs;
}

/**
 * Keys that must never appear anywhere in a public scoreboard payload.
 * Used by contract/regression tests.
 */
export const PUBLIC_SCOREBOARD_FORBIDDEN_KEYS = [
  'parentName',
  'parentEmail',
  'parentPhone',
  'specialNeeds',
  'weightAtRegistration',
  'checkInWeight',
  'weightLbs',
  'heightInches',
  'dateOfBirth',
  'managementTokenHash',
  'managementTokenExpiresAt',
  'paymentStatus',
  'paymentIntentId',
  'paymentAmountCents',
  'consentVersion',
  'guardianAttested',
  'parentEmailVerified',
  'competeWithOlder',
] as const;

/** Recursively collect every object key in a JSON-like value. */
export function collectKeys(value: unknown, keys: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
  } else if (value && typeof value === 'object' && !(value instanceof Date)) {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      collectKeys(child, keys);
    }
  }
  return keys;
}
