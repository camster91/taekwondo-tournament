import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { loginAsEmail, skipOnboardingTour } from './helpers';

const email = 'competitor-operations-e2e@example.com';
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

test.beforeAll(async () => {
  await prisma.user.upsert({
    where: { email },
    update: { role: 'admin', isActive: true },
    create: { email, firstName: 'Competitor', lastName: 'Operator', role: 'admin', isActive: true },
  });
});

test.afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } });
  await prisma.$disconnect();
});

test('failed competitor deletion stays actionable and pending deletion cannot be dismissed', async ({ page }) => {
  await skipOnboardingTour(page);
  await loginAsEmail(page, email);
  await page.goto('/competitors');

  const deleteButton = page.getByRole('button', { name: /^Delete / }).first();
  await expect(deleteButton).toBeVisible();
  await deleteButton.click();

  let attempts = 0;
  await page.route('**/api/competitors/*', async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue();
    attempts += 1;
    if (attempts === 1) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Competitor is assigned to an active bracket' }),
      });
    }
    return route.fulfill({ status: 204, body: '' });
  });

  const dialog = page.getByRole('dialog', { name: 'Send to Trash?' });
  await dialog.getByRole('button', { name: 'Send to Trash' }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toContainText('Competitor is assigned to an active bracket');
  await expect(page.getByRole('alert')).toHaveCount(1);

  await dialog.getByRole('button', { name: 'Send to Trash' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status')).toContainText('Competitor sent to Trash and the list is up to date');
  expect(attempts).toBe(2);
});
