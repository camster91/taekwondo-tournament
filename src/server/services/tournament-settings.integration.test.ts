import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { saveTournamentSettingsAtomic, type TournamentWeightClassInput } from './tournament-settings.js';

const databaseUrl = process.env.ATOMIC_SETTINGS_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const organizationId = randomUUID();
const tournamentId = randomUUID();
let prisma: PrismaClient;

integration('atomic tournament settings against disposable Postgres', () => {
  beforeAll(async () => {
    if (!/^postgresql:\/\/[^/]+@(localhost|127\.0\.0\.1)(:\d+)?\/[^?]*(?:_test|_e2e)(?:\?|$)/.test(databaseUrl!)) {
      throw new Error('ATOMIC_SETTINGS_DATABASE_URL must target a local *_test or *_e2e database');
    }
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    await prisma.organization.create({ data: { id: organizationId, name: '[E2E] Atomic settings', slug: `atomic-settings-${organizationId}` } });
    await prisma.tournament.create({ data: { id: tournamentId, organizationId, name: '[E2E] Atomic settings', date: new Date('2030-01-01'), settings: JSON.stringify({ rings: 2 }) } });
    await prisma.weightClass.create({ data: { tournamentId, name: 'Existing class', displayOrder: 0 } });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.tournament.deleteMany({ where: { id: tournamentId, organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  it('rolls back the settings update and class deletion when replacement fails', async () => {
    const invalidClasses = [{ name: undefined }] as unknown as TournamentWeightClassInput[];
    await expect(saveTournamentSettingsAtomic(prisma, tournamentId, { rings: 8 }, invalidClasses)).rejects.toThrow();
    const tournament = await prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    const classes = await prisma.weightClass.findMany({ where: { tournamentId } });
    expect(JSON.parse(tournament.settings!)).toEqual({ rings: 2 });
    expect(classes.map((weightClass) => weightClass.name)).toEqual(['Existing class']);
  });

  it('commits settings and an empty replacement together', async () => {
    await saveTournamentSettingsAtomic(prisma, tournamentId, { rings: 4 }, []);
    const tournament = await prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    expect(JSON.parse(tournament.settings!)).toEqual({ rings: 4 });
    await expect(prisma.weightClass.count({ where: { tournamentId } })).resolves.toBe(0);
  });
});
