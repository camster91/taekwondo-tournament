import { test, expect } from '@playwright/test';
import { checkA11y } from './axe-helper';

/**
 * Public Scoreboard a11y audit — WCAG 2.2 AA compliance for the public display.
 * The public scoreboard is a critical spectator-facing journey that must be
 * accessible without authentication.
 */

// Demo sessions may not mint public slugs (DEMO_CAPABILITY_DENIED), so use
// the fabricated showcase's published slug that global-setup installs.
async function getPublicSlug(_page: import('@playwright/test').Page): Promise<string | null> {
  return 'bowin-demo-live-championship';
}

test.describe('public scoreboard (a11y)', () => {
  test('public scoreboard renders with semantic HTML and is scannable', async ({ page }) => {
    const publicSlug = await getPublicSlug(page);
    expect(publicSlug).toBeTruthy();

    // Navigate to public scoreboard (no auth required)
    await page.goto(`/scoreboard/${publicSlug}`); // slug links live at /scoreboard/:publicSlug
    
    // Wait for content to load
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });

    const results = await checkA11y(page);
    expect(results.violations).toEqual([]);
  });

  test('public scoreboard has keyboard navigation', async ({ page }) => {
    const publicSlug = await getPublicSlug(page);
    expect(publicSlug).toBeTruthy();

    await page.goto(`/scoreboard/${publicSlug}`); // slug links live at /scoreboard/:publicSlug
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });

    // Tab through interactive elements (if any division/filter buttons exist)
    await page.keyboard.press('Tab');
    
    // Verify focus is visible (the focused element should have an outline or ring)
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const styles = window.getComputedStyle(el);
      return {
        tag: el.tagName,
        outline: styles.outline,
        boxShadow: styles.boxShadow,
      };
    });

    // Either outline or box-shadow (Tailwind ring) should be present
    if (focused && focused.tag !== 'BODY') {
      const hasFocusIndicator = 
        (focused.outline && focused.outline !== 'none' && focused.outline !== 'rgb(0, 0, 0) none 0px') ||
        (focused.boxShadow && focused.boxShadow !== 'none');
      expect(hasFocusIndicator).toBe(true);
    }
  });

  test('public scoreboard updates are announced to screen readers', async ({ page }) => {
    const publicSlug = await getPublicSlug(page);
    expect(publicSlug).toBeTruthy();

    await page.goto(`/scoreboard/${publicSlug}`); // slug links live at /scoreboard/:publicSlug
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });

    // Check for live region (aria-live) for dynamic bracket updates
    // The scoreboard should have a live region to announce match result changes
    const liveRegions = page.locator('[aria-live]');
    const count = await liveRegions.count();
    
    // At minimum, should have one live region for updates
    expect(count).toBeGreaterThanOrEqual(1);
  });
});
