import { expect, test } from '@playwright/test';

test.describe('truthful anonymous status', () => {
  test('a first-time public visitor is not told that a session expired', async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByText('Your session has expired. Please log in again.')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Tournament Registration/i })).toBeVisible();
  });

  test('an unavailable parent link never renders a live empty state', async ({ page }) => {
    await page.goto('/scoreboard/parent/00000000-0000-4000-8000-000000000000?key=invalid');
    await expect(page.getByRole('heading', { name: 'Tournament unavailable' })).toBeVisible();
    await expect(page.getByText('No matches in progress right now.')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.getByText('Your session has expired. Please log in again.')).toHaveCount(0);
  });
});
