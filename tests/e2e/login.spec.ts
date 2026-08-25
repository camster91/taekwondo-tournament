import { test, expect } from '@playwright/test';
import { loginAsEmail, loginAsDemo } from './helpers';

test.describe('login (magic link flow)', () => {
  test('magic-link OTP signs in a new user in dev mode', async ({ page }) => {
    const email = `e2e-${Date.now()}@example.com`;

    // Set up the response listener BEFORE the click that triggers the request.
    const magicLinkResponse = page.waitForResponse(
      (resp) =>
        resp.url().endsWith('/api/auth/request-magic-link') &&
        resp.request().method() === 'POST'
    );

    await page.goto('/login');
    // Brand was rebranded from "Martial Arts TM" → "bowin" (header mark).
    await expect(page.getByText(/^bowin$/i).first()).toBeVisible();

    // Email step
    await page.getByLabel('Email address').fill(email);
    await page.getByRole('button', { name: /Send sign-in link/i }).click();

    // Pull the 6-digit code from the API response (dev mode returns it).
    const response = await magicLinkResponse;
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.devMode).toBe(true);
    expect(body.code).toMatch(/^\d{6}$/);
    const code: string = body.code;

    // Verify the dev-mode UI surfaces the code (proves the React state is wired).
    const devCallout = page.locator('text=/Dev Mode.*Email Not Configured/i').first();
    await expect(devCallout).toBeVisible({ timeout: 10_000 });

    await page.getByLabel('6-digit code').fill(code);
    await page.getByRole('button', { name: /Verify code/i }).click();

    // A sign-in from the public marketing page must enter the authenticated
    // workspace, not loop back through the public homepage and login route.
    await page.waitForURL(/\/dashboard/, { timeout: 10_000 });

    // Auth is now cookie-based — the HttpOnly ashbi_token cookie is
    // set by the server and JS can't read it directly. Verify the
    // session is real by hitting /api/auth/me from the browser
    // context (the cookie auto-attaches for same-origin requests).
    const meResponse = await page.request.get('/api/auth/me');
    expect(meResponse.ok()).toBeTruthy();
    const me = await meResponse.json();
    expect(me.email).toBe(email);
    expect(me.role).toBeTruthy();
  });

  test('invalid 6-digit code shows an error and stays on the code step', async ({ page }) => {
    const email = `e2e-${Date.now()}@example.com`;

    await page.goto('/login');
    await page.getByLabel('Email address').fill(email);
    await page.getByRole('button', { name: /Send sign-in link/i }).click();

    // Wait for code step
    await expect(page.getByLabel('6-digit code')).toBeVisible({ timeout: 10_000 });

    // Type a wrong code (000000 is unlikely to be the real one)
    await page.getByLabel('6-digit code').fill('000000');
    await page.getByRole('button', { name: /Verify code/i }).click();

    // Error appears
    await expect(page.getByText(/Invalid or expired link\/code/i)).toBeVisible({ timeout: 5_000 });
    // Still on login
    expect(page.url()).toMatch(/\/login$/);
  });

  test('demo button is a one-click authenticated shortcut', async ({ page }) => {
    // The "Explore the live demo" button is a fast path: a 4-hour admin session
    // without email. This guards against that path regressing — the e2e
    // suite uses it as the standard auth for the heavier flows.
    await loginAsDemo(page);

    // Session is cookie-based — verify by hitting /api/auth/me.
    const meResponse = await page.request.get('/api/auth/me');
    expect(meResponse.ok()).toBeTruthy();
    const me = await meResponse.json();
    expect(me.role).toBe('admin');
  });
});
