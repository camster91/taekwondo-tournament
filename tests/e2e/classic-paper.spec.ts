import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { loginAsEmail, skipOnboardingTour } from './helpers';

// Paper that matches the old event (roadmap #12-14): paper bracket
// sheets per division and as a ZIP, the tournament-wide bracket type,
// and the printable ring-by-time schedule.

const run = randomUUID().slice(0, 8);
const userId = randomUUID();
const email = `e2e-classic-${run}@example.com`;
const tournamentId = randomUUID();
const divisionId = randomUUID();
const divisionName = `10-11 CB-All Blue/Red Belts Females Sparring Heavy E2E ${run}`;
const competitorIds = [randomUUID(), randomUUID(), randomUUID()];
let prisma: PrismaClient;

test.describe('classic paper', () => {
  test.beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
    await prisma.user.create({ data: { id: userId, email, firstName: 'E2E', lastName: 'Paper Admin', role: 'admin' } });
    await prisma.tournament.create({ data: { id: tournamentId, name: `E2E Paper Open ${run}`, date: new Date('2030-05-01'), status: 'in_progress' } });
    await prisma.division.create({
      data: {
        id: divisionId, tournamentId, name: divisionName, beltLevel: 'CB', gender: 'F', eventType: 'sparring',
        ageMin: 10, ageMax: 11, weightClass: 'Heavy', beltColors: '["Blue","Red"]',
      },
    });
    for (const [i, competitorId] of competitorIds.entries()) {
      await prisma.competitor.create({
        data: {
          id: competitorId, firstName: `E2E Paper${i}`, lastName: run, gender: 'F',
          dateOfBirth: new Date('2019-03-01'), belt: 'Blue', schoolDojang: 'E2E Dojang', weightLbs: 90,
        },
      });
      const registration = await prisma.registration.create({ data: { tournamentId, competitorId, sparring: true } });
      await prisma.divisionAssignment.create({ data: { divisionId, registrationId: registration.id, seedPosition: i + 1 } });
    }
  });

  test.afterAll(async () => {
    try {
      await prisma.tournament.deleteMany({ where: { id: tournamentId } });
      await prisma.competitor.deleteMany({ where: { id: { in: competitorIds } } });
      await prisma.user.deleteMany({ where: { id: userId } });
    } finally {
      await prisma.$disconnect();
    }
  });

  test.beforeEach(async ({ page }) => {
    await skipOnboardingTour(page);
    await loginAsEmail(page, email);
  });

  test('Divisions page downloads a paper bracket and a ZIP of all of them', async ({ page }) => {
    await page.goto(`/tournaments/${tournamentId}/divisions`);

    const sheetButton = page.getByRole('button', { name: `Download paper bracket for ${divisionName}` });
    await expect(sheetButton).toBeVisible();
    const sheetDownload = page.waitForEvent('download');
    await sheetButton.click();
    const sheet = await sheetDownload;
    expect(sheet.suggestedFilename()).toMatch(/Blue_Red Belts Females Sparring Heavy E2E .*\.pdf$/);
    expect(readFileSync((await sheet.path())!).subarray(0, 5).toString()).toBe('%PDF-');
    await expect(page.getByRole('status').filter({ hasText: 'Paper bracket download started' })).toBeVisible();

    const zipButton = page.getByRole('button', { name: 'Download paper brackets for every division (ZIP)' });
    await expect(zipButton).toBeEnabled();
    const zipDownload = page.waitForEvent('download');
    await zipButton.click();
    const zip = await zipDownload;
    expect(zip.suggestedFilename()).toMatch(/_Paper_Brackets\.zip$/);
    const bytes = readFileSync((await zip.path())!);
    expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(bytes.toString('latin1')).toContain('CB Females Sparring/');
  });

  test('Results export menu offers the paper brackets ZIP', async ({ page }) => {
    await page.goto(`/tournaments/${tournamentId}/results`);
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Paper brackets (ZIP)' }).click();
    expect((await download).suggestedFilename()).toMatch(/_Paper_Brackets\.zip$/);
    await expect(page.getByRole('status').filter({ hasText: 'Paper brackets download started' })).toBeVisible();
  });

  test('Tournament Settings saves single elimination as the bracket type', async ({ page }) => {
    await page.goto(`/tournaments/${tournamentId}/settings`);
    const bracketType = page.getByLabel('Bracket type');
    await expect(bracketType).toHaveValue('double_elim');
    await bracketType.selectOption('single_elim');
    const saved = page.waitForResponse((r) => r.url().endsWith(`/api/tournaments/${tournamentId}/settings`) && r.request().method() === 'PUT' && r.ok());
    await page.getByRole('button', { name: 'Save Settings' }).first().click();
    await saved;
    const tournament = await prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId }, select: { settings: true } });
    expect(JSON.parse(tournament.settings ?? '{}').defaultBracketFormat).toBe('single_elim');

    await page.reload();
    await expect(page.getByLabel('Bracket type')).toHaveValue('single_elim');
  });

  test('Schedule links to a printable ring-by-time view with the bracket sheet names', async ({ page }) => {
    await page.goto(`/tournaments/${tournamentId}/schedule`);
    await page.getByRole('link', { name: 'Printable ring schedule' }).click();
    await expect(page).toHaveURL(new RegExp(`/tournaments/${tournamentId}/schedule/print$`));
    await expect(page.getByRole('heading', { name: 'Ring schedule' })).toBeVisible();
    await expect(page.getByText(divisionName).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText(/sheet in CB Females Sparring/).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Print' })).toBeEnabled();
  });
});
