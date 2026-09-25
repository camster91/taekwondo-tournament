import { test, expect } from '@playwright/test';
import { loginAsDemo, skipOnboardingTour } from './helpers';

/**
 * Slice 2 — 320px CSS pixel + 200% zoom/reflow tests (WCAG 2.2 SC 1.4.4, 1.4.10)
 *
 * These tests verify that critical user flows work correctly at extreme viewport
 * sizes and zoom levels:
 *
 * 1. **320px CSS pixel test** (WCAG 2.2 SC 1.4.10 Reflow):
 *    - Viewport: 320×568 (iPhone SE, smallest common mobile width)
 *    - No horizontal scroll required for any content
 *    - All interactive elements remain tappable (no overlapping buttons)
 *    - Primary CTAs ("Submit", "Confirm", "Record Result") remain visible and usable
 *
 * 2. **200% zoom test** (WCAG 2.2 SC 1.4.4 Resize Text):
 *    - Viewport: 1280×720 with deviceScaleFactor: 2 (simulates 200% browser zoom)
 *    - All text remains readable (no truncation, no overlapping)
 *    - Form fields remain usable (labels don't cover inputs)
 *    - Primary CTAs remain clickable (no z-index stacking bugs)
 */

test.describe('viewport 320px reflow tests', () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test('login at 320px: email field + buttons usable, no horizontal scroll', async ({ page }) => {
    await skipOnboardingTour(page);
    await page.goto('/login');

    // Check for horizontal scroll (should be none)
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(320);

    // Email field should be visible and usable
    const emailField = page.getByLabel('Email address');
    await expect(emailField).toBeVisible();
    await expect(emailField).toBeEnabled();

    // "Send sign-in link" button should be visible and clickable
    const sendButton = page.getByRole('button', { name: /Send sign-in link/i });
    await expect(sendButton).toBeVisible();
    await expect(sendButton).toBeEnabled();

    // Fill and submit should work
    await emailField.fill('320px-test@example.com');
    await sendButton.click();

    // Code input should appear
    await expect(page.getByLabel('6-digit code')).toBeVisible({ timeout: 10_000 });
  });

  test('public registration at 320px: 2-step form works, no horizontal scroll', async ({ page }) => {
    await page.goto('/register');

    // Wait for tournament list
    await expect(page.locator('option', { hasText: 'E2E Open 2026' })).toHaveCount(1, { timeout: 10_000 });

    // Check for horizontal scroll on step 1
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(320);

    // Fill step 1 fields (should all be visible and usable)
    const tournamentValue = await page
      .locator('option', { hasText: 'E2E Open 2026' })
      .first()
      .getAttribute('value');
    await page.locator('select[name="tournamentId"]').selectOption(tournamentValue!);
    await page.locator('input[name="firstName"]').fill('Mobile');
    await page.locator('input[name="lastName"]').fill('Tester');
    await page.locator('select[name="gender"]').selectOption('M');
    await page.locator('input[name="dateOfBirth"]').fill('2016-01-15');
    await page.locator('select[name="belt"]').selectOption('Yellow');
    await page.locator('input[name="patterns"]').check();

    // "Next: Parent & Consent" button should be visible
    const nextButton = page.getByRole('button', { name: /Next: Parent & Consent/i });
    await expect(nextButton).toBeVisible();
    await nextButton.click();

    // Step 2: Check for horizontal scroll
    const bodyWidth2 = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth2).toBeLessThanOrEqual(320);

    // Fill step 2 fields
    await page.getByLabel(/Parent\/Guardian Name/i).fill('Mobile Parent');
    await page.getByLabel(/^Email/i).fill('mobile-parent@example.com');
    await page.getByLabel(/^Phone/i).fill('555-1234');
    await page.locator('input[name="privacyAccepted"]').check();
    await page.locator('input[name="rulesAccepted"]').check();
    await page.locator('input[name="guardianAttested"]').check();

    // The form is now two steps (Athlete, Parent & Consent); step 2 submits
    // directly with "Complete Registration".
    const submitButton = page.getByRole('button', { name: /Complete Registration/i });
    await expect(submitButton).toBeVisible();
    await expect(submitButton).toBeEnabled();
    const bodyWidth3 = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth3).toBeLessThanOrEqual(320);
  });

  test('scorekeeper at 320px: division list + match scoring usable, no overlapping', async ({ page }) => {
    await loginAsDemo(page);

    // Navigate to scorekeeper
    await page.goto('/tournaments');
    const link = page.locator('a', { hasText: 'Spring Championship 2026' }).first();
    await expect(link).toBeVisible({ timeout: 10_000 });
    const href = await link.getAttribute('href');
    const tournamentId = href!.replace('/tournaments/', '');

    await page.goto(`/tournaments/${tournamentId}/scorekeeper`);
    await page.waitForLoadState('networkidle');

    // Check for horizontal scroll
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(320);

    // Division buttons should be visible and clickable
    const readyDivision = page
      .locator('button')
      .filter({ has: page.locator('text=/\\d+ ready/i') })
      .first();
    await expect(readyDivision).toBeVisible();
    await readyDivision.click();

    // Match scoring view: check for horizontal scroll
    const bodyWidth2 = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth2).toBeLessThanOrEqual(320);

    // Competitor buttons should not overlap
    const competitorButtons = page.locator('button[aria-pressed][aria-label*="select as winner"]');
    const button1Box = await competitorButtons.first().boundingBox();
    const button2Box = await competitorButtons.nth(1).boundingBox();

    expect(button1Box).not.toBeNull();
    expect(button2Box).not.toBeNull();

    // Buttons should not overlap (check y-coordinates)
    const overlap =
      (button1Box!.y < button2Box!.y + button2Box!.height) &&
      (button1Box!.y + button1Box!.height > button2Box!.y);
    if (overlap) {
      // If they overlap vertically, they should be side-by-side (different x)
      expect(Math.abs(button1Box!.x - button2Box!.x)).toBeGreaterThan(10);
    }

    // "Record Result" button should be visible
    await competitorButtons.first().click();
    await page.locator('#scorekeeper-score1').fill('5');
    await page.locator('#scorekeeper-score2').fill('2');
    const recordButton = page.getByRole('button', { name: /^Record Result$/i });
    await expect(recordButton).toBeVisible();
  });

  test('check-in at 320px: search bar + competitor list usable', async ({ page }) => {
    await loginAsDemo(page);

    // Navigate to check-in
    await page.goto('/tournaments');
    const link = page.locator('a', { hasText: 'Spring Championship 2026' }).first();
    await expect(link).toBeVisible({ timeout: 10_000 });
    const href = await link.getAttribute('href');
    const tournamentId = href!.replace('/tournaments/', '');

    await page.goto(`/tournaments/${tournamentId}/checkin`);
    await page.waitForLoadState('networkidle');

    // Check for horizontal scroll
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(320);

    // Search input should be visible and usable
    const searchInput = page.getByLabel('Search competitors by name or school'); // check-in search matches name/school only
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toBeEnabled();

    // "Check In" buttons should be visible and clickable
    // Each row offers "Check In", or "Undo" once the athlete is checked in
    // (earlier specs check the seeded athletes in).
    const checkInButton = page.getByRole('button', { name: /^(Check In|Undo)$/ }).first();
    await expect(checkInButton).toBeVisible();
  });

  test('tournament settings at 320px: tabs + form fields usable', async ({ page }) => {
    await loginAsDemo(page);

    // Navigate to tournament settings
    await page.goto('/tournaments');
    const link = page.locator('a', { hasText: 'Spring Championship 2026' }).first();
    await expect(link).toBeVisible({ timeout: 10_000 });
    const href = await link.getAttribute('href');
    const tournamentId = href!.replace('/tournaments/', '');

    await page.goto(`/tournaments/${tournamentId}/settings`);
    await page.waitForLoadState('networkidle');

    // Check for horizontal scroll
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(320);

    // Settings sections are Setup / Categorization + Brackets / Branding tabs.
    const settingsTab = page.getByRole('tab', { name: /^Setup/i });
    await expect(settingsTab).toBeVisible();

    // Form fields should be visible and usable (name/date live on the
    // tournament page, not in settings)
    const thresholdInput = page.getByLabel('Division split threshold');
    await expect(thresholdInput).toBeVisible();
    await expect(thresholdInput).toBeEnabled();

    // Save button should be visible (icon-only but named on phones)
    const saveButton = page.getByRole('button', { name: 'Save Settings' });
    await expect(saveButton).toBeVisible();
  });
});

