import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';

/**
 * Legal hold (#121). A held record is never hard-deleted: not by the
 * retention purge (see retentionWhere) and not by the manual hard-delete
 * endpoints. A hold on a tournament also protects every competitor
 * registered in it, because deleting a competitor cascades to its
 * registrations.
 */
export const legalHoldSchema = z.object({
  hold: z.boolean(),
  reason: z.string().trim().min(1).max(500).optional(),
}).refine((body) => !body.hold || Boolean(body.reason), {
  message: 'A reason is required when placing a legal hold',
  path: ['reason'],
});

export type LegalHoldBody = z.infer<typeof legalHoldSchema>;

export function legalHoldData(body: LegalHoldBody, now: Date = new Date()) {
  return body.hold
    ? { legalHoldAt: now, legalHoldReason: body.reason ?? null }
    : { legalHoldAt: null, legalHoldReason: null };
}

/** True if the competitor, or any tournament it is registered in, is held. */
export async function competitorIsHeld(prisma: Pick<PrismaClient, 'competitor'>, competitorId: string): Promise<boolean> {
  const held = await prisma.competitor.findFirst({
    where: {
      id: competitorId,
      OR: [
        { legalHoldAt: { not: null } },
        { registrations: { some: { tournament: { legalHoldAt: { not: null } } } } },
      ],
    },
    select: { id: true },
  });
  return held !== null;
}
