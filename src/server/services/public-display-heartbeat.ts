import type { PrismaClient } from '@prisma/client';

export async function recordPublicDisplayHeartbeat(
  prisma: Pick<PrismaClient, 'publicDisplayHeartbeat'>,
  tournamentId: string,
  now = new Date(),
): Promise<{ lastSeenAt: string }> {
  const heartbeat = await prisma.publicDisplayHeartbeat.upsert({
    where: { tournamentId },
    create: { tournamentId, lastSeenAt: now },
    update: { lastSeenAt: now },
    select: { lastSeenAt: true },
  });
  return { lastSeenAt: heartbeat.lastSeenAt.toISOString() };
}
