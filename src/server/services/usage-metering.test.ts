import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { recordTournamentUsage } from './usage-metering.js';

/** In-memory table honouring the (organizationId, tournamentId) unique index. */
function mockPrisma() {
  const rows: Array<Record<string, unknown>> = [];
  const prisma = {
    registration: { count: vi.fn().mockResolvedValue(12) },
    organizationBillingSubscription: { findUnique: vi.fn().mockResolvedValue(null) },
    organizationUsageRecord: {
      create: vi.fn(),
      createMany: vi.fn(async ({ data, skipDuplicates }: { data: Array<Record<string, unknown>>; skipDuplicates?: boolean }) => {
        let count = 0;
        for (const row of data) {
          const dup = rows.some((r) => r.organizationId === row.organizationId && r.tournamentId === row.tournamentId);
          if (dup && !skipDuplicates) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
          if (!dup) { rows.push(row); count++; }
        }
        return { count };
      }),
    },
  };
  return { prisma: prisma as unknown as PrismaClient, rows, raw: prisma };
}

describe('recordTournamentUsage', () => {
  it('records a completed tournament once even when it is completed again', async () => {
    const { prisma, rows, raw } = mockPrisma();

    await recordTournamentUsage(prisma, 't-1', 'org-1');
    raw.registration.count.mockResolvedValue(15);
    await recordTournamentUsage(prisma, 't-1', 'org-1');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ organizationId: 'org-1', tournamentId: 't-1', competitorCount: 12 });
    expect(raw.organizationUsageRecord.create).not.toHaveBeenCalled();
    expect(raw.organizationUsageRecord.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
  });

  it('still records each distinct tournament', async () => {
    const { prisma, rows } = mockPrisma();

    await recordTournamentUsage(prisma, 't-1', 'org-1');
    await recordTournamentUsage(prisma, 't-2', 'org-1');

    expect(rows.map((r) => r.tournamentId)).toEqual(['t-1', 't-2']);
  });
});
