import { expect, test } from '@playwright/test';

test('keeps setup and sign-in hidden until readiness is known', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/auth/setup-status', async (route) => {
    await held;
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"needsSetup":false}' });
  });

  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Checking system readiness' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Set up your admin account' })).toHaveCount(0);

  release();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true }).first()).toBeVisible();
});

test('shows a retryable readiness failure and recovers to sign-in', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/auth/setup-status', (route) => {
    attempts += 1;
    return route.fulfill({
      status: attempts === 1 ? 500 : 200,
      contentType: 'application/json',
      body: attempts === 1 ? '{"error":"service unavailable"}' : '{"needsSetup":false}',
    });
  });

  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign-in temporarily unavailable' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry readiness check' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true }).first()).toBeVisible();
  expect(attempts).toBe(2);
});

test('honors setup-required and rate-limited readiness states', async ({ page }) => {
  await page.route('**/api/auth/setup-status', (route) => route.fulfill({
    status: 429,
    headers: { 'Retry-After': '37' },
    contentType: 'application/json',
    body: '{"error":"busy"}',
  }));
  await page.goto('/login');
  await expect(page.getByText('System readiness is busy. Try again in 37 seconds.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toHaveCount(0);

  await page.unroute('**/api/auth/setup-status');
  await page.route('**/api/auth/setup-status', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: '{"needsSetup":true}',
  }));
  await page.getByRole('button', { name: 'Retry readiness check' }).click();
  await expect(page.getByRole('heading', { name: 'Set up your admin account' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toHaveCount(0);
});
