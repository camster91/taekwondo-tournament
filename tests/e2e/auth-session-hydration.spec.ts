import { expect, test, type Page } from '@playwright/test';

// The signed-in landing page moved from / (now marketing) to /dashboard.
// Its data calls are mocked so the fabricated session is not rejected by
// the real API (which would correctly sign the user out).
async function mockDashboard(page: Page) {
  await page.route('**/api/tournaments', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/auth/onboarding', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"dismissed":true}' }));
  await page.route('**/api/competitors?limit=1', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"competitors":[],"total":0}' }));
  await page.route('**/api/analytics/dashboard', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      totals: { competitors: 0, tournaments: 0, matches: 0, completedMatches: 0, recentRegistrations: 0 },
      beltDistribution: [], genderDistribution: [], topSchools: [], ageDistribution: [],
    }),
  }));
}

test('verified magic link stays on sign-in when session hydration fails', async ({ page }) => {
  let verificationRequests = 0;
  let hydrationRequests = 0;
  await page.route('**/api/auth/me', async (route) => {
    if (verificationRequests === 0) {
      await route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"anonymous"}' });
      return;
    }
    hydrationRequests += 1;
    await route.fulfill({
      status: hydrationRequests === 1 ? 500 : 200,
      contentType: 'application/json',
      body: hydrationRequests === 1
        ? JSON.stringify({ error: 'session unavailable' })
        : JSON.stringify({
          id: '00000000-0000-4000-8000-000000000001',
          email: 'director@example.com',
          firstName: 'Demo',
          lastName: 'Director',
          role: 'director',
        }),
    });
  });
  await page.route('**/api/auth/verify-magic-link', (route) => {
    verificationRequests += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' });
  });

  await mockDashboard(page);
  await page.goto('/verify?token=fabricated-valid-token');

  await expect(page.getByRole('heading', { name: 'Sign-in could not be completed' })).toBeVisible();
  await expect(page.getByText('Sign-in was verified, but the session could not be loaded. Try again.')).toBeVisible();
  await expect(page).toHaveURL(/\/verify\?token=/);
  expect(verificationRequests).toBe(1);

  await page.getByRole('button', { name: 'Retry session' }).click();
  await expect(page).toHaveURL('/dashboard');
  expect(verificationRequests).toBe(1);
  expect(hydrationRequests).toBe(2);
});

test('verified code retries only session hydration before navigating', async ({ page }) => {
  let verificationRequests = 0;
  let hydrationRequests = 0;
  await page.route('**/api/auth/setup-status', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: '{"needsSetup":false}',
  }));
  await page.route('**/api/auth/request-magic-link', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: '{}',
  }));
  await page.route('**/api/auth/verify-magic-link', (route) => {
    verificationRequests += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' });
  });
  await page.route('**/api/auth/me', async (route) => {
    if (verificationRequests === 0) {
      await route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"anonymous"}' });
      return;
    }
    hydrationRequests += 1;
    await route.fulfill({
      status: hydrationRequests === 1 ? 500 : 200,
      contentType: 'application/json',
      body: hydrationRequests === 1
        ? '{"error":"session unavailable"}'
        : JSON.stringify({
          id: '00000000-0000-4000-8000-000000000002',
          email: 'director@example.com', firstName: 'Demo', lastName: 'Director', role: 'director',
        }),
    });
  });

  await mockDashboard(page);
  await page.goto('/login');
  await page.getByLabel('Email address').fill('director@example.com');
  await page.getByRole('button', { name: 'Send sign-in link' }).click();
  await page.getByLabel('6-digit code').fill('123456');
  await page.getByRole('button', { name: 'Verify code' }).click();

  await expect(page.getByText('Sign-in was verified, but the session could not be loaded. Try again.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry session' })).toBeVisible();
  expect(verificationRequests).toBe(1);

  await page.getByRole('button', { name: 'Retry session' }).click();
  await expect(page).toHaveURL('/dashboard');
  expect(verificationRequests).toBe(1);
  expect(hydrationRequests).toBe(2);
});

test('late anonymous bootstrap cannot overwrite a newly verified session', async ({ page }) => {
  let verificationRequests = 0;
  const delayedBootstrapRequests: Array<Parameters<Parameters<typeof page.route>[1]>[0]> = [];

  await page.route('**/api/auth/me', async (route) => {
    if (verificationRequests === 0) {
      delayedBootstrapRequests.push(route);
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: '00000000-0000-4000-8000-000000000003',
        email: 'director@example.com', firstName: 'Demo', lastName: 'Director', role: 'director',
      }),
    });
  });
  await page.route('**/api/auth/verify-magic-link', (route) => {
    verificationRequests += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' });
  });
  await mockDashboard(page);
  await page.goto('/verify?token=fabricated-valid-token');
  await expect(page).toHaveURL('/dashboard');
  expect(verificationRequests).toBe(1);
  expect(delayedBootstrapRequests.length).toBeGreaterThan(0);

  await Promise.all(delayedBootstrapRequests.map((route) => route.fulfill({
    status: 401, contentType: 'application/json', body: '{"error":"anonymous"}',
  })));

  await expect(page).toHaveURL('/dashboard');
  await expect(page.getByText('Your session has expired. Please log in again.')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});
