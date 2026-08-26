import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { undoScheduleCorrection } from './schedule-correction.js';

const databaseUrl = process.env.SCHEDULE_CORRECTION_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const organizationId = randomUUID();
const tournamentId = randomUUID();
const auditId = randomUUID();
let prisma: PrismaClient;

integration('schedule correction against disposable Postgres', () => {
  beforeAll(async () => {
    if (!/^postgresql:\/\/[^/]+@(localhost|127\.0\.0\.1)(:\d+)?\/[^?]*(?:_test|_e2e)(?:\?|$)/.test(databaseUrl!)) {
      throw new Error('SCHEDULE_CORRECTION_DATABASE_URL must target a local *_test or *_e2e database');
    }
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    await prisma.organization.create({ data: { id: organizationId, name: '[E2E] Schedule correction', slug: `schedule-correction-${organizationId}` } });
    await prisma.tournament.create({ data: { id: tournamentId, organizationId, name: '[E2E] Schedule correction', date: new Date('2030-01-01'), settings: '{"schedule":{"ringCount":2}}' } });
    await prisma.tournamentOperationAudit.create({ data: {
      id: auditId,
      operationKey: randomUUID(),
      tournamentId,
      operationType: 'schedule_regeneration',
      beforeState: '{"schedule":{"ringCount":1}}',
      afterState: '{"schedule":{"ringCount":2}}',
      impactSummary: '{}',
      reversible: true,
    } });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.tournament.deleteMany({ where: { id: tournamentId, organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  it('converges simultaneous undo retries on one successful restored state', async () => {
    await expect(Promise.all([
      undoScheduleCorrection(prisma, auditId, 'operator-a', new Date('2030-01-01T10:00:00Z'), tournamentId),
      undoScheduleCorrection(prisma, auditId, 'operator-b', new Date('2030-01-01T10:00:01Z'), tournamentId),
    ])).resolves.toEqual([undefined, undefined]);

    const [tournament, audit] = await Promise.all([
      prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } }),
      prisma.tournamentOperationAudit.findUniqueOrThrow({ where: { id: auditId } }),
    ]);
    expect(tournament.settings).toBe('{"schedule":{"ringCount":1}}');
    expect(audit.undoneAt).not.toBeNull();
  });
});
