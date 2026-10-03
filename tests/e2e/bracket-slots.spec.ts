import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { buildProposedBracketCorrection, loadBracketCorrectionSnapshot } from '../../src/server/services/bracket-correction';
import { loginAsEmail, loginRequestAsEmail, skipOnboardingTour } from './helpers';

// Roadmap item 10: a director moves people between first-round spots,
// takes someone out (their spot becomes a bye) and puts them back,
// without clearing the bracket. Uses the tap flow so it works on phones.

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const directorEmail = 'e2e-bracket-slots-director@example.com';
const scorekeeperEmail = 'e2e-bracket-slots-scorekeeper@example.com';
const ids = {
  organization: '00000000-0000-4000-8000-00000000b901',
  tournament: '00000000-0000-4000-8000-00000000b902',
  division: '00000000-0000-4000-8000-00000000b903',
  competitors: ['00000000-0000-4000-8000-00000000b904', '00000000-0000-4000-8000-00000000b905', '00000000-0000-4000-8000-00000000b906', '00000000-0000-4000-8000-00000000b907'],
};

async function cleanup() {
  const matchIds = (await prisma.match.findMany({ where: { bracket: { division: { tournamentId: ids.tournament } } }, select: { id: true } })).map((match) => match.id);
  await prisma.matchAuditLog.deleteMany({ where: { matchId: { in: matchIds } } });
  await prisma.matchupHistory.deleteMany({ where: { tournamentId: ids.tournament } });
  await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
  await prisma.bracket.deleteMany({ where: { division: { tournamentId: ids.tournament } } });
  await prisma.tournament.deleteMany({ where: { id: ids.tournament } });
  await prisma.organization.deleteMany({ where: { id: ids.organization } });
  await prisma.competitor.deleteMany({ where: { id: { in: ids.competitors } } });
  await prisma.user.deleteMany({ where: { email: { in: [directorEmail, scorekeeperEmail] } } });
}

async function setup() {
  await cleanup();
  const director = await prisma.user.create({ data: { email: directorEmail, firstName: 'E2E Slots', lastName: 'Director', role: 'director', isActive: true } });
  const scorekeeper = await prisma.user.create({ data: { email: scorekeeperEmail, firstName: 'E2E Slots', lastName: 'Scorekeeper', role: 'scorekeeper', isActive: true } });
  await prisma.organization.create({ data: { id: ids.organization, name: 'E2E Bracket slots', slug: 'e2e-bracket-slots' } });
  await prisma.organizationMember.create({ data: { organizationId: ids.organization, userId: director.id, role: 'member' } });
  await prisma.organizationMember.create({ data: { organizationId: ids.organization, userId: scorekeeper.id, role: 'scorekeeper' } });
  await prisma.competitor.createMany({ data: ids.competitors.map((id, index) => ({ id, firstName: `E2E Slot${index + 1}`, lastName: 'Athlete', gender: 'M', dateOfBirth: new Date('2012-01-01'), belt: 'Blue', schoolDojang: `Dojang ${index + 1}` })) });
  await prisma.tournament.create({ data: { id: ids.tournament, organizationId: ids.organization, name: 'E2E Bracket slots', date: new Date('2030-01-01'), status: 'brackets', registrations: { create: ids.competitors.map((competitorId) => ({ competitorId, sparring: true })) } } });
  const registrations = await prisma.registration.findMany({ where: { tournamentId: ids.tournament }, orderBy: { competitorId: 'asc' } });
  await prisma.division.create({ data: { id: ids.division, tournamentId: ids.tournament, name: 'E2E Slots Sparring', beltLevel: 'CB', gender: 'M', eventType: 'sparring', ageMin: 10, ageMax: 18, assignments: { create: registrations.map((registration, index) => ({ registrationId: registration.id, seedPosition: index + 1 })) } } });
  const empty = await loadBracketCorrectionSnapshot(prisma, ids.division);
  const proposed = buildProposedBracketCorrection(empty, { format: 'double_elim', seedingStrategy: 'school_spread' });
  const bracket = await prisma.bracket.create({ data: { divisionId: ids.division, structure: JSON.stringify(proposed.structure), format: 'double_elim' } });
  await prisma.match.createMany({ data: proposed.matches.map((match) => ({ ...match, bracketId: bracket.id })) });
}

/** The two first-round matches (4-person double elimination), in order. */
async function firstRound() {
  const matches = await prisma.match.findMany({
    where: { bracket: { divisionId: ids.division }, bracketType: 'winners', roundNumber: 1 },
    include: { competitor1: { include: { competitor: true } }, competitor2: { include: { competitor: true } } },
    orderBy: { matchNumber: 'asc' },
  });
  expect(matches).toHaveLength(2);
  return matches;
}

