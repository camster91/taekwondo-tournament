import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  applyBracketCorrection,
  bracketCorrectionVersion,
  buildProposedBracketCorrection,
  loadBracketCorrectionSnapshot,
  proposedBracketVersion,
  undoBracketCorrection,
} from './bracket-correction.js';

const databaseUrl = process.env.BRACKET_CORRECTION_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const organizationId = randomUUID();
const tournamentId = randomUUID();
const divisionId = randomUUID();
const competitorIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
let prisma: PrismaClient;

integration('bracket correction against disposable Postgres', () => {
  beforeAll(async () => {
    if (!/^postgresql:\/\/[^/]+@(localhost|127\.0\.0\.1)(:\d+)?\/[^?]*(?:_test|_e2e)(?:\?|$)/.test(databaseUrl!)) {
      throw new Error('BRACKET_CORRECTION_DATABASE_URL must target a local *_test or *_e2e database');
    }
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    await prisma.organization.create({ data: { id: organizationId, name: '[E2E] Bracket correction', slug: `bracket-correction-${organizationId}` } });
    await prisma.competitor.createMany({ data: competitorIds.map((id, index) => ({
      id, firstName: `Athlete ${index + 1}`, lastName: 'Correction', gender: index % 2 ? 'F' : 'M',
      dateOfBirth: new Date('2010-01-01'), belt: 'Blue', schoolDojang: `School ${index + 1}`,
    })) });
    await prisma.tournament.create({ data: {
      id: tournamentId, organizationId, name: '[E2E] Bracket correction', date: new Date('2030-01-01'),
      registrations: { create: competitorIds.map((competitorId) => ({ competitorId, sparring: true })) },
    } });
    const registrations = await prisma.registration.findMany({ where: { tournamentId }, orderBy: { competitorId: 'asc' } });
    await prisma.division.create({ data: {
      id: divisionId, tournamentId, name: '[E2E] Junior Sparring', beltLevel: 'CB', gender: 'M', eventType: 'sparring', ageMin: 10, ageMax: 18,
      assignments: { create: registrations.map((registration, index) => ({ registrationId: registration.id, seedPosition: index + 1 })) },
    } });
    const empty = await loadBracketCorrectionSnapshot(prisma, divisionId);
    const initial = buildProposedBracketCorrection(empty, { format: 'double_elim', seedingStrategy: 'school_spread' });
    const bracket = await prisma.bracket.create({ data: { divisionId, format: initial.format, structure: JSON.stringify(initial.structure) } });
    await prisma.match.createMany({ data: initial.matches.map((match) => ({ ...match, bracketId: bracket.id })) });
    const firstMatch = await prisma.match.findFirstOrThrow({ where: { bracketId: bracket.id }, orderBy: { matchNumber: 'asc' } });
    await prisma.matchAuditLog.create({ data: { matchId: firstMatch.id, action: 'seed', previousState: '{}', newState: '{}' } });
    await prisma.matchupHistory.create({ data: {
      competitor1Id: registrations[0].id, competitor2Id: registrations[1].id, tournamentId, divisionId,
      matchId: firstMatch.id, eventType: 'sparring', roundNumber: 1,
    } });
  });

  afterAll(async () => {
    if (!prisma) return;
    const matchIds = (await prisma.match.findMany({ where: { bracket: { division: { tournamentId } } }, select: { id: true } })).map((match) => match.id);
    await prisma.matchAuditLog.deleteMany({ where: { matchId: { in: matchIds } } });
    await prisma.matchupHistory.deleteMany({ where: { tournamentId } });
    await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
    await prisma.bracket.deleteMany({ where: { division: { tournamentId } } });
    await prisma.tournament.deleteMany({ where: { id: tournamentId, organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.competitor.deleteMany({ where: { id: { in: competitorIds } } });
    await prisma.$disconnect();
  });

  it('rolls back every destructive write on BYE initialization failure, then restores an applied correction exactly', async () => {
    const before = await loadBracketCorrectionSnapshot(prisma, divisionId);
    const config = { format: 'single_elim' as const, seedingStrategy: 'school_spread' as const };
    const proposed = buildProposedBracketCorrection(before, config);
    const input = {
      tournamentId, divisionId, config, expectedInputVersion: bracketCorrectionVersion(before),
      expectedResultVersion: proposedBracketVersion(proposed), operationKey: randomUUID(), approvedBy: 'integration-director',
    };
    await expect(applyBracketCorrection(prisma, input, { initializeByes: async () => { throw new Error('forced BYE failure'); } })).rejects.toThrow('forced BYE failure');
    expect(await loadBracketCorrectionSnapshot(prisma, divisionId)).toEqual(before);
    await expect(prisma.tournamentOperationAudit.count({ where: { tournamentId, operationType: 'bracket_reseed' } })).resolves.toBe(0);

    const applied = await applyBracketCorrection(prisma, { ...input, operationKey: randomUUID() });
    expect(applied.alreadyApplied).toBe(false);
    expect(await prisma.matchAuditLog.count({ where: { matchId: { in: before.bracket!.matches.map((match) => match.id!) } } })).toBe(0);
    expect(await prisma.matchupHistory.count({ where: { matchId: { in: before.bracket!.matches.map((match) => match.id!) } } })).toBe(0);

    await undoBracketCorrection(prisma, tournamentId, divisionId, applied.auditId, 'integration-director');
    const restored = await loadBracketCorrectionSnapshot(prisma, divisionId);
    expect(restored.bracket?.id).toBe(before.bracket?.id);
    expect(restored.bracket?.matches.map((match) => match.id)).toEqual(before.bracket?.matches.map((match) => match.id));
    expect(restored.matchAuditRows).toEqual(before.matchAuditRows);
    expect(restored.matchupHistoryRows).toEqual(before.matchupHistoryRows);
  });
});
