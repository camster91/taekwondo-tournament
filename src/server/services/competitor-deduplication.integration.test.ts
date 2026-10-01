import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { mergeCompetitors } from './competitor-deduplication.js';

const databaseUrl = process.env.COMPETITOR_MERGE_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const organizationId = randomUUID();
const tournamentId = randomUUID();
let prisma: PrismaClient;

integration('mergeCompetitors against disposable Postgres', () => {
  let primaryId: string;
  let secondaryId: string;
  let opponentId: string;

  const competitor = (firstName: string) => prisma.competitor.create({ data: {
    organizationId, firstName, lastName: 'Merge', gender: 'M', dateOfBirth: new Date('2012-03-04T00:00:00Z'), belt: 'Blue',
  } });

  /** Division with a played 2-person bracket between the two registrations. */
  const playedDivision = async (name: string, reg1: string, reg2: string) => prisma.division.create({ data: {
    tournamentId, name, beltLevel: 'CB', gender: 'M', eventType: 'sparring', ageMin: 10, ageMax: 14,
    assignments: { create: [{ registrationId: reg1, seedPosition: 1 }, { registrationId: reg2, seedPosition: 2 }] },
    bracket: { create: { structure: '{}', format: 'single_elim', matches: { create: [{
      roundNumber: 1, matchNumber: 1, bracketType: 'winners', competitor1Id: reg1, competitor2Id: reg2, winnerId: reg2,
      score1: '1', score2: '5', status: 'completed',
    }] } } },
  }, include: { bracket: { include: { matches: true } } } });

  beforeAll(async () => {
    if (!/^postgresql:\/\/[^/]+@(localhost|127\.0\.0\.1)(:\d+)?\/[^?]*(?:_test|_e2e)(?:\?|$)/.test(databaseUrl!)) {
      throw new Error('COMPETITOR_MERGE_DATABASE_URL must target a local *_test or *_e2e database');
    }
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    await prisma.organization.create({ data: { id: organizationId, name: '[E2E] Merge', slug: `merge-${organizationId}` } });
    await prisma.tournament.create({ data: { id: tournamentId, organizationId, name: '[E2E] Merge Open', date: new Date('2030-01-01') } });
  });

  beforeEach(async () => {
    await prisma.division.deleteMany({ where: { tournamentId } });
    await prisma.competitor.deleteMany({ where: { organizationId } });
    primaryId = (await competitor('Primary')).id;
    secondaryId = (await competitor('Secondary')).id;
    opponentId = (await competitor('Opponent')).id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.division.deleteMany({ where: { tournamentId } });
    await prisma.tournament.deleteMany({ where: { id: tournamentId, organizationId } });
    await prisma.competitor.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  it('keeps played brackets intact when both are registered in the same tournament', async () => {
    const primaryReg = await prisma.registration.create({ data: { tournamentId, competitorId: primaryId, patterns: true } });
    const secondaryReg = await prisma.registration.create({ data: { tournamentId, competitorId: secondaryId, sparring: true } });
    const opponentReg = await prisma.registration.create({ data: { tournamentId, competitorId: opponentId, sparring: true } });
    const division = await playedDivision('Sparring', opponentReg.id, secondaryReg.id);

    const result = await mergeCompetitors(prisma, primaryId, secondaryId);
    expect(result.mergedRegistrations).toBe(1);

    const match = await prisma.match.findUniqueOrThrow({ where: { id: division.bracket!.matches[0].id } });
    expect(match).toMatchObject({ competitor1Id: opponentReg.id, competitor2Id: primaryReg.id, winnerId: primaryReg.id, status: 'completed' });
    const assignments = await prisma.divisionAssignment.findMany({ where: { divisionId: division.id }, orderBy: { seedPosition: 'asc' } });
    expect(assignments.map((a) => a.registrationId)).toEqual([opponentReg.id, primaryReg.id]);
    expect(await prisma.registration.findUnique({ where: { id: secondaryReg.id } })).toBeNull();
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: primaryReg.id } })).toMatchObject({ patterns: true, sparring: true });
  });

  it('refuses with 409 when both are in the same division, changing nothing', async () => {
    const primaryReg = await prisma.registration.create({ data: { tournamentId, competitorId: primaryId, sparring: true } });
    const secondaryReg = await prisma.registration.create({ data: { tournamentId, competitorId: secondaryId, sparring: true } });
    const division = await playedDivision('Head to head', primaryReg.id, secondaryReg.id);

    await expect(mergeCompetitors(prisma, primaryId, secondaryId)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('Head to head'),
    });

    expect(await prisma.registration.findUnique({ where: { id: secondaryReg.id } })).not.toBeNull();
    expect(await prisma.match.findUniqueOrThrow({ where: { id: division.bracket!.matches[0].id } }))
      .toMatchObject({ competitor1Id: primaryReg.id, competitor2Id: secondaryReg.id, winnerId: secondaryReg.id });
    expect(await prisma.competitor.findUniqueOrThrow({ where: { id: secondaryId } })).toMatchObject({ deletedAt: null });
  });
});
