import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { loginAsDemo } from './helpers';

test.describe('organization settings', () => {
  test.beforeEach(async () => {
    const prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
    try {
      await prisma.organization.deleteMany({ where: { name: { startsWith: 'E2E' } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  test('an operator can create a workspace and see plan usage and billing choices', async ({ page }) => {
    await loginAsDemo(page);
    await page.goto('/organization');

    await expect(page.getByRole('heading', { name: 'Organization & billing' })).toBeVisible();
    await expect(page.getByText('Set up your organization')).toBeVisible();
    await page.screenshot({ path: 'test-results/visual-qa/organization-empty-desktop.png', fullPage: true });

    const name = `E2E Billing Dojang ${Date.now()}`;
    await page.getByLabel('Organization name').fill(name);
    await page.getByRole('button', { name: 'Create organization' }).click();

    await expect(page.getByRole('heading', { name })).toBeVisible();
    await expect(page.getByText('Free plan', { exact: true })).toBeVisible();
    await expect(page.getByText('Tournament usage')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose Starter' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose Pro' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export organization data' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete organization' })).toBeVisible();
    await page.screenshot({ path: 'test-results/visual-qa/organization-plans-desktop.png', fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500); // allow the responsive drawer transition to settle
    await expect(page.getByRole('heading', { name })).toBeVisible();
    const layout = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
    await page.screenshot({ path: 'test-results/visual-qa/organization-plans-mobile.png' });

    await page.getByRole('button', { name: 'Delete organization' }).click();
    await expect(page.getByRole('dialog', { name: 'Delete organization' })).toBeVisible();
    const dialogLayout = await page.evaluate(() => ({
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dialogLayout.scrollWidth).toBeLessThanOrEqual(dialogLayout.width);
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-results/visual-qa/organization-delete-mobile.png' });
    await page.getByLabel('Organization URL confirmation').fill(name.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    await page.getByLabel('I have exported the organization data').check();
    await page.getByRole('button', { name: 'Permanently delete organization' }).click();
    await expect(page.getByText('Set up your organization')).toBeVisible();
  });
});
