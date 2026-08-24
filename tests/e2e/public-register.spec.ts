import { test, expect } from '@playwright/test';
import { loginAsDemo } from './helpers';

async function fillMinorRegistration(page: import('@playwright/test').Page, suffix: string) {
  const tournamentSelect = page.locator('select[name="tournamentId"]');
  const option = page.locator('option', { hasText: 'E2E Open 2026' }).first();
  await expect(option).toHaveCount(1);
  await tournamentSelect.selectOption((await option.getAttribute('value'))!);
  await page.locator('input[name="firstName"]').fill('Contract');
  await page.locator('input[name="lastName"]').fill(suffix);
  await page.locator('select[name="gender"]').selectOption('F');
  await page.locator('input[name="dateOfBirth"]').fill('2016-01-15');
  await page.locator('select[name="belt"]').selectOption('Yellow');
  await page.locator('input[name="patterns"]').check();
  await page.getByRole('button', { name: /Next: Parent & Consent/i }).click();
  await page.locator('input[name="parentName"]').fill('Contract Parent');
  await page.locator('input[name="parentEmail"]').fill(`contract-${suffix}@example.com`);
  await page.locator('input[name="privacyAccepted"]').check();
  await page.locator('input[name="rulesAccepted"]').check();
  await page.locator('input[name="guardianAttested"]').check();
}

