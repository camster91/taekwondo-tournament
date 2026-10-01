import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { backupDivisionState, getBackup, restoreDivisionState, restoreSavedDivisionBackup, saveBackup, type TournamentBackup } from './backup-recovery.js';

const databaseUrl = process.env.BACKUP_RECOVERY_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const organizationId = randomUUID();
const tournamentId = randomUUID();
const currentDivisionId = randomUUID();
let prisma: PrismaClient;

integration('division backup recovery against disposable Postgres', () => {
  beforeAll(async () => {
    if (!/^postgresql:\/\/[^/]+@(localhost|127\.0\.0\.1)(:\d+)?\/[^?]*(?:_test|_e2e)(?:\?|$)/.test(databaseUrl!)) {
      throw new Error('BACKUP_RECOVERY_DATABASE_URL must target a local *_test or *_e2e database');
    }
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    await prisma.organization.create({ data: { id: organizationId, name: '[E2E] Backup recovery', slug: `backup-recovery-${organizationId}` } });
    await prisma.tournament.create({ data: { id: tournamentId, organizationId, name: '[E2E] Backup recovery', date: new Date('2030-01-01') } });
  });

  beforeEach(async () => {
    await prisma.backupState.deleteMany({ where: { tournamentId } });
    await prisma.division.deleteMany({ where: { tournamentId } });
    await prisma.division.create({ data: {
      id: currentDivisionId, tournamentId, name: 'Current safe division', beltLevel: 'Black', gender: 'mixed', eventType: 'patterns', ageMin: 10, ageMax: 40, divisionNumber: 1,
    } });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.tournament.deleteMany({ where: { id: tournamentId, organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  it('rolls back the entire restore when any backed-up division cannot be recreated', async () => {
    const duplicateId = randomUUID();
    const division = (name: string) => ({
      id: duplicateId, name, beltLevel: 'Black', gender: 'mixed', eventType: 'patterns', ageMin: 10, ageMax: 40,
      beltColors: null, danMin: null, danMax: null, weightClass: null, divisionNumber: 1,
      isSpecialNeeds: false, displayOrder: null, assignments: [],
    });
    const backup: TournamentBackup = {
      tournamentId,
      timestamp: new Date(),
      divisions: [division('First restored division'), division('Duplicate division that must fail')],
    };

    await expect(restoreDivisionState(prisma, backup)).rejects.toThrow();
    const divisions = await prisma.division.findMany({ where: { tournamentId }, select: { id: true, name: true } });
    expect(divisions).toEqual([{ id: currentDivisionId, name: 'Current safe division' }]);
  });

  it('retains the saved recovery artifact when an atomic restore fails', async () => {
    const duplicateId = randomUUID();
    const backedUpDivision = (name: string) => ({
      id: duplicateId, name, beltLevel: 'Black', gender: 'mixed', eventType: 'patterns', ageMin: 10, ageMax: 40,
      beltColors: null, danMin: null, danMax: null, weightClass: null, divisionNumber: 1,
      isSpecialNeeds: false, displayOrder: null, assignments: [],
    });
    const backup: TournamentBackup = {
      tournamentId,
      timestamp: new Date(),
      divisions: [backedUpDivision('Valid first row'), backedUpDivision('Invalid duplicate row')],
    };
    await saveBackup(prisma, backup);

    await expect(restoreSavedDivisionBackup(prisma, tournamentId)).rejects.toThrow();
    expect(await getBackup(prisma, tournamentId)).toMatchObject({ tournamentId, divisions: backup.divisions });
  });

  it('rolls back and retains the artifact when an assignment cannot be recreated', async () => {
    const backup: TournamentBackup = {
      tournamentId, timestamp: new Date(), divisions: [{
        id: randomUUID(), name: 'Assignment failure', beltLevel: 'Black', gender: 'mixed', eventType: 'patterns', ageMin: 10, ageMax: 40,
        beltColors: null, danMin: null, danMax: null, weightClass: null, divisionNumber: 1, isSpecialNeeds: false, displayOrder: null,
        assignments: [{ registrationId: randomUUID(), seedPosition: null, manualOverride: false }],
      }],
    };
    await saveBackup(prisma, backup);
    await expect(restoreSavedDivisionBackup(prisma, tournamentId)).rejects.toThrow();
    expect(await prisma.division.findMany({ where: { tournamentId }, select: { id: true } })).toEqual([{ id: currentDivisionId }]);
    expect(await getBackup(prisma, tournamentId)).toBeDefined();
  });

  it('rolls back and retains the artifact when a bracket cannot be recreated', async () => {
    const bracketId = randomUUID();
    const division = (name: string) => ({
      id: randomUUID(), name, beltLevel: 'Black', gender: 'mixed', eventType: 'patterns', ageMin: 10, ageMax: 40,
      beltColors: null, danMin: null, danMax: null, weightClass: null, divisionNumber: 1, isSpecialNeeds: false, displayOrder: null,
      assignments: [], bracket: { id: bracketId, structure: '{}', format: 'double_elim', matches: [] },
    });
    const backup: TournamentBackup = { tournamentId, timestamp: new Date(), divisions: [division('First bracket'), division('Duplicate bracket')] };
    await saveBackup(prisma, backup);
    await expect(restoreSavedDivisionBackup(prisma, tournamentId)).rejects.toThrow();
    expect(await prisma.division.findMany({ where: { tournamentId }, select: { id: true } })).toEqual([{ id: currentDivisionId }]);
    expect(await getBackup(prisma, tournamentId)).toBeDefined();
  });

  it('clears the artifact after a complete successful restore', async () => {
    const restoredId = randomUUID();
    const backup: TournamentBackup = { tournamentId, timestamp: new Date(), divisions: [{
      id: restoredId, name: 'Restored safely', beltLevel: 'Black', gender: 'mixed', eventType: 'patterns', ageMin: 10, ageMax: 40,
      beltColors: null, danMin: null, danMax: null, weightClass: null, divisionNumber: 1, isSpecialNeeds: false, displayOrder: null, assignments: [],
    }] };
    await saveBackup(prisma, backup);
    await expect(restoreSavedDivisionBackup(prisma, tournamentId)).resolves.toMatchObject({ restored: 1, errors: [] });
    expect(await getBackup(prisma, tournamentId)).toBeUndefined();
    expect(await prisma.division.findMany({ where: { tournamentId }, select: { id: true } })).toEqual([{ id: restoredId }]);
  });

  it('round-trips brackets with match results, format and division fields', async () => {
    const competitorIds = [randomUUID(), randomUUID()];
    const registrationIds = [randomUUID(), randomUUID()];
    for (const [i, id] of competitorIds.entries()) {
      await prisma.competitor.create({ data: {
        id, organizationId, firstName: `Backup${i}`, lastName: 'Fighter', gender: 'M', dateOfBirth: new Date('2012-01-01'), belt: 'Black',
      } });
      await prisma.registration.create({ data: { id: registrationIds[i], tournamentId, competitorId: id, sparring: true } });
    }
    try {
      const divisionId = randomUUID();
      const bracketId = randomUUID();
      const matchId = randomUUID();
      const deletedDivisionId = randomUUID();
      await prisma.division.create({ data: {
        id: divisionId, tournamentId, name: 'Scored division', beltLevel: 'BB', gender: 'M', eventType: 'sparring', ageMin: 10, ageMax: 14,
        bracketDifficulty: 0.7, matchupQuality: 0.8, avgSkillRating: 1234,
        assignments: { create: registrationIds.map((registrationId, i) => ({ registrationId, seedPosition: i + 1 })) },
        bracket: { create: { id: bracketId, structure: '{"winners":[]}', format: 'single_elim', matches: { create: [{
          id: matchId, roundNumber: 1, matchNumber: 1, bracketType: 'winners',
          competitor1Id: registrationIds[0], competitor2Id: registrationIds[1], winnerId: registrationIds[1],
          score1: '3', score2: '7', status: 'completed', ringNumber: 2, notes: 'kept',
        }] } } },
      } });
      await prisma.division.create({ data: {
        id: deletedDivisionId, tournamentId, name: 'Trashed division', beltLevel: 'BB', gender: 'F', eventType: 'patterns', ageMin: 10, ageMax: 14,
        deletedAt: new Date('2030-01-02T00:00:00Z'),
      } });

      // Same path as the forced clear-all: back up, persist, delete.
      await saveBackup(prisma, await backupDivisionState(prisma, tournamentId));
      await prisma.division.deleteMany({ where: { tournamentId } });
      expect(await prisma.match.count({ where: { id: matchId } })).toBe(0);

      await expect(restoreSavedDivisionBackup(prisma, tournamentId)).resolves.toMatchObject({ restored: 3, errors: [] });

      const division = await prisma.division.findUniqueOrThrow({
        where: { id: divisionId },
        include: { assignments: true, bracket: { include: { matches: true } } },
      });
      expect(division).toMatchObject({ bracketDifficulty: 0.7, matchupQuality: 0.8, avgSkillRating: 1234, deletedAt: null });
      expect(division.assignments.map((a) => a.seedPosition).sort()).toEqual([1, 2]);
      expect(division.bracket).toMatchObject({ id: bracketId, format: 'single_elim', structure: '{"winners":[]}' });
      expect(division.bracket!.matches).toEqual([expect.objectContaining({
        id: matchId, winnerId: registrationIds[1], score1: '3', score2: '7', status: 'completed', ringNumber: 2, notes: 'kept',
      })]);
      const trashed = await prisma.division.findUniqueOrThrow({ where: { id: deletedDivisionId } });
      expect(trashed.deletedAt?.toISOString()).toBe('2030-01-02T00:00:00.000Z');
    } finally {
      await prisma.division.deleteMany({ where: { tournamentId } });
      await prisma.competitor.deleteMany({ where: { id: { in: competitorIds } } });
    }
  });

  it('restores a legacy (v1) backup without recreating a bracket that has no match data', async () => {
    const divisionId = randomUUID();
    const backup: TournamentBackup = { tournamentId, timestamp: new Date(), divisions: [{
      id: divisionId, name: 'Legacy division', beltLevel: 'Black', gender: 'mixed', eventType: 'patterns', ageMin: 10, ageMax: 40,
      beltColors: null, danMin: null, danMax: null, weightClass: null, divisionNumber: 1, isSpecialNeeds: false, displayOrder: null,
      assignments: [], bracket: { id: randomUUID(), structure: '{}' },
    }] };
    await saveBackup(prisma, backup);
    const result = await restoreSavedDivisionBackup(prisma, tournamentId);
    expect(result?.restored).toBe(1);
    expect(result?.errors).toEqual([expect.stringContaining('Legacy division')]);
    expect(await prisma.division.findUnique({ where: { id: divisionId }, include: { bracket: true } })).toMatchObject({ bracket: null });
  });

  it('throws (so destructive callers abort) when the backup cannot be saved', async () => {
    const failingPrisma = prisma.$extends({ query: { backupState: { upsert: async () => { throw new Error('disk full'); } } } });
    await expect(saveBackup(failingPrisma as unknown as PrismaClient, { tournamentId, timestamp: new Date(), divisions: [] }))
      .rejects.toThrow('Could not save a recovery backup');
  });

  it('does not report success when the restored artifact cannot be cleared', async () => {
    const backup: TournamentBackup = { tournamentId, timestamp: new Date(), divisions: [] };
    await saveBackup(prisma, backup);
    const deleteFailure = new Error('simulated backup clearance failure');
    const failingPrisma = prisma.$extends({ query: { backupState: { delete: async () => { throw deleteFailure; } } } });
    await expect(restoreSavedDivisionBackup(failingPrisma as unknown as PrismaClient, tournamentId)).rejects.toThrow(deleteFailure.message);
    expect(await getBackup(prisma, tournamentId)).toBeDefined();
  });
});
