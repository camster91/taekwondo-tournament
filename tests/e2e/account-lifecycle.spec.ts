import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { loginAsEmail, skipOnboardingTour } from './helpers';

test('a user permanently deletes an unowned account and its authentication records', async ({ page }) => {
  const email = `e2e-delete-account-${Date.now()}@example.com`;
  await loginAsEmail(page, email);
  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === 'bowin_csrf')?.value;
  expect(csrf).toBeTruthy();

  const deleted = await page.request.delete('/api/auth/account', {
    headers: { 'X-CSRF-Token': csrf! },
    data: { confirmation: email },
  });
  expect(deleted.status()).toBe(204);
  expect((await page.request.get('/api/auth/me')).status()).toBe(401);

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
    expect(await prisma.magicLink.count({ where: { email } })).toBe(0);
  } finally {
    await prisma.$disconnect();
  }
});

test('account settings expose an accessible permanent-deletion flow', async ({ page }) => {
  const email = `e2e-delete-profile-${Date.now()}@example.com`;
  await skipOnboardingTour(page);
  await loginAsEmail(page, email);
  await page.goto('/profile');

  await page.getByRole('button', { name: 'Delete account' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete account' });
  await expect(dialog).toBeVisible();
  await page.getByLabel('Account email confirmation').fill(email);
  await dialog.getByRole('button', { name: 'Permanently delete account' }).click();
  await page.waitForURL(/\/login$/);
  await expect(page.locator('h1').filter({ hasText: /^Sign in$/ })).toBeVisible();
});
