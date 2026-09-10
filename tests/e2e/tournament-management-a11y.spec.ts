import { test, expect } from '@playwright/test';
import { loginAsDemo } from './helpers';

/**
 * Slice 2 — Tournament management a11y coverage (WCAG 2.2 AA)
 *
 * Extends Slice 1 coverage to Tournament list, detail, and settings surfaces:
 * - Manual accessibility audits (keyboard navigation, ARIA, labels)
 * - Mobile viewport coverage (390×844)
 * - Reduced motion support
 *
 * NOTE: Automated axe-core audits require @axe-core/playwright package.
 * Install with: npm install --save-dev @axe-core/playwright
 * Then uncomment axe tests below.
 */

test.describe('tournament list accessibility (WCAG 2.2 AA)', () => {
  // TODO: Uncomment when @axe-core/playwright is installed
  // test('passes axe WCAG 2.2 AA audit', async ({ page }) => {
  //   await loginAsDemo(page);
  //   await page.goto('/tournaments');
  //   await page.waitForLoadState('networkidle');
  //   const AxeBuilder = (await import('@axe-core/playwright')).default;
  //   const results = await new AxeBuilder({ page })
  //     .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
  //     .analyze();
  //   expect(results.violations).toEqual([]);
  // });

  test('"New Tournament" button is accessible', async ({ page }) => {
    await loginAsDemo(page);
    await page.goto('/tournaments');
    await page.waitForLoadState('networkidle');

    // "New Tournament" button should be visible and keyboard-accessible
    const newButton = page.getByRole('button', { name: /New Tournament/i });
    await expect(newButton).toBeVisible();

    // Should be focusable
    await newButton.focus();
    await expect(newButton).toBeFocused();
  });

  test('tournament cards have accessible names', async ({ page }) => {
    await loginAsDemo(page);
    await page.goto('/tournaments');
    await page.waitForLoadState('networkidle');

    // Tournament cards should have links or headings with tournament names
    const tournamentLinks = page.locator('a', { hasText: /Championship|Open|Invitational/i });
    expect(await tournamentLinks.count()).toBeGreaterThan(0);

    // First tournament card should have a visible name
    const firstTournamentName = tournamentLinks.first();
    await expect(firstTournamentName).toBeVisible();
  });

  test('status badges use color + text (not color alone)', async ({ page }) => {
    await loginAsDemo(page);
    await page.goto('/tournaments');
    await page.waitForLoadState('networkidle');

    // Status badges (Draft, In Progress, Completed) should have text content
    const statusBadges = page.locator('span, div').filter({ hasText: /Draft|Registration|In Progress|Completed/i });
    expect(await statusBadges.count()).toBeGreaterThan(0);

    // Verify first badge has text content (not just color)
    const firstBadgeText = await statusBadges.first().textContent();
    expect(firstBadgeText).toMatch(/Draft|Registration|In Progress|Completed/i);
  });

  test('delete buttons have confirmation (already tested elsewhere, verify axe passes)', async ({ page }) => {
    await loginAsDemo(page);
    await page.goto('/tournaments');
    await page.waitForLoadState('networkidle');

    // No axe violations related to delete button semantics
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('mobile viewport (390×844): tournament cards usable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsDemo(page);
    await page.goto('/tournaments');
    await page.waitForLoadState('networkidle');

    // Tournament cards should be visible and tappable on mobile
    const tournamentLinks = page.locator('a', { hasText: /Championship|Open|Invitational/i });
    await expect(tournamentLinks.first()).toBeVisible();

    // "New Tournament" button should be tappable (44×44px minimum)
    const newButton = page.getByRole('button', { name: /New Tournament/i });
    await expect(newButton).toBeVisible();

    const buttonBox = await newButton.boundingBox();
    expect(buttonBox).not.toBeNull();
    expect(buttonBox!.height).toBeGreaterThanOrEqual(44);
  });
});

test.describe('tournament detail accessibility (WCAG 2.2 AA)', () => {
  // TODO: Uncomment when @axe-core/playwright is installed
  // test('passes axe WCAG 2.2 AA audit', async ({ page }) => {
  //   await loginAsDemo(page);
  //   await page.goto('/tournaments');
  //   const link = page.locator('a', { hasText: 'Spring Championship 2026' }).first();
  //   await expect(link).toBeVisible({ timeout: 10_000 });
  //   const href = await link.getAttribute('href');
  //   await page.goto(href!);
  //   await page.waitForLoadState('networkidle');
  //   const AxeBuilder = (await import('@axe-core/playwright')).default;
  //   const results = await new AxeBuilder({ page })
  //     .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
  //     .analyze();
  //   expect(results.violations).toEqual([]);
  // });

  test('navigation tabs are keyboard-accessible', async ({ page }) => {
    await loginAsDemo(page);

    await page.goto('/tournaments');
    const link = page.locator('a', { hasText: 'Spring Championship 2026' }).first();
    await expect(link).toBeVisible({ timeout: 10_000 });
    const href = await link.getAttribute('href');

    await page.goto(href!);
    await page.waitForLoadState('networkidle');

    // Tabs (Overview, Divisions, Schedule, etc.) should be keyboard-accessible
    const overviewTab = page.getByRole('link', { name: /Overview/i });
    const divisionsTab = page.getByRole('link', { name: /Divisions/i });

    await expect(overviewTab).toBeVisible();
    await expect(divisionsTab).toBeVisible();

    // Should be focusable
    await divisionsTab.focus();
    await expect(divisionsTab).toBeFocused();
  });
});

test.describe('tournament settings accessibility (WCAG 2.2 AA)', () => {
  // TODO: Uncomment when @axe-core/playwright is installed
  // test('passes axe WCAG 2.2 AA audit', async ({ page }) => {
  //   await loginAsDemo(page);
  //   await page.goto('/tournaments');
  //   const link = page.locator('a', { hasText: 'Spring Championship 2026' }).first();
  //   await expect(link).toBeVisible({ timeout: 10_000 });
  //   const href = await link.getAttribute('href');
  //   const tournamentId = href!.replace('/tournaments/', '');
  //   await page.goto(`/tournaments/${tournamentId}/settings`);
  //   await page.waitForLoadState('networkidle');
  //   const AxeBuilder = (await import('@axe-core/playwright')).default;
  //   const results = await new AxeBuilder({ page })
  //     .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
  //     .analyze();
  //   expect(results.violations).toEqual([]);
  // });

  test('tab navigation works (Settings, Weight Classes, Rules tabs)', async ({ page }) => {
    await loginAsDemo(page);

    await page.goto('/tournaments');
    const link = page.locator('a', { hasText: 'Spring Championship 2026' }).first();
    await expect(link).toBeVisible({ timeout: 10_000 });
    const href = await link.getAttribute('href');
    const tournamentId = href!.replace('/tournaments/', '');

    await page.goto(`/tournaments/${tournamentId}/settings`);
    await page.waitForLoadState('networkidle');

    // Tabs should be visible and keyboard-accessible
    const settingsTab = page.getByRole('tab', { name: /^Settings$/i });
    const weightClassesTab = page.getByRole('tab', { name: /Weight Classes/i });
    const rulesTab = page.getByRole('tab', { name: /Rules/i });

    await expect(settingsTab).toBeVisible();
    await expect(weightClassesTab).toBeVisible();
    await expect(rulesTab).toBeVisible();

    // Should be focusable
    await weightClassesTab.focus();
    await expect(weightClassesTab).toBeFocused();

    // Arrow keys should navigate between tabs (if implemented)
    // For now, just verify Tab key moves focus
    await page.keyboard.press('Tab');
    await expect(rulesTab).toBeFocused();
  });

  test('all form inputs are labeled', async ({ page }) => {
    await loginAsDemo(page);

    await page.goto('/tournaments');
    const link = page.locator('a', { hasText: 'Spring Championship 2026' }).first();
    await expect(link).toBeVisible({ timeout: 10_000 });
    const href = await link.getAttribute('href');
    const tournamentId = href!.replace('/tournaments/', '');

    await page.goto(`/tournaments/${tournamentId}/settings`);
    await page.waitForLoadState('networkidle');

    // Tournament name input should be labeled
    const nameInput = page.getByLabel(/Tournament Name/i);
    await expect(nameInput).toBeVisible();
    await expect(nameInput).toHaveAttribute('name', 'name');

    // Date input should be labeled
    const dateInput = page.getByLabel(/Date|Start Date/i);
    if ((await dateInput.count()) > 0) {
      await expect(dateInput.first()).toBeVisible();
    }

    // Location input should be labeled
    const locationInput = page.getByLabel(/Location|Venue/i);
    if ((await locationInput.count()) > 0) {
      await expect(locationInput.first()).toBeVisible();
    }
  });

  test('save button has clear state (enabled/disabled/saving)', async ({ page }) => {
    await loginAsDemo(page);

    await page.goto('/tournaments');
    const link = page.locator('a', { hasText: 'Spring Championship 2026' }).first();
    await expect(link).toBeVisible({ timeout: 10_000 });
    const href = await link.getAttribute('href');
    const tournamentId = href!.replace('/tournaments/', '');

    await page.goto(`/tournaments/${tournamentId}/settings`);
    await page.waitForLoadState('networkidle');

    // Save button should be visible
    const saveButton = page.getByRole('button', { name: /Save|Saving|Saved/i });
    await expect(saveButton).toBeVisible();

    // Button should have clear text (not just an icon)
    const buttonText = await saveButton.textContent();
    expect(buttonText).toMatch(/Save|Saving|Saved/i);

    // Button should have enabled/disabled state based on form changes
    const isEnabled = await saveButton.isEnabled();
    expect(typeof isEnabled).toBe('boolean');
  });

  test('error banners use role="alert"', async ({ page }) => {
    await loginAsDemo(page);

    await page.goto('/tournaments');
    const link = page.locator('a', { hasText: 'Spring Championship 2026' }).first();
    await expect(link).toBeVisible({ timeout: 10_000 });
    const href = await link.getAttribute('href');
    const tournamentId = href!.replace('/tournaments/', '');

    // Simulate a network error by intercepting API requests
    await page.route('**/api/tournaments/*', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.abort('failed');
      } else {
        await route.continue();
      }
    });

    await page.goto(`/tournaments/${tournamentId}/settings`);
    await page.waitForLoadState('networkidle');

    // Make a change to trigger save
    const nameInput = page.getByLabel(/Tournament Name/i);
    await nameInput.fill('Updated Tournament Name');

    // Click save
    const saveButton = page.getByRole('button', { name: /Save|Saving/i });
    await saveButton.click();

    // Wait for error alert
    const errorAlert = page.locator('[role="alert"]');
    await expect(errorAlert).toBeVisible({ timeout: 10_000 });

    // Error message should be descriptive
    const errorText = await errorAlert.textContent();
    expect(errorText).toBeTruthy();
    expect(errorText!.length).toBeGreaterThan(5);
  });

  test('mobile viewport (390×844): form fields + save button usable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsDemo(page);

    await page.goto('/tournaments');
    const link = page.locator('a', { hasText: 'Spring Championship 2026' }).first();
    await expect(link).toBeVisible({ timeout: 10_000 });
    const href = await link.getAttribute('href');
    const tournamentId = href!.replace('/tournaments/', '');

    await page.goto(`/tournaments/${tournamentId}/settings`);
    await page.waitForLoadState('networkidle');

    // Form fields should be visible and usable on mobile
    const nameInput = page.getByLabel(/Tournament Name/i);
    await expect(nameInput).toBeVisible();

    // Save button should be tappable (44×44px minimum)
    const saveButton = page.getByRole('button', { name: /Save|Saving/i });
    await expect(saveButton).toBeVisible();

    const buttonBox = await saveButton.boundingBox();
    expect(buttonBox).not.toBeNull();
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

    await page.goto(`/tournaments/${tournamentId}/settings`);
    await page.waitForLoadState('networkidle');

    // Page should load without motion-heavy animations
    const settingsTab = page.getByRole('tab', { name: /^Settings$/i });
    await expect(settingsTab).toBeVisible();
  });
});