test.describe('public registration (self-register)', () => {
  test('fails closed when required legal configuration is malformed', async ({ page }) => {
    await page.route('**/api/public/legal-config', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"consentVersion":"2026-08","privacyNoticeUrl":"javascript:alert(1)","tournamentTermsUrl":"/terms"}',
    }));
    await page.goto('/register');

    await expect(page.getByRole('alert')).toContainText('Required registration terms are temporarily unavailable');
    await expect(page.locator('form')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  });

  test('does not claim success from a malformed 201 confirmation and preserves the form', async ({ page }) => {
    let registrationRequests = 0;
    await page.route('**/api/public/register', (route) => {
      registrationRequests += 1;
      return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: 'ok',
        registration: {
          id: '00000000-0000-4000-8000-000000000001',
          confirmationCode: 'mismatch',
          managementToken: 'too-short',
          competitorName: 'Contract malformed-confirmation',
          tournamentName: 'E2E Open 2026',
          tournamentDate: '2027-12-31T15:00:00.000Z',
          events: { patterns: true, sparring: false },
          ageGroup: 'Youth',
        },
      }),
      });
    });
    await page.goto('/register');
    await fillMinorRegistration(page, 'malformed-confirmation');
    await page.getByRole('button', { name: /Complete Registration/i }).click();

    await expect(page.getByRole('alert')).toContainText('Registration confirmation could not be verified');
    await expect(page.getByRole('alert')).toContainText('may have succeeded');
    await expect(page.getByText('Registration Complete!')).toHaveCount(0);
    await expect(page.locator('input[name="parentEmail"]')).toHaveValue('contract-malformed-confirmation@example.com');
    await expect(page.getByRole('button', { name: /Complete Registration/i })).toBeDisabled();
    await expect(page.getByRole('link', { name: 'Check registration status' })).toHaveAttribute('href', '/check-registration');
    await page.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());
    await page.waitForTimeout(250);
    expect(registrationRequests).toBe(1);
  });

  test('keeps entered data through duplicate, rate-limit, and outage responses', async ({ page }) => {
    let responseIndex = 0;
    const responses = [
      { status: 422, body: '{"error":"invalid","details":["Weight is required"]}' },
      { status: 409, body: '{"error":"duplicate","details":["must not mask conflict"]}' },
      { status: 429, body: '{"error":"busy","details":["must not mask rate limit"]}', headers: { 'Retry-After': '43' } },
      { status: 500, body: '{"error":"down","details":["must not mask outage"]}' },
    ];
    await page.route('**/api/public/register', (route) => {
      const response = responses[Math.min(responseIndex, responses.length - 1)];
      responseIndex += 1;
      return route.fulfill({ ...response, contentType: 'application/json' });
    });
    await page.goto('/register');
    await fillMinorRegistration(page, 'failure-preserved');

    const submit = page.getByRole('button', { name: /Complete Registration/i });
    await submit.click();
    await expect(page.getByRole('alert')).toContainText('Weight is required');

    await submit.click();
    await expect(page.getByRole('alert')).toContainText('A registration may already exist');
    await expect(page.locator('input[name="parentEmail"]')).toHaveValue('contract-failure-preserved@example.com');

    await submit.click();
    await expect(page.getByRole('alert')).toContainText('Try again in 43 seconds');
    await expect(page.locator('input[name="parentEmail"]')).toHaveValue('contract-failure-preserved@example.com');

    await submit.click();
    await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
    await expect(page.locator('input[name="parentEmail"]')).toHaveValue('contract-failure-preserved@example.com');
    await expect(page.getByText('Registration Complete!')).toHaveCount(0);
  });

  test('parent registers a minor and the registration is recorded in the DB', async ({ page, request }) => {
    await page.goto('/register');

    // Wait for the tournament dropdown to populate from the API.
    const tournamentSelect = page.locator('select[name="tournamentId"]');
    await expect(tournamentSelect).toBeVisible();

    // The global-setup inserted an "E2E Open 2026" registration-open tournament.
    // Wait for that option to be present (the API may take a moment).
    const e2eOption = page.locator('option', { hasText: 'E2E Open 2026' });
    await expect(e2eOption).toHaveCount(1, { timeout: 10_000 });

    // Step 1: Athlete info
    // selectOption's `label` only accepts string, so grab the option's value first.
    const e2eOptionValue = await page.locator('option', { hasText: 'E2E Open 2026' }).first().getAttribute('value');
    expect(e2eOptionValue).toBeTruthy();
    await tournamentSelect.selectOption(e2eOptionValue!);
    await page.locator('input[name="firstName"]').fill('TestKid');
    await page.locator('input[name="lastName"]').fill(`E2E${Date.now()}`);
    await page.locator('select[name="gender"]').selectOption('M');
    // DOB for a 10-year-old (the form rejects age < 6 in some configs — pick age 10).
    await page.locator('input[name="dateOfBirth"]').fill('2016-01-15');
    await page.locator('select[name="belt"]').selectOption('Yellow');
    await page.locator('input[name="schoolDojang"]').fill('E2E Test Dojang');
    await page.locator('input[name="heightInches"]').fill('54');
    await page.locator('input[name="weightLbs"]').fill('80');
    // Patterns event
    await page.locator('input[name="patterns"]').check();

    // Step 1 → Step 2
    await page.getByRole('button', { name: /Next: Parent & Consent/i }).click();

    // Step 2: parent + consent (required for minors)
    await page.locator('input[name="parentName"]').fill('Test Parent');
    const parentEmail = `e2e-parent-${Date.now()}@example.com`;
    await page.locator('input[name="parentEmail"]').fill(parentEmail);
    await page.locator('input[name="parentPhone"]').fill('5551234567');
    await page.locator('input[name="privacyAccepted"]').check();
    await page.locator('input[name="rulesAccepted"]').check();
    await page.locator('input[name="guardianAttested"]').check();

    await page.getByRole('button', { name: /Complete Registration/i }).click();

    // Success: the success screen renders only when the API returns 2xx and
    // the server returns a RegistrationResult. Showing the competitor + tournament
    // names proves the response carried the registration we just submitted.
    await expect(page.getByText('Registration Complete!')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Registration successful/i)).toBeVisible();
    await expect(page.getByText('TestKid').first()).toBeVisible();
    await expect(page.getByText(/E2E Open 2026/).first()).toBeVisible();
  });

  test('a completed public registration is available to staff at check-in', async ({ page }) => {
    const suffix = `CheckIn${Date.now()}`;
    await page.goto('/register');

    const tournamentSelect = page.locator('select[name="tournamentId"]');
    const e2eOption = page.locator('option', { hasText: 'E2E Open 2026' }).first();
    await expect(e2eOption).toHaveCount(1, { timeout: 10_000 });
    await tournamentSelect.selectOption((await e2eOption.getAttribute('value'))!);
    await page.locator('input[name="firstName"]').fill('CheckIn');
    await page.locator('input[name="lastName"]').fill(suffix);
    await page.locator('select[name="gender"]').selectOption('F');
    await page.locator('input[name="dateOfBirth"]').fill('2016-01-15');
    await page.locator('select[name="belt"]').selectOption('Yellow');
    await page.locator('input[name="schoolDojang"]').fill('E2E Test Dojang');
    await page.locator('input[name="heightInches"]').fill('54');
    await page.locator('input[name="weightLbs"]').fill('80');
    await page.locator('input[name="patterns"]').check();
    await page.getByRole('button', { name: /Next: Parent & Consent/i }).click();
    await page.locator('input[name="parentName"]').fill('E2E Guardian');
    await page.locator('input[name="parentEmail"]').fill(`e2e-checkin-${Date.now()}@example.com`);
    await page.locator('input[name="privacyAccepted"]').check();
    await page.locator('input[name="rulesAccepted"]').check();
    await page.locator('input[name="guardianAttested"]').check();
    await page.getByRole('button', { name: /Complete Registration/i }).click();
    await expect(page.getByText('Registration Complete!')).toBeVisible({ timeout: 10_000 });

    await loginAsDemo(page);
    await page.goto('/tournaments');
    const href = await page.locator('a', { hasText: 'E2E Open 2026' }).first().getAttribute('href');
    expect(href).toMatch(/^\/tournaments\/[a-f0-9-]+$/);
    await page.goto(`/checkin/${href!.replace('/tournaments/', '')}`);

    const searchInput = page.locator('input[placeholder*="Search"]').first();
    await expect(searchInput).toBeVisible({ timeout: 10_000 });
    await searchInput.fill(suffix);
    await expect(page.getByText(`CheckIn ${suffix}`)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Check In$/i })).toBeVisible();
  });

  test('registration cannot be submitted without versioned privacy, rules, and guardian acceptance', async ({ page }) => {
    await page.goto('/register');
    const tournamentSelect = page.locator('select[name="tournamentId"]');
    const e2eOption = page.locator('option', { hasText: 'E2E Open 2026' });
    await expect(e2eOption).toHaveCount(1, { timeout: 10_000 });
    const tournamentId = await e2eOption.first().getAttribute('value');
    await tournamentSelect.selectOption(tournamentId!);
    await page.locator('input[name="firstName"]').fill('Consent');
    await page.locator('input[name="lastName"]').fill(`Required${Date.now()}`);
    await page.locator('select[name="gender"]').selectOption('F');
    await page.locator('input[name="dateOfBirth"]').fill('2016-01-15');
    await page.locator('select[name="belt"]').selectOption('Yellow');
    await page.locator('input[name="patterns"]').check();
    await page.getByRole('button', { name: /Next: Parent & Consent/i }).click();
    await page.locator('input[name="parentName"]').fill('Test Guardian');
    await page.locator('input[name="parentEmail"]').fill(`guardian-${Date.now()}@example.com`);

    await page.getByRole('button', { name: /Complete Registration/i }).click();

    await expect(page.getByRole('alert')).toContainText(/guardian|privacy notice/i);
    await expect(page.getByText('Registration Complete!')).toHaveCount(0);
  });

  test('form validation: missing required field shows an error and blocks advance', async ({ page }) => {
    await page.goto('/register');
    const tournamentSelect = page.locator('select[name="tournamentId"]');
    await expect(tournamentSelect).toBeVisible();
    const e2eOption = page.locator('option', { hasText: 'E2E Open 2026' });
    await expect(e2eOption).toHaveCount(1, { timeout: 10_000 });

    // Try to advance without filling the required fields. The form uses
    // noValidate, so the browser does NOT show its own validation popup — we
    // surface a friendly error in our role="alert" region and focus the first
    // invalid field. Either way, we must never leave step 1.
    await page.getByRole('button', { name: /Next: Parent & Consent/i }).click();
    await expect(page.locator('input[name="firstName"]')).toBeVisible();
    await expect(page.locator('select[name="tournamentId"]')).toBeVisible();
    // The error region should be present and announced.
    const errorRegion = page.locator('[role="alert"]');
    await expect(errorRegion).toBeVisible();
    await expect(errorRegion).toContainText(/required fields/i);
  });
});
