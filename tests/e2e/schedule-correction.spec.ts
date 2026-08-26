import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { loginAsEmail, skipOnboardingTour } from './helpers';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const email = 'schedule-correction-e2e@example.com';
const tournamentId = '00000000-0000-4000-8000-00000000a801';
const divisionIds = ['00000000-0000-4000-8000-00000000a802', '00000000-0000-4000-8000-00000000a803'];
const competitorId = '00000000-0000-4000-8000-00000000a804';
const originalConfig = {
  startTime: '09:00', endTime: '17:00', ringCount: 1,
  matchDurationMinutes: { patterns: 3, sparring: 5 }, breakBetweenDivisions: 5,
};

test.beforeAll(async () => {
  await prisma.tournament.deleteMany({ where: { id: tournamentId } });
  await prisma.competitor.deleteMany({ where: { id: competitorId } });
  await prisma.user.upsert({
    where: { email }, update: { role: 'admin', isActive: true },
    create: { email, firstName: 'Schedule', lastName: 'Director', role: 'admin', isActive: true },
  });
  await prisma.tournament.create({
    data: {
      id: tournamentId, name: '[E2E] Schedule Correction', date: new Date('2027-08-09'), status: 'in_progress',
      settings: JSON.stringify({ registrationFee: '45', schedule: originalConfig, rings: { count: 1, startTime: '09:00', endTime: '17:00' } }),
      divisions: { create: divisionIds.map((id, index) => ({
        id, name: `E2E Schedule Division ${index + 1}`, eventType: 'patterns',
        beltLevel: 'CB', gender: 'M', ageMin: 10, ageMax: 18, divisionNumber: index + 1,
      })) },
    },
  });
  await prisma.competitor.create({ data: { id: competitorId, firstName: 'Amina', lastName: 'Schedule', gender: 'F', dateOfBirth: new Date('2012-01-01'), belt: 'Yellow', schoolDojang: 'North Star' } });
  const registration = await prisma.registration.create({ data: { tournamentId, competitorId, patterns: true, ageAtTournament: 15 } });
  await prisma.divisionAssignment.createMany({ data: divisionIds.map((divisionId) => ({ divisionId, registrationId: registration.id })) });
});

test.afterAll(async () => {
  await prisma.tournament.deleteMany({ where: { id: tournamentId } });
  await prisma.user.deleteMany({ where: { email } });
  await prisma.competitor.deleteMany({ where: { id: competitorId } });
  await prisma.$disconnect();
});

test('director previews, applies, audits, and safely undoes schedule regeneration', async ({ page }) => {
  await skipOnboardingTour(page);
  await loginAsEmail(page, email);
  await page.goto(`/tournaments/${tournamentId}/schedule`);
  await expect(page.getByRole('heading', { name: /Schedule - \[E2E\] Schedule Correction/ })).toBeVisible();

  await page.getByLabel('Number of Rings').fill('2');
  let releasePreview!: () => void;
  const previewHeld = new Promise<void>((resolve) => { releasePreview = resolve; });
  await page.route(`**/api/tournaments/${tournamentId}/schedule/preview`, async (route) => {
    await previewHeld;
    await route.continue();
  });
  await page.getByRole('button', { name: 'Regenerate schedule' }).click();
  await expect(page.getByLabel('Number of Rings')).toBeDisabled();
  releasePreview();
  const dialog = page.getByRole('dialog', { name: 'Review schedule impact' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Nothing changes until you confirm.')).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Affected divisions' })).toBeVisible();
  await expect(dialog.getByText(/^E2E Schedule Division \d$/)).toBeVisible();

  const beforeApply = await prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId }, select: { settings: true } });
  expect(JSON.parse(beforeApply.settings!).schedule.ringCount).toBe(1);

  await page.unroute(`**/api/tournaments/${tournamentId}/schedule/preview`);
  await page.route(`**/api/tournaments/${tournamentId}/schedule`, async (route) => {
    await route.fetch();
    await route.abort('failed');
  }, { times: 1 });
  await dialog.getByRole('button', { name: 'Apply schedule' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/may have applied/i)).toBeVisible();
  await page.getByRole('button', { name: 'Check server status' }).click();
  await expect(page.getByText(/Schedule applied and reconciled/)).toBeVisible();
  const applied = await prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId }, select: { settings: true } });
  expect(JSON.parse(applied.settings!).schedule.ringCount).toBe(2);
  const audit = await prisma.tournamentOperationAudit.findFirstOrThrow({
    where: { tournamentId, operationType: 'schedule_regeneration' }, orderBy: { createdAt: 'desc' },
  });
  expect(audit.createdBy).toBeTruthy();
  expect(JSON.parse(audit.impactSummary).affectedDivisionIds).toContain(divisionIds[1]);

  await page.route(`**/api/tournaments/${tournamentId}/schedule/undo/*`, async (route) => {
    await route.fetch();
    await route.abort('failed');
  }, { times: 1 });
  await page.getByRole('button', { name: 'Undo schedule change' }).click();
  await expect(page.getByText(/previous schedule may already be restored/i)).toBeVisible();
  await page.getByRole('button', { name: 'Check server status' }).click();
  await expect(page.getByText(/Schedule applied and reconciled/)).toBeHidden();
  const restored = await prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId }, select: { settings: true } });
  expect(JSON.parse(restored.settings!).schedule.ringCount).toBe(1);
  expect((await prisma.tournamentOperationAudit.findUniqueOrThrow({ where: { id: audit.id } })).undoneAt).toBeInstanceOf(Date);

  await page.getByLabel('Number of Rings').fill('2');
  await page.getByRole('button', { name: 'Regenerate schedule' }).click();
  await expect(dialog).toBeVisible();
  await prisma.division.update({ where: { id: divisionIds[0] }, data: { name: 'E2E Concurrent Division Change' } });
  await dialog.getByRole('button', { name: 'Apply schedule' }).click();
  await expect(dialog.getByRole('alert').filter({ hasText: 'Schedule preview is stale' })).toBeVisible();
  expect(await prisma.tournamentOperationAudit.count({ where: { tournamentId } })).toBe(1);
});

