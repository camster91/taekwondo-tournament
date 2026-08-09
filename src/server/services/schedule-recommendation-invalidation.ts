import type { Prisma, PrismaClient } from '@prisma/client';

type Database = PrismaClient | Prisma.TransactionClient;

export async function invalidateScheduleRecommendations(db: Database, tournamentId: string, now = new Date()) {
  return db.recommendation.updateMany({
    where: { tournamentId, recommendationType: 'schedule_optimization_v1', status: { in: ['proposed', 'approved'] } },
    data: {
      status: 'rejected', rejectedBy: 'system:schedule-input-change', rejectedAt: now,
      rejectionReason: 'Schedule inputs changed; generate a fresh proposal.', approvedBy: null, approvedAt: null,
    },
  });
}
