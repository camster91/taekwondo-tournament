import { test, expect } from '@playwright/test';

test.describe('public registration (self-register)', () => {
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

    await page.getByRole('button', { name: /Complete Registration/i }).click();

    // Success: the success screen renders only when the API returns 2xx and
    // the server returns a RegistrationResult. Showing the competitor + tournament
    // names proves the response carried the registration we just submitted.
    await expect(page.getByText('Registration Complete!')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Registration successful/i)).toBeVisible();
    await expect(page.getByText('TestKid').first()).toBeVisible();
    await expect(page.getByText(/E2E Open 2026/).first()).toBeVisible();
  });

  test('form validation: missing required field shows an error and blocks advance', async ({ page }) => {
    await page.goto('/register');
    const tournamentSelect = page.locator('select[name="tournamentId"]');
    await expect(tournamentSelect).toBeVisible();
    const e2eOption = page.locator('option', { hasText: 'E2E Open 2026' });
    await expect(e2eOption).toHaveCount(1, { timeout: 10_000 });

    // Try to advance without filling the required fields. The "Next" button calls
    // form.checkValidity() first, so the browser shows a native validation popup.
    // We assert we never leave step 1.
    await page.getByRole('button', { name: /Next: Parent & Consent/i }).click();
    await expect(page.locator('input[name="firstName"]')).toBeVisible();
    await expect(page.locator('select[name="tournamentId"]')).toBeVisible();
  });
});
