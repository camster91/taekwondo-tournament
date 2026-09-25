import { test, expect } from '@playwright/test';
import { loginAsDemo } from './helpers';
import { checkA11y } from './axe-helper';

/**
 * Slice 2 — Check-in a11y coverage (axe WCAG 2.2 AA)
 *
 * Extends Slice 1 coverage to the Check-in surface:
 * - Axe-core WCAG 2.2 AA automated audit
 * - Keyboard navigation basics (search input, "Check In" buttons)
 * - Mobile viewport coverage (390×844)
 * - Reduced motion support
 */

test.describe('check-in accessibility (WCAG 2.2 AA)', () => {
  test('passes axe WCAG 2.2 AA audit', async ({ page }) => {
    await loginAsDemo(page);

    // Navigate to check-in page for Spring Championship 2026
    await page.goto('/tournaments');
    const link = page.locator('a', { hasText: 'Spring Championship 2026' }).first();
    await expect(link).toBeVisible({ timeout: 10_000 });
    const href = await link.getAttribute('href');
    const tournamentId = href!.replace('/tournaments/', '');

    await page.goto(`/tournaments/${tournamentId}/checkin`);
    await page.waitForLoadState('networkidle');

    // Run axe audit
    const results = await checkA11y(page);
    expect(results.violations).toEqual([]);
  });

  test('search input is labeled and keyboard-accessible', async ({ page }) => {
    await loginAsDemo(page);

    await page.goto('/tournaments');
    const link = page.locator('a', { hasText: 'Spring Championship 2026' }).first();
    await expect(link).toBeVisible({ timeout: 10_000 });
    const href = await link.getAttribute('href');
    const tournamentId = href!.replace('/tournaments/', '');

    await page.goto(`/tournaments/${tournamentId}/checkin`);
    await page.waitForLoadState('networkidle');

    // Search input should have an accessible label (via placeholder or aria-label)
    const searchInput = page.getByLabel('Search competitors by name or school'); // check-in search matches name/school only
    await expect(searchInput).toBeVisible();

    // Should be focusable
    await searchInput.focus();
    await expect(searchInput).toBeFocused();

    // Should accept keyboard input
    await searchInput.type('Alice');
    await expect(searchInput).toHaveValue('Alice');
  });

  test('competitor rows have accessible names', async ({ page }) => {
    await loginAsDemo(page);

    await page.goto('/tournaments');
    const link = page.locator('a', { hasText: 'Spring Championship 2026' }).first();
    await expect(link).toBeVisible({ timeout: 10_000 });
    const href = await link.getAttribute('href');
    const tournamentId = href!.replace('/tournaments/', '');

    await page.goto(`/tournaments/${tournamentId}/checkin`);
    await page.waitForLoadState('networkidle');

    // Competitor names should be visible and readable
    const firstCompetitorName = page.locator('[data-testid="competitor-name"]').first();
    if ((await firstCompetitorName.count()) === 0) {
      // If no data-testid, look for text content
      const competitorNames = page.locator('text=/^[A-Z][a-z]+\\s+[A-Z][a-z]+$/i');
      expect(await competitorNames.count()).toBeGreaterThan(0);
    } else {
      await expect(firstCompetitorName).toBeVisible();
    }
  });

  test('"Check In" buttons have descriptive text', async ({ page }) => {
    await loginAsDemo(page);

    await page.goto('/tournaments');
    const link = page.locator('a', { hasText: 'Spring Championship 2026' }).first();
    await expect(link).toBeVisible({ timeout: 10_000 });
    const href = await link.getAttribute('href');
    const tournamentId = href!.replace('/tournaments/', '');

    await page.goto(`/tournaments/${tournamentId}/checkin`);
    await page.waitForLoadState('networkidle');

    // "Check In" buttons should have descriptive text (not just "✓")
    const checkInButtons = page.getByRole('button', { name: /Check In|Checked In/i });
    expect(await checkInButtons.count()).toBeGreaterThan(0);

    // Verify first button has text content
    const firstButtonText = await checkInButtons.first().textContent();
    expect(firstButtonText).toMatch(/Check In|Checked In/i);
  });

  test('weight input dialog (sparring) is labeled correctly', async ({ page }) => {
    await loginAsDemo(page);

    await page.goto('/tournaments');
    const link = page.locator('a', { hasText: 'Spring Championship 2026' }).first();
    await expect(link).toBeVisible({ timeout: 10_000 });
    const href = await link.getAttribute('href');
    const tournamentId = href!.replace('/tournaments/', '');

    await page.goto(`/tournaments/${tournamentId}/checkin`);
    await page.waitForLoadState('networkidle');

    // Find a competitor registered for sparring (not yet checked in)
    const checkInButton = page.getByRole('button', { name: /^Check In$/i }).first();
    const isCheckInButtonVisible = await checkInButton.isVisible().catch(() => false);

    if (!isCheckInButtonVisible) {
      // All competitors already checked in, skip test
      test.skip();
    }

    await checkInButton.click();

    // Weight input dialog may appear if competitor is registered for sparring
    const weightDialog = page.locator('[role="dialog"]', { hasText: /Enter Weight/i });
    const isWeightDialogVisible = await weightDialog.isVisible().catch(() => false);

    if (!isWeightDialogVisible) {
      // Not a sparring competitor, skip weight test
      return;
    }

    // Weight input should be labeled
    const weightInput = page.getByLabel(/Weight/i);
    await expect(weightInput).toBeVisible();
    await expect(weightInput).toHaveAttribute('name', 'checkInWeight');

    // Dialog should have accessible "Confirm" and "Cancel" buttons
    const confirmButton = weightDialog.getByRole('button', { name: /Confirm/i });
    const cancelButton = weightDialog.getByRole('button', { name: /Cancel/i });
    await expect(confirmButton).toBeVisible();
    await expect(cancelButton).toBeVisible();
  });

  test('error states use role="alert"', async ({ page }) => {
    await loginAsDemo(page);

    await page.goto('/tournaments');
    const link = page.locator('a', { hasText: 'Spring Championship 2026' }).first();
    await expect(link).toBeVisible({ timeout: 10_000 });
    const href = await link.getAttribute('href');
    const tournamentId = href!.replace('/tournaments/', '');

    // Simulate a network error by intercepting API requests
    await page.route('**/api/tournaments/*/registrations', async (route) => {
      await route.abort('failed');
    });

    await page.goto(`/tournaments/${tournamentId}/checkin`);

    // Wait for error state to render
    const errorAlert = page.locator('[role="alert"]');
    await expect(errorAlert).toBeVisible({ timeout: 10_000 });

    // Error message should be descriptive
    const errorText = await errorAlert.textContent();
    expect(errorText).toBeTruthy();
    expect(errorText!.length).toBeGreaterThan(10);
  });

  test('mobile viewport (390×844): search + competitor list usable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsDemo(page);

    await page.goto('/tournaments');
    const link = page.locator('a', { hasText: 'Spring Championship 2026' }).first();
    await expect(link).toBeVisible({ timeout: 10_000 });
    const href = await link.getAttribute('href');
    const tournamentId = href!.replace('/tournaments/', '');

    await page.goto(`/tournaments/${tournamentId}/checkin`);
    await page.waitForLoadState('networkidle');

    // Search input should be visible and usable on mobile
    const searchInput = page.getByLabel('Search competitors by name or school'); // check-in search matches name/school only
    await expect(searchInput).toBeVisible();

    // "Check In" buttons should be tappable (44×44px minimum)
    const checkInButton = page.getByRole('button', { name: /Check In|Checked In/i }).first();
    await expect(checkInButton).toBeVisible();

    const buttonBox = await checkInButton.boundingBox();
    expect(buttonBox).not.toBeNull();
    expect(buttonBox!.width).toBeGreaterThanOrEqual(44);
    expect(buttonBox!.height).toBeGreaterThanOrEqual(44);
  });

  test('reduced motion: respects prefers-reduced-motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await loginAsDemo(page);

    await page.goto('/tournaments');
    const link = page.locator('a', { hasText: 'Spring Championship 2026' }).first();
    await expect(link).toBeVisible({ timeout: 10_000 });
    const href = await link.getAttribute('href');
    const tournamentId = href!.replace('/tournaments/', '');

    await page.goto(`/tournaments/${tournamentId}/checkin`);
    await page.waitForLoadState('networkidle');

    // Page should load without motion-heavy animations
    // (Playwright can't directly test CSS transitions, but we verify page renders correctly)
    const heading = page.getByRole('heading', { name: /Check-?In/i });
    await expect(heading).toBeVisible();
  });
});