test('director cannot edit live conditions before the authoritative snapshot hydrates', async ({ page }) => {
  let releaseConditions!: () => void;
  const conditionsHeld = new Promise<void>((resolve) => { releaseConditions = resolve; });
  await page.route(`**/api/recommendations/tournament/${tournamentId}/schedule/conditions`, async (route) => {
    await conditionsHeld;
    await route.continue();
  }, { times: 1 });

  await skipOnboardingTour(page);
  await loginAsEmail(page, email);
  await page.goto(`/tournaments/${tournamentId}/schedule`);
  await expect(page.getByText(/Loading saved live conditions/)).toBeVisible();
  await expect(page.getByLabel('Athlete rest window (minutes)')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save live conditions' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Generate proposal' })).toBeDisabled();

  releaseConditions();
  await expect(page.getByLabel('Athlete rest window (minutes)')).toBeEnabled();
});

test('director reviews, approves, applies, reloads, and undoes a live schedule optimization', async ({ page }) => {
  await skipOnboardingTour(page);
  await loginAsEmail(page, email);
  await page.goto(`/tournaments/${tournamentId}/schedule`);
  await expect(page.getByRole('heading', { name: /Schedule - \[E2E\] Schedule Correction/ })).toBeVisible();

  await page.getByRole('button', { name: /Lock .* at Ring/i }).first().click();
  await expect(page.getByText(/position locked/i)).toBeVisible();
  await page.getByLabel('Athlete rest window (minutes)').fill('15');
  await expect(page.getByRole('status').filter({ hasText: 'These live-condition edits are not used by the optimizer.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate proposal' })).toBeDisabled();
  await page.getByRole('button', { name: 'Save live conditions' }).click();
  await expect(page.getByText(/Live conditions saved with server time/i)).toBeVisible();

  await page.getByRole('button', { name: 'Generate proposal' }).click();
  await expect(page.getByText(/Proposal ready for review/i)).toBeVisible();
  await page.getByRole('button', { name: 'Review proposal' }).click();
  let review = page.getByRole('dialog', { name: 'Review schedule optimization' });
  await expect(review.getByText('Safety and timing evidence')).toBeVisible();
  await expect(review.getByText(/Deterministic means reproducible/i).first()).toBeVisible();
  await expect(review.getByText(/preserved exactly/i)).toBeVisible();
  await expect(review.getByRole('columnheader', { name: 'Why' })).toBeVisible();

  await page.route(`**/api/recommendations/tournament/${tournamentId}/*/approve`, (route) => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Proposal became stale during review' }) }), { times: 1 });
  await review.getByRole('button', { name: 'Approve proposal' }).click();
  await expect(review.getByRole('alert').filter({ hasText: 'Proposal became stale during review' })).toBeVisible();
  await page.unroute(`**/api/recommendations/tournament/${tournamentId}/*/approve`);
  await review.getByRole('button', { name: 'Approve proposal' }).click();
  await expect(review.getByRole('button', { name: 'Apply approved schedule' })).toBeVisible();
  await review.getByRole('button', { name: 'Apply approved schedule' }).click();

  const applyConfirm = page.getByRole('dialog', { name: 'Apply approved schedule optimization?' });
  await expect(applyConfirm).toContainText('server will revalidate the live snapshot');
  await applyConfirm.getByRole('button', { name: /Apply \d+ schedule moves/ }).click();
  await expect(page.getByText(/Approved optimization applied and reconciled/i)).toBeVisible();
  const appliedRecommendation = await prisma.recommendation.findFirstOrThrow({ where: { tournamentId, recommendationType: 'schedule_optimization_v1', status: 'applied' }, orderBy: { createdAt: 'desc' } });
  expect(appliedRecommendation.operationAuditId).toBeTruthy();

  await page.reload();
  await page.getByRole('button', { name: 'Review proposal' }).click();
  review = page.getByRole('dialog', { name: 'Review schedule optimization' });
  await review.getByRole('button', { name: 'Undo applied optimization' }).click();
  const undoConfirm = page.getByRole('dialog', { name: 'Undo applied schedule optimization?' });
  await expect(undoConfirm).toContainText('server will refuse if any later schedule edit');
  await undoConfirm.getByRole('button', { name: 'Restore audited schedule' }).click();
  await expect(page.getByText(/Optimization undone after verifying/i)).toBeVisible();
  expect((await prisma.tournamentOperationAudit.findUniqueOrThrow({ where: { id: appliedRecommendation.operationAuditId! } })).undoneAt).toBeInstanceOf(Date);
});