test.describe('200% zoom tests', () => {
  test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });

  test('login at 200% zoom: fields + buttons readable, no overlapping', async ({ page }) => {
    await skipOnboardingTour(page);
    await page.goto('/login');

    // Email field should be visible and not overlapped by other elements
    const emailField = page.getByLabel('Email address');
    await expect(emailField).toBeVisible();

    const emailBox = await emailField.boundingBox();
    expect(emailBox).not.toBeNull();
    expect(emailBox!.width).toBeGreaterThan(100); // Should have reasonable width

    // "Send sign-in link" button should be visible and clickable
    const sendButton = page.getByRole('button', { name: /Send sign-in link/i });
    await expect(sendButton).toBeVisible();

    const buttonBox = await sendButton.boundingBox();
    expect(buttonBox).not.toBeNull();
    expect(buttonBox!.height).toBeGreaterThan(20); // Should have reasonable height

    // Fill and submit should work
    await emailField.fill('zoom-test@example.com');
    await sendButton.click();

    // Code input should appear and be usable
    const codeInput = page.getByLabel('6-digit code');
    await expect(codeInput).toBeVisible({ timeout: 10_000 });
  });

  test('public registration at 200% zoom: both steps readable, CTAs clickable', async ({ page }) => {
    await page.goto('/register');

    // Wait for tournament list
    await expect(page.locator('option', { hasText: 'E2E Open 2026' })).toHaveCount(1, { timeout: 10_000 });

    // Fill step 1
    const tournamentValue = await page
      .locator('option', { hasText: 'E2E Open 2026' })
      .first()
      .getAttribute('value');
    await page.locator('select[name="tournamentId"]').selectOption(tournamentValue!);
    await page.locator('input[name="firstName"]').fill('Zoom');
    await page.locator('input[name="lastName"]').fill('Tester');
    await page.locator('select[name="gender"]').selectOption('M');
    await page.locator('input[name="dateOfBirth"]').fill('2016-01-15');
    await page.locator('select[name="belt"]').selectOption('Yellow');
    await page.locator('input[name="patterns"]').check();

    // "Next: Parent & Consent" button should be visible and clickable
    const nextButton = page.getByRole('button', { name: /Next: Parent & Consent/i });
    await expect(nextButton).toBeVisible();

    const nextBox = await nextButton.boundingBox();
    expect(nextBox).not.toBeNull();
    expect(nextBox!.width).toBeGreaterThan(50);

    await nextButton.click();

    // Step 2: Form fields should not overlap
    const parentNameInput = page.getByLabel(/Parent\/Guardian Name/i);
    await expect(parentNameInput).toBeVisible();

    const parentEmailInput = page.getByLabel(/^Email/i);
    await expect(parentEmailInput).toBeVisible();

    // The fields must not overlap. At 1280 CSS px they sit side by side in a
    // two-column grid, so compare both axes rather than assuming a stack.
    const nameBox = await parentNameInput.boundingBox();
    const emailBox = await parentEmailInput.boundingBox();
    expect(nameBox).not.toBeNull();
    expect(emailBox).not.toBeNull();
    const separatedVertically = emailBox!.y >= nameBox!.y + nameBox!.height - 5 || nameBox!.y >= emailBox!.y + emailBox!.height - 5;
    const separatedHorizontally = emailBox!.x >= nameBox!.x + nameBox!.width - 5 || nameBox!.x >= emailBox!.x + emailBox!.width - 5;
    expect(separatedVertically || separatedHorizontally).toBe(true);
  });

  test('scorekeeper at 200% zoom: competitor cards readable, score inputs usable', async ({ page }) => {
    await loginAsDemo(page);

    // Navigate to scorekeeper
    await page.goto('/tournaments');
    const link = page.locator('a', { hasText: 'Spring Championship 2026' }).first();
    await expect(link).toBeVisible({ timeout: 10_000 });
    const href = await link.getAttribute('href');
    const tournamentId = href!.replace('/tournaments/', '');

    await page.goto(`/tournaments/${tournamentId}/scorekeeper`);
    await page.waitForLoadState('networkidle');

    // Division buttons should be visible
    const readyDivision = page
      .locator('button')
      .filter({ has: page.locator('text=/\\d+ ready/i') })
      .first();
    await expect(readyDivision).toBeVisible();
    await readyDivision.click();

    // Competitor buttons should be visible and not overlapped
    const competitorButtons = page.locator('button[aria-pressed][aria-label*="select as winner"]');
    await expect(competitorButtons.first()).toBeVisible();

    const button1Box = await competitorButtons.first().boundingBox();
    expect(button1Box).not.toBeNull();
    expect(button1Box!.width).toBeGreaterThan(50);

    // Score inputs should be visible and usable
    await competitorButtons.first().click();
    const score1Input = page.locator('#scorekeeper-score1');
    const score2Input = page.locator('#scorekeeper-score2');
    await expect(score1Input).toBeVisible();
    await expect(score2Input).toBeVisible();

    const score1Box = await score1Input.boundingBox();
    expect(score1Box).not.toBeNull();
    expect(score1Box!.width).toBeGreaterThan(30);
  });

  test('check-in at 200% zoom: search + competitor list readable', async ({ page }) => {
    await loginAsDemo(page);

    // Navigate to check-in
    await page.goto('/tournaments');
    const link = page.locator('a', { hasText: 'Spring Championship 2026' }).first();
    await expect(link).toBeVisible({ timeout: 10_000 });
    const href = await link.getAttribute('href');
    const tournamentId = href!.replace('/tournaments/', '');

    await page.goto(`/tournaments/${tournamentId}/checkin`);
    await page.waitForLoadState('networkidle');

    // Search input should be visible and usable
    const searchInput = page.getByLabel('Search competitors by name or school'); // check-in search matches name/school only
    await expect(searchInput).toBeVisible();

    const searchBox = await searchInput.boundingBox();
    expect(searchBox).not.toBeNull();
    expect(searchBox!.width).toBeGreaterThan(100);

    // "Check In" buttons should be visible
    // Each row offers "Check In", or "Undo" once the athlete is checked in
    // (earlier specs check the seeded athletes in).
    const checkInButton = page.getByRole('button', { name: /^(Check In|Undo)$/ }).first();
    await expect(checkInButton).toBeVisible();
  });

  test('tournament settings at 200% zoom: tabs + save button visible', async ({ page }) => {
    await loginAsDemo(page);

    // Navigate to tournament settings
    await page.goto('/tournaments');
    const link = page.locator('a', { hasText: 'Spring Championship 2026' }).first();
    await expect(link).toBeVisible({ timeout: 10_000 });
    const href = await link.getAttribute('href');
    const tournamentId = href!.replace('/tournaments/', '');

    await page.goto(`/tournaments/${tournamentId}/settings`);
    await page.waitForLoadState('networkidle');

    // Settings sections are Setup / Categorization + Brackets / Branding tabs.
    const settingsTab = page.getByRole('tab', { name: /^Setup/i });
    await expect(settingsTab).toBeVisible();

    // Form fields should be visible
    await expect(page.getByLabel('Division split threshold')).toBeVisible();

    // Save button should be visible and clickable
    const saveButton = page.getByRole('button', { name: 'Save Settings' });
    await expect(saveButton).toBeVisible();

    const saveBox = await saveButton.boundingBox();
    expect(saveBox).not.toBeNull();
    expect(saveBox!.width).toBeGreaterThan(40);
  });
});
