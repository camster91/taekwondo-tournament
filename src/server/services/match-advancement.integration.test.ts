// Postgres-backed checks for the advancement engine's DB layer: the
// bracket row lock, BYE resolution through the root client and through
// a transaction client, concurrent sibling results, and conflict
// rollback. Opt-in: set BRACKET_ADVANCEMENT_DATABASE_URL to a local
// *_test / *_e2e database with migrations applied.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { generateBracket, type BracketStructure } from './bracket-generator.js';
import {
  BracketAdvancementConflictError,
  getBracketPlacements,
  handleByeMatches,
  lockBracket,
  syncBracketAdvancement,
} from './match-advancement.js';

const databaseUrl = process.env.BRACKET_ADVANCEMENT_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const tournamentId = randomUUID();
const competitorIds = Array.from({ length: 5 }, () => randomUUID());
let prisma: PrismaClient;
let registrationIds: string[] = [];

async function createBracket(structure: BracketStructure): Promise<string> {
  const divisionId = randomUUID();
  await prisma.division.create({ data: {
    id: divisionId, tournamentId, name: `[TEST] ${divisionId}`, beltLevel: 'CB', gender: 'M',
    eventType: 'sparring', ageMin: 10, ageMax: 18,
  } });
  const bracket = await prisma.bracket.create({
    data: { divisionId, structure: JSON.stringify(structure), format: 'double_elim' },
  });
  const all = [
    ...structure.winners.map((m) => ({ ...m, bracketType: 'winners' })),
    ...structure.losers.map((m) => ({ ...m, bracketType: 'losers' })),
    ...structure.finals.map((m) => ({ ...m, bracketType: 'finals' })),
  ];
  await prisma.match.createMany({ data: all.map((m) => ({
    bracketId: bracket.id,
    roundNumber: m.round,
    matchNumber: m.matchNumber,
    bracketType: m.bracketType,
    competitor1Id: m.competitor1Id,
    competitor2Id: m.competitor2Id,
    status: m.competitor1Id && m.competitor2Id ? 'ready' : 'pending',
  })) });
  return bracket.id;
}

/** What PUT /match/:id does: lock, write the result, reconcile — one transaction. */
async function recordResult(bracketId: string, matchNumber: number, pick: 'c1' | 'c2') {
  return prisma.$transaction(async (tx) => {
    await lockBracket(tx, bracketId);
    const m = await tx.match.findFirstOrThrow({ where: { bracketId, matchNumber } });
    await tx.match.update({
      where: { id: m.id },
      data: { status: 'completed', winnerId: pick === 'c1' ? m.competitor1Id : m.competitor2Id },
    });
    return syncBracketAdvancement(tx, bracketId);
  });
}

integration('match advancement against Postgres', () => {
  beforeAll(async () => {
    if (!/^postgresql:\/\/[^/]+@(localhost|127\.0\.0\.1)(:\d+)?\/[^?]*(?:_test|_e2e)(?:\?|$)/.test(databaseUrl!)) {
      throw new Error('BRACKET_ADVANCEMENT_DATABASE_URL must target a local *_test or *_e2e database');
    }
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    await prisma.competitor.createMany({ data: competitorIds.map((id, index) => ({
      id, firstName: `Athlete ${index + 1}`, lastName: 'Advancement', gender: 'M',
      dateOfBirth: new Date('2010-01-01'), belt: 'Blue', schoolDojang: `School ${index + 1}`,
    })) });
    await prisma.tournament.create({ data: {
      id: tournamentId, name: '[TEST] Advancement', date: new Date('2030-01-01'),
      registrations: { create: competitorIds.map((competitorId) => ({ competitorId, sparring: true })) },
    } });
    const regs = await prisma.registration.findMany({ where: { tournamentId } });
    const byCompetitor = new Map(regs.map((r) => [r.competitorId, r.id]));
    registrationIds = competitorIds.map((id) => byCompetitor.get(id)!);
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.match.deleteMany({ where: { bracket: { division: { tournamentId } } } });
    await prisma.bracket.deleteMany({ where: { division: { tournamentId } } });
    await prisma.division.deleteMany({ where: { tournamentId } });
    await prisma.tournament.deleteMany({ where: { id: tournamentId } });
    await prisma.competitor.deleteMany({ where: { id: { in: competitorIds } } });
    await prisma.$disconnect();
  });

  const competitors = () => registrationIds.map((id, i) => ({
    registrationId: id, name: `A${i}`, school: `S${i}`, seedPosition: i + 1,
  }));

  it('resolves byes through the whole bracket and plays N=5 DE to a champion', async () => {
    const structure = generateBracket(competitors(), 'manual');
    const bracketId = await createBracket(structure);
    const byes = await handleByeMatches(prisma, bracketId);
    expect(byes).toBeGreaterThan(3); // 3 R1 byes + the losers-bracket slots they empty

    for (let guard = 0; guard < 50; guard++) {
      const ready = await prisma.match.findFirst({ where: { bracketId, status: 'ready' }, orderBy: { matchNumber: 'asc' } });
      if (!ready) break;
      await recordResult(bracketId, ready.matchNumber, 'c1');
    }
    const open = await prisma.match.findMany({
      where: { bracketId, status: { not: 'completed' }, NOT: { matchNumber: structure.positions.reset! } },
    });
    expect(open).toEqual([]);
    const placements = await getBracketPlacements(prisma, bracketId);
    expect(placements.filter((p) => p.place === 1)).toHaveLength(1);
    expect(placements.filter((p) => p.place === 2)).toHaveLength(1);
  });

  it('handleByeMatches also works with a transaction client', async () => {
    const bracketId = await createBracket(generateBracket(competitors(), 'manual'));
    const byes = await prisma.$transaction((tx) => handleByeMatches(tx, bracketId));
    expect(byes).toBeGreaterThan(3);
  });

  it('concurrent sibling results both land downstream (row lock, no lost update)', async () => {
    // N=4: R1 matches 1 and 2 feed winners match 3 and losers match 4.
    const structure = generateBracket(competitors().slice(0, 4), 'manual');
    const bracketId = await createBracket(structure);
    await handleByeMatches(prisma, bracketId);
    await Promise.all([recordResult(bracketId, 1, 'c1'), recordResult(bracketId, 2, 'c1')]);
    const m3 = await prisma.match.findFirstOrThrow({ where: { bracketId, matchNumber: 3 } });
    const m4 = await prisma.match.findFirstOrThrow({ where: { bracketId, matchNumber: 4 } });
    expect(m3.competitor1Id && m3.competitor2Id).toBeTruthy();
    expect(m4.competitor1Id && m4.competitor2Id).toBeTruthy();
    expect(m3.status).toBe('ready');
    expect(m4.status).toBe('ready');
  });

  it('a correction that would rewrite a started match is refused and rolled back', async () => {
    const structure = generateBracket(competitors().slice(0, 4), 'manual');
    const bracketId = await createBracket(structure);
    await recordResult(bracketId, 1, 'c1');
    await recordResult(bracketId, 2, 'c1');
    await prisma.match.updateMany({ where: { bracketId, matchNumber: 3 }, data: { status: 'in_progress' } });

    await expect(recordResult(bracketId, 1, 'c2')).rejects.toBeInstanceOf(BracketAdvancementConflictError);
    const m1 = await prisma.match.findFirstOrThrow({ where: { bracketId, matchNumber: 1 } });
    expect(m1.winnerId).toBe(m1.competitor1Id); // rolled back
  });
});
