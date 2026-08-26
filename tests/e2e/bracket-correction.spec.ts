import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { buildProposedBracketCorrection, loadBracketCorrectionSnapshot } from '../../src/server/services/bracket-correction';
import { loginAsEmail, loginRequestAsEmail, skipOnboardingTour } from './helpers';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const operatorEmail = 'bracket-correction-e2e@example.com';
const scorekeeperEmail = 'bracket-correction-scorekeeper-e2e@example.com';
const ids = {
  organization: '00000000-0000-4000-8000-00000000b801',
  tournament: '00000000-0000-4000-8000-00000000b802',
  division: '00000000-0000-4000-8000-00000000b803',
  competitors: ['00000000-0000-4000-8000-00000000b804', '00000000-0000-4000-8000-00000000b805', '00000000-0000-4000-8000-00000000b806', '00000000-0000-4000-8000-00000000b807'],
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
  await prisma.user.deleteMany({ where: { email: { in: [operatorEmail, scorekeeperEmail] } } });
}

test.beforeAll(async () => {
  await cleanup();
  const operator = await prisma.user.create({ data: { email: operatorEmail, firstName: 'Bracket', lastName: 'Director', role: 'director', isActive: true } });
  const scorekeeper = await prisma.user.create({ data: { email: scorekeeperEmail, firstName: 'Bracket', lastName: 'Scorekeeper', role: 'scorekeeper', isActive: true } });
  await prisma.organization.create({ data: { id: ids.organization, name: '[E2E] Bracket correction', slug: 'e2e-bracket-correction' } });
  await prisma.organizationMember.create({ data: { organizationId: ids.organization, userId: operator.id, role: 'member' } });
  await prisma.organizationMember.create({ data: { organizationId: ids.organization, userId: scorekeeper.id, role: 'member' } });
  await prisma.competitor.createMany({ data: ids.competitors.map((id, index) => ({ id, firstName: `Bracket ${index + 1}`, lastName: 'Athlete', gender: 'M', dateOfBirth: new Date('2010-01-01'), belt: 'Blue', schoolDojang: `Dojang ${index + 1}` })) });
  await prisma.tournament.create({ data: { id: ids.tournament, organizationId: ids.organization, name: '[E2E] Bracket correction', date: new Date('2030-01-01'), status: 'brackets', registrations: { create: ids.competitors.map((competitorId) => ({ competitorId, sparring: true })) } } });
  const registrations = await prisma.registration.findMany({ where: { tournamentId: ids.tournament }, orderBy: { competitorId: 'asc' } });
  await prisma.division.create({ data: { id: ids.division, tournamentId: ids.tournament, name: 'E2E Junior Sparring', beltLevel: 'CB', gender: 'M', eventType: 'sparring', ageMin: 10, ageMax: 18, assignments: { create: registrations.map((registration, index) => ({ registrationId: registration.id, seedPosition: index + 1 })) } } });
  const empty = await loadBracketCorrectionSnapshot(prisma, ids.division);
  const proposed = buildProposedBracketCorrection(empty, { format: 'double_elim', seedingStrategy: 'school_spread' });
  const bracket = await prisma.bracket.create({ data: { divisionId: ids.division, structure: JSON.stringify(proposed.structure), format: 'double_elim' } });
  await prisma.match.createMany({ data: proposed.matches.map((match) => ({ ...match, bracketId: bracket.id })) });
  const first = await prisma.match.findFirstOrThrow({ where: { bracketId: bracket.id, competitor1Id: { not: null }, competitor2Id: { not: null } }, orderBy: { matchNumber: 'asc' } });
  await prisma.match.update({ where: { id: first.id }, data: { status: 'completed', winnerId: first.competitor1Id, score1: '6', score2: '3', notes: 'E2E result' } });
  await prisma.matchAuditLog.create({ data: { matchId: first.id, action: 'complete', previousState: '{}', newState: '{"score":"6-3"}' } });
});

