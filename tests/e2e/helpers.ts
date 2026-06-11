import type { Page } from '@playwright/test';

/**
 * Helper: log in via the real magic-link OTP flow in dev mode.
 *
 * The dev server returns `{ devMode: true, magicUrl, code }` from
 * POST /api/auth/request-magic-link when MAILGUN_API_KEY isn't set (which
 * is the case for `npm run dev` in a clean checkout). We intercept the
 * network response to read the code — this is more robust than scraping
 * the DOM, and it tests the same UX path a human goes through.
 */
export async function loginAsEmail(page: Page, email: string) {
  // Set up the response listener BEFORE the click that triggers the request.
  const magicLinkResponse = page.waitForResponse(
    (resp) =>
      resp.url().endsWith('/api/auth/request-magic-link') &&
      resp.request().method() === 'POST'
  );

  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: /Send sign-in link/i }).click();

  const response = await magicLinkResponse;
  if (!response.ok()) {
    throw new Error(`request-magic-link failed: ${response.status()} ${await response.text()}`);
  }
  const body = await response.json();
  if (!body.devMode || !body.code) {
    throw new Error(`Expected devMode + code in response, got: ${JSON.stringify(body)}`);
  }
  const code: string = body.code;

  // Wait for the dev-mode code UI to be visible (proves the React state updated).
  await expectDevModeCodeVisible(page, code);

  await page.getByLabel('6-digit code').fill(code);
  await page.getByRole('button', { name: /Verify code/i }).click();

  // Login redirects to "/" on success.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 10_000 });
}

/**
 * Helper: log in via the one-click "Try the demo" button. Faster than the
 * OTP flow, used for tests that need an authenticated session but aren't
 * specifically about the login UX (e.g. tournament create, check-in).
 */
export async function loginAsDemo(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: /Try the demo/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });
}

async function expectDevModeCodeVisible(page: Page, code: string) {
  // The dev-mode callout has the heading "Dev Mode — Email Not Configured".
  // Inside the callout, the code is rendered in a 6-char mono block. We
  // locate it by anchoring on the callout's heading first to scope the search.
  const callout = page.locator('div', { hasText: /Dev Mode.*Email Not Configured/i }).first();
  await callout.waitFor({ state: 'visible', timeout: 10_000 });

  // The code element uses class "font-mono" + "tracking-[0.3em]". Use a
  // data attribute or just find a 6-digit text inside the callout.
  const codeLocator = callout.locator(`text=/^\\s*${code}\\s*$/`);
  await codeLocator.waitFor({ state: 'visible', timeout: 5_000 });
}
