import { expect, test } from '@playwright/test';

test.describe('public legal documents', () => {
  test('privacy notice is reachable without authentication', async ({ page }) => {
    await page.goto('/legal/privacy');

    await expect(page.getByRole('heading', { name: 'Privacy Notice' })).toBeVisible();
    await expect(page.getByText(/Effective August 24, 2026/i)).toBeVisible();
    await expect(page.getByText(/404/i)).toHaveCount(0);
  });

  test('tournament terms are reachable without authentication', async ({ page }) => {
    await page.goto('/legal/terms');

    await expect(page.getByRole('heading', { name: 'Tournament Platform Terms' })).toBeVisible();
    await expect(page.getByText(/These terms govern an organizer/i)).toBeVisible();
    await expect(page.getByText(/404/i)).toHaveCount(0);
  });
});
