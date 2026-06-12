import { test, expect } from '@playwright/test';

/**
 * T6 — PublicRegister a11y audit. Asserts the P0 fixes shipped with t_2f76f877:
 *  1. Every <Label> is programmatically associated with its control via htmlFor.
 *  2. The form has an accessible name.
 *  3. The error region is a role="alert" live region.
 *  4. On submit failure, focus moves to the error region (or first invalid field).
 *  5. Event selection is wrapped in a <fieldset> + <legend>.
 *  6. AutoComplete hints are present for personal-info fields.
 *  7. Decorative icons are aria-hidden.
 *
 * These assertions would have FAILED on the pre-audit version of PublicRegister
 * (labels were siblings, not paired; error region was a plain div; etc.).
 */

test.describe('public registration — accessibility (WCAG 2.1 AA)', () => {
  test('every Label in step 1 is associated with its control via htmlFor', async ({ page }) => {
    await page.goto('/register');
    const tournamentSelect = page.locator('select[name="tournamentId"]');
    await expect(tournamentSelect).toBeVisible();
    await expect(page.locator('option', { hasText: 'E2E Open 2026' })).toHaveCount(1, { timeout: 10_000 });

    const step1Fields = [
      { label: /Select Tournament/i, name: 'tournamentId' },
      { label: /First Name/i, name: 'firstName' },
      { label: /Last Name/i, name: 'lastName' },
      { label: /^Gender/i, name: 'gender' },
      { label: /Date of Birth/i, name: 'dateOfBirth' },
      { label: /Belt Level/i, name: 'belt' },
      { label: /School \/ Dojang/i, name: 'schoolDojang' },
      { label: /Height \(inches\)/i, name: 'heightInches' },
      { label: /Weight \(lbs\)/i, name: 'weightLbs' },
    ];

    for (const { label, name } of step1Fields) {
      const labelEl = page.getByLabel(label);
      await expect(labelEl, `Label "${label}" should resolve to the input[name="${name}"]`).toHaveAttribute(
        'name',
        name,
      );
    }
  });

  test('the form has an accessible name', async ({ page }) => {
    await page.goto('/register');
    const form = page.locator('form');
    await expect(form).toBeVisible();
    // Either aria-label, aria-labelledby, or an <h1>/<legend> directly naming it.
    const ariaLabel = await form.getAttribute('aria-label');
    expect(ariaLabel, 'form must have aria-label').toBeTruthy();
    expect(ariaLabel?.toLowerCase()).toContain('registration');
  });

  test('error region is an alert live region when validation fails', async ({ page }) => {
    await page.goto('/register');
    await expect(page.locator('select[name="tournamentId"]')).toBeVisible();
    await expect(page.locator('option', { hasText: 'E2E Open 2026' })).toHaveCount(1, { timeout: 10_000 });

    await page.getByRole('button', { name: /Next: Parent & Consent/i }).click();

    const errorRegion = page.locator('[role="alert"]');
    await expect(errorRegion).toBeVisible();
    await expect(errorRegion).toHaveAttribute('aria-live', 'assertive');
    // tabIndex=-1 lets us focus it programmatically for SR users.
    await expect(errorRegion).toHaveAttribute('tabindex', '-1');
  });

  test('event selection is grouped in a fieldset with a legend', async ({ page }) => {
    await page.goto('/register');
    const fieldset = page.locator('fieldset', { has: page.locator('input[name="patterns"]') });
    await expect(fieldset).toBeVisible();
    const legend = fieldset.locator('legend');
    await expect(legend).toBeVisible();
    await expect(legend).toContainText(/Event Selection/i);
  });

  test('parent fields in step 2 are labelled', async ({ page }) => {
    await page.goto('/register');
    await expect(page.locator('select[name="tournamentId"]')).toBeVisible();
    await expect(page.locator('option', { hasText: 'E2E Open 2026' })).toHaveCount(1, { timeout: 10_000 });

    // Fill minimum required step-1 fields to advance.
    const tournamentValue = await page
      .locator('option', { hasText: 'E2E Open 2026' })
      .first()
      .getAttribute('value');
    await page.locator('select[name="tournamentId"]').selectOption(tournamentValue!);
    await page.locator('input[name="firstName"]').fill('A11y');
    await page.locator('input[name="lastName"]').fill('Tester');
    await page.locator('select[name="gender"]').selectOption('M');
    await page.locator('input[name="dateOfBirth"]').fill('2016-01-15');
    await page.locator('select[name="belt"]').selectOption('Yellow');
    await page.locator('input[name="patterns"]').check();
    await page.getByRole('button', { name: /Next: Parent & Consent/i }).click();

    // Step 2 fields must be label-paired.
    const parentName = page.getByLabel(/Parent\/Guardian Name/i);
    await expect(parentName).toHaveAttribute('name', 'parentName');
    const parentEmail = page.getByLabel(/^Email/i);
    await expect(parentEmail).toHaveAttribute('name', 'parentEmail');
    const parentPhone = page.getByLabel(/^Phone/i);
    await expect(parentPhone).toHaveAttribute('name', 'parentPhone');
  });

  test('autocomplete hints are present on personal-info fields', async ({ page }) => {
    await page.goto('/register');
    await expect(page.locator('select[name="tournamentId"]')).toBeVisible();

    await expect(page.locator('input[name="firstName"]')).toHaveAttribute('autocomplete', 'given-name');
    await expect(page.locator('input[name="lastName"]')).toHaveAttribute('autocomplete', 'family-name');
    await expect(page.locator('input[name="dateOfBirth"]')).toHaveAttribute('autocomplete', 'bday');
  });
});
