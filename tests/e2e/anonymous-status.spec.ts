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

  test('parent scoreboard explains rate limiting and preserves retry', async ({ page }) => {
    const id = '00000000-0000-4000-8000-000000000099';
    await page.route(`**/api/public/tournaments/${id}`, (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id, name: 'Fabricated Event', date: '2027-01-01', location: 'Test', status: 'in_progress' }),
    }));
    await page.route(`**/api/public/tournaments/${id}/scoreboard**`, (route) => route.fulfill({
      status: 429,
      headers: { 'Retry-After': '42' },
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Busy' }),
    }));
    await page.goto(`/scoreboard/parent/${id}?key=fabricated`);
    await expect(page.getByText(/Try again in 42 seconds/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('registration lookup does not turn a tournament-list outage into an empty selector', async ({ page }) => {
    await page.route('**/api/public/tournaments', (route) => route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Unavailable' }),
    }));
    await page.goto('/check-registration');
    await expect(page.getByRole('alert').filter({ hasText: 'Tournament choices are unavailable' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Look up registration' })).toBeDisabled();
  });

  test('registration lookup preserves privacy-safe guidance for an ordinary miss', async ({ page }) => {
    await page.route('**/api/public/tournaments', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: 't1', name: 'Fabricated Event', date: '2027-01-01' }]),
    }));
    await page.route('**/api/public/check-registration?**', (route) => route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ registered: false }),
    }));
    await page.goto('/check-registration');
    await page.getByLabel('Tournament').selectOption('t1');
    await page.getByLabel('First name').fill('Nobody');
    await page.getByLabel('Last name').fill('Fabricated');
    await page.getByLabel('Date of birth').fill('2010-01-01');
    await page.getByRole('button', { name: 'Look up registration' }).click();
    await expect(page.getByRole('alert')).toContainText('No registration found for those exact details');
    await expect(page.getByRole('alert')).not.toContainText('Request failed');
  });
});
