/**
 * Retention purge vs legal hold against a real Postgres: the relation
 * filters in retentionWhere (`tournament: { legalHoldAt: null }`,
 * `registrations: { none: ... }`) only prove themselves on a database.
 *
 * Opt-in: set RETENTION_DATABASE_URL to a disposable LOCAL database with
 * migrations applied. Fixture rows are soft-deleted in the year 2000 and
 * the cutoff is mid-2000, so no other data is old enough to be purged.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { purgeExpiredSoftDeletes, type RetentionDatabase } from './retention-policy.js';

const databaseUrl = process.env.RETENTION_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

const deletedAt = new Date('2000-01-01T00:00:00.000Z');
const cutoff = new Date('2000-06-01T00:00:00.000Z');
const ids = {
  tHeld: randomUUID(), tFree: randomUUID(),
  dHeld: randomUUID(), dFree: randomUUID(),
  iHeld: randomUUID(),
  cHeld: randomUUID(), cInHeldTournament: randomUUID(), cFree: randomUUID(),
};

integration('retention purge honours legal hold (Postgres)', () => {
  let prisma: PrismaClient;
  const runIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    const competitor = (id: string, extra: Record<string, unknown> = {}) => ({
      id, firstName: 'Retention', lastName: id.slice(0, 8), gender: 'M', belt: 'Blue',
      dateOfBirth: new Date('2012-01-01'), deletedAt, ...extra,
    });
    const division = (id: string, tournamentId: string) => ({
      id, tournamentId, name: 'Retention division', beltLevel: 'CB', gender: 'M',
      eventType: 'patterns', ageMin: 10, ageMax: 12, deletedAt,
    });
    await prisma.tournament.createMany({ data: [
      { id: ids.tHeld, name: '[retention] held', date: new Date('2000-01-01'), deletedAt, legalHoldAt: new Date(), legalHoldReason: 'test' },
      { id: ids.tFree, name: '[retention] free', date: new Date('2000-01-01'), deletedAt },
    ] });
    await prisma.division.createMany({ data: [division(ids.dHeld, ids.tHeld), division(ids.dFree, ids.tFree)] });
    await prisma.incident.create({ data: {
      id: ids.iHeld, tournamentId: ids.tHeld, type: 'medical', severity: 'minor', description: 'retention test', deletedAt,
    } });
    await prisma.competitor.createMany({ data: [
      competitor(ids.cHeld, { legalHoldAt: new Date(), legalHoldReason: 'test' }),
      competitor(ids.cInHeldTournament),
      competitor(ids.cFree),
    ] });
    await prisma.registration.create({ data: { tournamentId: ids.tHeld, competitorId: ids.cInHeldTournament } });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.tournament.deleteMany({ where: { id: { in: [ids.tHeld, ids.tFree] } } });
    await prisma.competitor.deleteMany({ where: { id: { in: [ids.cHeld, ids.cInHeldTournament, ids.cFree] } } });
    await prisma.retentionPurgeRun.deleteMany({ where: { id: { in: runIds } } });
    await prisma.$disconnect();
  });

  const exists = async () => ({
    tHeld: !!(await prisma.tournament.findUnique({ where: { id: ids.tHeld } })),
    tFree: !!(await prisma.tournament.findUnique({ where: { id: ids.tFree } })),
    dHeld: !!(await prisma.division.findUnique({ where: { id: ids.dHeld } })),
    dFree: !!(await prisma.division.findUnique({ where: { id: ids.dFree } })),
    iHeld: !!(await prisma.incident.findUnique({ where: { id: ids.iHeld } })),
    cHeld: !!(await prisma.competitor.findUnique({ where: { id: ids.cHeld } })),
    cInHeldTournament: !!(await prisma.competitor.findUnique({ where: { id: ids.cInHeldTournament } })),
    cFree: !!(await prisma.competitor.findUnique({ where: { id: ids.cFree } })),
  });

  it('dry run deletes nothing and records the run', async () => {
    const before = await prisma.retentionPurgeRun.count();
    const result = await purgeExpiredSoftDeletes(prisma as unknown as RetentionDatabase, cutoff, { dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.tournaments).toBeGreaterThanOrEqual(1);
    expect(Object.values(await exists()).every(Boolean)).toBe(true);
    const runs = await prisma.retentionPurgeRun.findMany({ where: { cutoff }, orderBy: { createdAt: 'desc' }, take: 1 });
    runIds.push(...runs.map((r) => r.id));
    expect(await prisma.retentionPurgeRun.count()).toBe(before + 1);
    expect(runs[0]).toMatchObject({ dryRun: true });
  });

  it('purges unheld records and keeps held ones and everything tied to a held tournament', async () => {
    await purgeExpiredSoftDeletes(prisma as unknown as RetentionDatabase, cutoff);
    expect(await exists()).toEqual({
      tHeld: true, tFree: false,
      dHeld: true, dFree: false,
      iHeld: true,
      cHeld: true, cInHeldTournament: true, cFree: false,
    });
    expect(await prisma.registration.count({ where: { competitorId: ids.cInHeldTournament } })).toBe(1);
    const runs = await prisma.retentionPurgeRun.findMany({ where: { cutoff, dryRun: false } });
    runIds.push(...runs.map((r) => r.id));
    expect(runs).toHaveLength(1);
  });
});