const nameOf = (slot: { competitor: { firstName: string; lastName: string } } | null) =>
  slot ? `${slot.competitor.firstName} ${slot.competitor.lastName}` : '';

// Both tests rebuild the same fixture, so they must not run side by side.
test.describe.configure({ mode: 'serial' });

test.beforeEach(setup);

test.afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test('director moves a person, makes a bye and fills it again without clearing the bracket', async ({ page }) => {
  const [w1, w2] = await firstRound();
  const a = nameOf(w1.competitor1);
  const b = nameOf(w2.competitor2);
  const bracketId = w1.bracketId;

  await skipOnboardingTour(page);
  await loginAsEmail(page, directorEmail);
  await page.goto(`/tournaments/${ids.tournament}/divisions/${ids.division}/bracket`);

  // 1. Move: tap Move on A, then tap B in the other match to swap them.
  await page.getByRole('button', { name: `Move ${a}`, exact: true }).click();
  await expect(page.getByTestId('bracket-move-banner')).toContainText(`Moving ${a}`);
  await page.getByRole('button', { name: new RegExp(`^Swap ${a} with ${b} \\(`) }).click();
  await expect(page.getByTestId('bracket-move-banner')).toBeHidden();
  await expect.poll(async () => {
    const [m1, m2] = await firstRound();
    return [m1.competitor1Id, m2.competitor2Id];
  }).toEqual([w2.competitor2Id, w1.competitor1Id]);

  // 2. Take out: B (now W1 top) leaves the bracket; their opponent gets a bye.
  await page.getByRole('button', { name: `Move ${b}`, exact: true }).click();
  await page.getByRole('button', { name: `Take ${b} out of the bracket. Their opponent gets a bye.` }).click();
  await expect(page.getByRole('heading', { name: 'Not in the bracket (1)' })).toBeVisible();
  await expect.poll(async () => {
    const [m1] = await firstRound();
    return { c1: m1.competitor1Id, status: m1.status, winner: m1.winnerId, notes: m1.notes };
  }).toEqual({ c1: null, status: 'completed', winner: w1.competitor2Id, notes: 'BYE' });

  // 3. Place: put B back into the empty spot; the bye is undone.
  await page.getByRole('button', { name: `Place ${b} in an empty spot` }).click();
  await expect(page.getByTestId('bracket-move-banner')).toContainText(`Placing ${b}`);
  await page.getByRole('button', { name: new RegExp(`^Put ${b} in the empty match`) }).click();
  await expect(page.getByRole('heading', { name: /Not in the bracket/ })).toBeHidden();
  await expect.poll(async () => {
    const [m1] = await firstRound();
    return { c1: m1.competitor1Id, status: m1.status, winner: m1.winnerId };
  }).toEqual({ c1: w2.competitor2Id, status: 'ready', winner: null });

  // Same bracket throughout, every change audited, the draw kept in step.
  const bracket = await prisma.bracket.findUniqueOrThrow({ where: { divisionId: ids.division } });
  expect(bracket.id).toBe(bracketId);
  const structure = JSON.parse(bracket.structure) as { winners: Array<{ matchNumber: number; competitor1Id: string | null }>; competitorCount: number };
  expect(structure.winners.find((m) => m.matchNumber === w1.matchNumber)?.competitor1Id).toBe(w2.competitor2Id);
  expect(structure.competitorCount).toBe(4);
  const audits = await prisma.matchAuditLog.findMany({ where: { action: { startsWith: 'slot_' }, matchId: { in: [w1.id, w2.id] } } });
  expect(audits.map((row) => row.action).sort()).toEqual(['slot_move', 'slot_move', 'slot_place', 'slot_remove']);
});

test('only directors change spots, and played matches are locked', async ({ request }) => {
  const [w1, w2] = await firstRound();
  const move = { action: 'move', registrationId: w1.competitor1Id, from: { matchId: w1.id, slot: 1 }, to: { matchId: w2.id, slot: 1 } };

  const scorekeeperHeaders = await loginRequestAsEmail(request, scorekeeperEmail);
  const denied = await request.post(`/api/brackets/division/${ids.division}/slots`, { headers: scorekeeperHeaders, data: move });
  expect(denied.status()).toBe(403);

  await prisma.match.update({ where: { id: w1.id }, data: { status: 'completed', winnerId: w1.competitor1Id, score1: '5', score2: '1' } });
  const directorHeaders = await loginRequestAsEmail(request, directorEmail);
  const locked = await request.post(`/api/brackets/division/${ids.division}/slots`, { headers: directorHeaders, data: move });
  expect(locked.status()).toBe(409);
  await expect(locked.json()).resolves.toMatchObject({ error: expect.stringContaining('already been played') });
  const [after] = await firstRound();
  expect(after.competitor1Id).toBe(w1.competitor1Id);
  expect(after.score1).toBe('5');
});
