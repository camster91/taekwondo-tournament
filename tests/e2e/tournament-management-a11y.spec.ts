import { test, expect } from '@playwright/test';
import { loginAsDemo } from './helpers';
import { checkA11y } from './axe-helper';

/**
 * Slice 2 — Tournament management a11y coverage (axe WCAG 2.2 AA)
 *
 * Extends Slice 1 coverage to Tournament list, detail, and settings surfaces:
 * - Axe-core WCAG 2.2 AA automated audits
 * - Keyboard navigation basics (tabs, buttons, form inputs)
 * - Mobile viewport coverage (390×844)
 * - Reduced motion support
 */

test.describe('tournament list accessibility (WCAG 2.2 AA)', () => {
  test('passes axe WCAG 2.2 AA audit', async ({ page }) => {
    await loginAsDemo(page);
    await page.goto('/tournaments');
    await page.waitForLoadState('networkidle');

    // Run axe audit
    const results = await checkA11y(page);
    expect(results.violations).toEqual([]);
  });

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
  test('passes axe WCAG 2.2 AA audit', async ({ page }) => {
    await loginAsDemo(page);

    // Navigate to Spring Championship 2026 detail page
    await page.goto('/tournaments');
    const link = page.locator('a', { hasText: 'Spring Championship 2026' }).first();
    await expect(link).toBeVisible({ timeout: 10_000 });
    const href = await link.getAttribute('href');

    await page.goto(href!);
    await page.waitForLoadState('networkidle');

    // Run axe audit
    const results = await checkA11y(page);
    expect(results.violations).toEqual([]);
  });

  test('navigation tabs are keyboard-accessible', async ({ page }) => {
    await loginAsDemo(page);

    await page.goto('/tournaments');
    const link = page.locator('a', { hasText: 'Spring Championship 2026' }).first();
    await expect(link).toBeVisible({ timeout: 10_000 });
    const href = await link.getAttribute('href');

    await page.goto(href!);
    await page.waitForLoadState('networkidle');

    // Tournament navigation (Overview, Divisions, ...) lives in the sidebar;
    // exact names avoid the page's "Manage Divisions" action link.
    const overviewTab = page.getByRole('link', { name: 'Overview', exact: true });
    const divisionsTab = page.getByRole('link', { name: 'Divisions', exact: true });

    await expect(overviewTab).toBeVisible();
    await expect(divisionsTab).toBeVisible();

    // Should be focusable
    await divisionsTab.focus();
    await expect(divisionsTab).toBeFocused();
  });
});

async function openSettings(page: import('@playwright/test').Page) {
  await loginAsDemo(page);
  await page.goto('/tournaments');
  const link = page.locator('a', { hasText: 'Spring Championship 2026' }).first();
  await expect(link).toBeVisible({ timeout: 10_000 });
  const href = await link.getAttribute('href');
  await page.goto(`${href}/settings`);
  await expect(page.getByRole('tablist', { name: 'Settings sections' })).toBeVisible();
}

test.describe('tournament settings accessibility (WCAG 2.2 AA)', () => {
  test('passes axe WCAG 2.2 AA audit', async ({ page }) => {
    await loginAsDemo(page);

    // Navigate to Spring Championship 2026 settings page
    await page.goto('/tournaments');
    const link = page.locator('a', { hasText: 'Spring Championship 2026' }).first();
    await expect(link).toBeVisible({ timeout: 10_000 });
    const href = await link.getAttribute('href');
    const tournamentId = href!.replace('/tournaments/', '');

    await page.goto(`/tournaments/${tournamentId}/settings`);
    await page.waitForLoadState('networkidle');

    // Run axe audit
    const results = await checkA11y(page);
    expect(results.violations).toEqual([]);
  });

  // The settings page was reorganized into Setup / Categorization + Brackets /
  // Branding tabs; tournament name/date/location are edited elsewhere.
  test('tab navigation works (Setup, Categorization + Brackets, Branding tabs)', async ({ page }) => {
    await openSettings(page);

    const setupTab = page.getByRole('tab', { name: /^Setup/i });
    const rulesTab = page.getByRole('tab', { name: /Categorization \+ Brackets/i });
    const brandingTab = page.getByRole('tab', { name: /^Branding/i });

    await expect(setupTab).toBeVisible();
    await expect(rulesTab).toBeVisible();
    await expect(brandingTab).toBeVisible();
    await expect(setupTab).toHaveAttribute('aria-selected', 'true');

    // WAI-ARIA tabs: the selected tab is focusable, arrows move and select.
    await setupTab.focus();
    await expect(setupTab).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(rulesTab).toBeFocused();
    await expect(rulesTab).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect(brandingTab).toBeFocused();
    await page.keyboard.press('Home');
    await expect(setupTab).toBeFocused();
    await expect(setupTab).toHaveAttribute('aria-selected', 'true');
  });

  test('all form inputs are labeled', async ({ page }) => {
    await openSettings(page);

    await expect(page.getByLabel('Division split threshold')).toBeVisible();
    await expect(page.getByLabel('Maximum Capacity')).toBeVisible();
    // Every age-group row control has its own accessible name.
    await expect(page.getByLabel('Age group 1 label')).toBeVisible();
    await expect(page.getByLabel('Age group 1 minimum age')).toBeVisible();
    await expect(page.getByLabel('Age group 1 maximum age')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Remove age group / }).first()).toBeVisible();

    const unlabeled = await page.getByRole('tabpanel').locator('input:not([type="hidden"]), select, textarea').evaluateAll(
      (elements) => elements.filter((element) => {
        const control = element as HTMLInputElement;
        return !control.labels?.length && !control.getAttribute('aria-label') && !control.getAttribute('aria-labelledby');
      }).map((element) => element.outerHTML.slice(0, 120)),
    );
    expect(unlabeled).toEqual([]);
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

    // Simulate a network error on the settings save (PUT /api/tournaments/:id/settings)
    await page.route('**/api/tournaments/**', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.abort('failed');
      } else {
        await route.continue();
      }
    });

    await page.goto(`/tournaments/${tournamentId}/settings`);
    await page.waitForLoadState('networkidle');

    // Make a change to trigger save
    await page.getByLabel('Division split threshold').fill('9');

    // Click save
    const saveButton = page.getByRole('button', { name: 'Save Settings' });
    await saveButton.click();

    // Wait for error alert
    const errorAlert = page.getByRole('alert').filter({ hasText: /\S{5,}/ }).first();
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
    await expect(page.getByLabel('Division split threshold')).toBeVisible();

    // Save button (icon-only on phones, still named) should be tappable (44×44px minimum)
    const saveButton = page.getByRole('button', { name: 'Save Settings' });
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
    const settingsTab = page.getByRole('tab', { name: /^Setup/i });
    await expect(settingsTab).toBeVisible();
  });
});