test.afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test('director previews, reconciles response loss, and safely undoes a bracket reseed', async ({ page }) => {
  await skipOnboardingTour(page);
  await loginAsEmail(page, operatorEmail);
  await page.goto(`/tournaments/${ids.tournament}/divisions/${ids.division}/bracket`);
  let previewRequests = 0;
  await page.route(`**/api/brackets/division/${ids.division}/correction/preview`, async (route) => {
    previewRequests++;
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.continue();
  });
  await page.getByRole('button', { name: 'Reseed bracket' }).evaluate((button) => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  const dialog = page.getByRole('dialog', { name: 'Regenerate Bracket' });
  await expect(dialog).toContainText('Completed results');
  expect(previewRequests).toBe(1);
  await expect(dialog).toContainText('1');
  await expect(dialog).toContainText('Audit entries');

  let applyRequests = 0;
  await page.route(`**/api/brackets/division/${ids.division}/correction/apply`, async (route) => {
    applyRequests++;
    await route.fetch();
    await route.abort('connectionreset');
  });
  await dialog.getByRole('button', { name: 'Apply reseed' }).click();
  await expect(dialog.getByRole('alert')).toContainText('may have applied');
  expect(applyRequests).toBe(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Check server status' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'server confirms' })).toBeVisible();
  const audit = await prisma.tournamentOperationAudit.findFirstOrThrow({ where: { tournamentId: ids.tournament, operationType: 'bracket_reseed' }, orderBy: { createdAt: 'desc' } });

  let undoRequests = 0;
  await page.route(`**/api/brackets/division/${ids.division}/correction/undo/${audit.id}`, async (route) => {
    undoRequests++;
    await route.fetch();
    await route.abort('connectionreset');
  });
  await page.getByRole('button', { name: 'Undo reseed' }).click();
  await expect(page.getByRole('alert')).toContainText('Undo may have succeeded');
  expect(undoRequests).toBe(1);
  await page.getByRole('button', { name: 'Check undo status' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'previous bracket' })).toBeVisible();
  await expect.poll(async () => (await prisma.tournamentOperationAudit.findUniqueOrThrow({ where: { id: audit.id } })).undoneAt).not.toBeNull();
  const restoredMatch = await prisma.match.findFirst({ where: { bracket: { divisionId: ids.division }, score1: '6', score2: '3', notes: 'E2E result' } });
  expect(restoredMatch).not.toBeNull();
});

test('legacy destructive routes cannot bypass director correction review', async ({ request }) => {
  const scorekeeperHeaders = await loginRequestAsEmail(request, scorekeeperEmail);
  const reset = await request.post(`/api/brackets/division/${ids.division}/reset`, { headers: scorekeeperHeaders });
  expect(reset.status()).toBe(403);

  const directorHeaders = await loginRequestAsEmail(request, operatorEmail);
  const bracketBefore = await prisma.bracket.findUniqueOrThrow({ where: { divisionId: ids.division } });
  const directorReset = await request.post(`/api/brackets/division/${ids.division}/reset`, { headers: directorHeaders });
  expect(directorReset.status()).toBe(409);
  const legacyReseed = await request.post(`/api/brackets/division/${ids.division}/generate`, { headers: directorHeaders, data: { seedingStrategy: 'school_spread' } });
  expect(legacyReseed.status()).toBe(409);
  await expect(legacyReseed.json()).resolves.toMatchObject({ error: expect.stringContaining('correction preview') });
  const generateAll = await request.post(`/api/brackets/tournament/${ids.tournament}/generate-all`, { headers: directorHeaders, data: { seedingStrategy: 'school_spread' } });
  expect(generateAll.status()).toBe(409);
  const bracketAfter = await prisma.bracket.findUniqueOrThrow({ where: { divisionId: ids.division } });
  expect(bracketAfter.id).toBe(bracketBefore.id);
});
