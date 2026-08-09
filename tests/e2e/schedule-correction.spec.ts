import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { loginAsEmail, skipOnboardingTour } from './helpers';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const email = 'schedule-correction-e2e@example.com';
const tournamentId = '00000000-0000-4000-8000-00000000a801';
const divisionIds = ['00000000-0000-4000-8000-00000000a802', '00000000-0000-4000-8000-00000000a803'];
const originalConfig = {
  startTime: '09:00', endTime: '17:00', ringCount: 1,
  matchDurationMinutes: { patterns: 3, sparring: 5 }, breakBetweenDivisions: 5,
};

test.beforeAll(async () => {
  await prisma.tournament.deleteMany({ where: { id: tournamentId } });
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
});

test.afterAll(async () => {
  await prisma.tournament.deleteMany({ where: { id: tournamentId } });
  await prisma.user.deleteMany({ where: { email } });
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
  await expect(dialog.getByText('E2E Schedule Division 2')).toBeVisible();

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
  await expect(dialog.getByRole('alert')).toContainText('Schedule preview is stale');
  expect(await prisma.tournamentOperationAudit.count({ where: { tournamentId } })).toBe(1);
});
