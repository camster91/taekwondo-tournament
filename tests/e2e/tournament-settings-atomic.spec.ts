import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { loginAsEmail, skipOnboardingTour } from './helpers';

const organizationId = randomUUID();
const tournamentId = randomUUID();
const userId = randomUUID();
const email = `settings-${userId}@example.com`;
let prisma: PrismaClient;

test.describe('atomic tournament settings', () => {
  test.beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
    await prisma.user.create({ data: { id: userId, email, firstName: '[E2E]', lastName: 'Settings Admin', role: 'admin' } });
    await prisma.organization.create({ data: { id: organizationId, name: '[E2E] Settings Org', slug: `e2e-settings-${organizationId}` } });
    await prisma.tournament.create({ data: { id: tournamentId, organizationId, name: '[E2E] Settings Tournament', date: new Date('2030-01-01') } });
  });

  test.afterAll(async () => {
    await prisma.tournament.deleteMany({ where: { id: tournamentId, organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  test('saving either form preserves the other form edits and both persist after reload', async ({ page }) => {
    await skipOnboardingTour(page);
    await loginAsEmail(page, email);
    await page.goto(`/tournaments/${tournamentId}/settings`);
    await page.route(`**/api/tournaments/${tournamentId}/rules`, async (route) => {
      if (route.request().method() === 'PUT') await new Promise((resolve) => setTimeout(resolve, 400));
      await route.continue();
    });
    await page.route(`**/api/tournaments/${tournamentId}/settings`, async (route) => {
      if (route.request().method() === 'PUT') await new Promise((resolve) => setTimeout(resolve, 400));
      await route.continue();
    });

    const setupThreshold = page.getByLabel('Division split threshold');
    await setupThreshold.fill('9');
    await page.getByRole('tab', { name: /Categorization \+ Brackets/i }).click();
    const divisionRules = page.getByText('Division Split & Merge').locator('..');
    const minimumCompetitors = divisionRules.locator('input[type="number"]').first();
    await minimumCompetitors.fill('3');
    const firstRulesSave = page.waitForResponse((response) => response.url().endsWith(`/api/tournaments/${tournamentId}/rules`) && response.request().method() === 'PUT' && response.ok());
    await page.getByRole('button', { name: 'Save Rules' }).click();
    await expect(minimumCompetitors).toBeDisabled();
    await firstRulesSave;
    await expect(page.getByText('Tournament rules saved')).toBeVisible();

    await page.getByRole('tab', { name: /Setup/i }).click();
    await expect(setupThreshold).toHaveValue('9');
    // Save-state copy from #260.
    await expect(page.getByRole('status', { name: 'Save status: Unsaved changes' })).toBeVisible();

    await page.getByRole('tab', { name: /Categorization \+ Brackets/i }).click();
    await minimumCompetitors.fill('4');
    await page.getByRole('tab', { name: /Setup/i }).click();
    const settingsSave = page.waitForResponse((response) => response.url().endsWith(`/api/tournaments/${tournamentId}/settings`) && response.request().method() === 'PUT' && response.ok());
    await page.getByRole('button', { name: 'Save Settings' }).click();
    await expect(setupThreshold).toBeDisabled();
    await settingsSave;
    await expect(page.getByText('Settings saved successfully!')).toBeVisible();

    await page.getByRole('tab', { name: /Categorization \+ Brackets/i }).click();
    await expect(minimumCompetitors).toHaveValue('4');
    await expect(page.getByRole('button', { name: 'Save Rules' })).toBeEnabled();
    const secondRulesSave = page.waitForResponse((response) => response.url().endsWith(`/api/tournaments/${tournamentId}/rules`) && response.request().method() === 'PUT' && response.ok());
    const secondRulesReconciliation = page.waitForResponse((response) => response.url().endsWith(`/api/tournaments/${tournamentId}`) && response.request().method() === 'GET' && response.ok());
    await page.getByRole('button', { name: 'Save Rules' }).click();
    await secondRulesSave;
    await secondRulesReconciliation;

    await page.reload();
    await page.getByRole('tab', { name: /Setup/i }).click();
    await expect(page.getByLabel('Division split threshold')).toHaveValue('9');
    await page.getByRole('tab', { name: /Categorization \+ Brackets/i }).click();
    const reloadedRules = page.getByText('Division Split & Merge').locator('..').locator('input[type="number"]').first();
    await expect(reloadedRules).toHaveValue('4');
  });
});
