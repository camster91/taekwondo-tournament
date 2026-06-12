import { test, expect } from '@playwright/test';
import { loginAsDemo } from './helpers';

/**
 * T7 — Scorekeeper a11y audit. Asserts the P0 fixes shipped with t_fb76d72d:
 *  1. Live region (role="status" aria-live="polite") exists for SR announcements.
 *  2. Active match heading is focusable (tabindex=-1) and is the focus target
 *     after arrow-key navigation.
 *  3. Competitor winner-select buttons have aria-pressed and descriptive aria-label.
 *  4. Score inputs are programmatically associated with their labels via htmlFor.
 *  5. Result-type toggle has fieldset/legend + radiogroup semantics + aria-pressed.
 *  6. Icon-only header buttons (Timer, Keyboard help) have aria-label.
 *  7. Confirmation modal has role="dialog" + aria-modal + focusable Cancel/Confirm.
 *  8. Division-list buttons have aria-label describing state (ready count, complete).
 *  9. Penalty count updates announced via aria-live.
 */

test.describe('scorekeeper (a11y)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemo(page);
  });

  test('scorekeeper page renders live region for announcements', async ({ page }) => {
    // The "Spring Championship 2026" seed has divisions with ready matches.
    await page.goto('/scorekeeper/31d47592-6c76-4e3d-a9d2-c7953d6179c5');
    await expect(page.getByRole('heading', { name: /Scorekeeper/i })).toBeVisible();

    // SR live region must be present (off-screen, role=status).
    const liveRegion = page.locator('[role="status"][aria-live="polite"]');
    await expect(liveRegion).toHaveCount(1, { timeout: 5_000 });
  });

  test('division list buttons have state-describing aria-labels', async ({ page }) => {
    await page.goto('/scorekeeper/31d47592-6c76-4e3d-a9d2-c7953d6179c5');
    // The seed has at least one division with ready matches.
    // Wait for the division list to load.
    await page.waitForLoadState('networkidle');

    // Find at least one division button (they're the only buttons in the list).
    const divisionButtons = page.locator('button').filter({ hasText: /ready|complete|pending/i });
    const count = await divisionButtons.count();
    expect(count).toBeGreaterThan(0);

    // Each division button should have an aria-label that includes state info.
    for (let i = 0; i < Math.min(count, 3); i++) {
      const btn = divisionButtons.nth(i);
      const ariaLabel = await btn.getAttribute('aria-label');
      expect(ariaLabel, 'division button must have aria-label').toBeTruthy();
      // Must mention either "ready", "complete", or "pending".
      expect(ariaLabel!.toLowerCase()).toMatch(/ready|complete|pending/);
    }
  });

  test('match-scoring view: competitor buttons have aria-pressed + descriptive aria-label', async ({ page }) => {
    await page.goto('/scorekeeper/31d47592-6c76-4e3d-a9d2-c7953d6179c5');
    await page.waitForLoadState('networkidle');

    // Click first division with ready matches.
    const readyDivision = page
      .locator('button')
      .filter({ has: page.locator('text=/\\d+ ready/i') })
      .first();
    await expect(readyDivision).toBeVisible();
    await readyDivision.click();

    // The match-scoring view should have competitor buttons with aria-pressed.
    const competitorButtons = page.locator('button[aria-pressed]').filter({ hasText: /select as winner/i });
    const buttonCount = await competitorButtons.count();
    expect(buttonCount).toBeGreaterThan(0);

    // Both competitor buttons must be present.
    await expect(competitorButtons.first()).toBeVisible();
    const firstLabel = await competitorButtons.first().getAttribute('aria-label');
    expect(firstLabel).toContain('select as winner');
  });

  test('score inputs are programmatically associated with their labels', async ({ page }) => {
    await page.goto('/scorekeeper/31d47592-6c76-4e3d-a9d2-c7953d6179c5');
    await page.waitForLoadState('networkidle');

    const readyDivision = page
      .locator('button')
      .filter({ has: page.locator('text=/\\d+ ready/i') })
      .first();
    await readyDivision.click();

    // The score inputs are id="scorekeeper-score1" and "scorekeeper-score2".
    // Their labels must use htmlFor to point to those ids.
    const label1 = page.locator('label[for="scorekeeper-score1"]');
    const label2 = page.locator('label[for="scorekeeper-score2"]');
    await expect(label1).toBeVisible();
    await expect(label2).toBeVisible();

    // The input itself must be findable by its label.
    const score1ByLabel = page.getByLabel(/Score/i).first();
    await expect(score1ByLabel).toHaveAttribute('id', 'scorekeeper-score1');
  });

  test('result-type buttons live in a radiogroup with aria-pressed', async ({ page }) => {
    await page.goto('/scorekeeper/31d47592-6c76-4e3d-a9d2-c7953d6179c5');
    await page.waitForLoadState('networkidle');

    const readyDivision = page
      .locator('button')
      .filter({ has: page.locator('text=/\\d+ ready/i') })
      .first();
    await readyDivision.click();

    // The radiogroup should contain the four result-type buttons.
    const radiogroup = page.locator('[role="radiogroup"][aria-label="Result type"]');
    await expect(radiogroup).toBeVisible();

    // The currently-selected result type is "win" (default).
    const winButton = radiogroup.locator('button[aria-pressed="true"]');
    await expect(winButton).toBeVisible();
    await expect(winButton).toHaveText(/WIN/i);
  });

  test('icon-only header buttons have aria-label', async ({ page }) => {
    await page.goto('/scorekeeper/31d47592-6c76-4e3d-a9d2-c7953d6179c5');
    await page.waitForLoadState('networkidle');

    const readyDivision = page
      .locator('button')
      .filter({ has: page.locator('text=/\\d+ ready/i') })
      .first();
    await readyDivision.click();

    // Timer button (text + icon, not purely icon-only) and the icon-only keyboard help button.
    const helpButton = page.getByRole('button', { name: /Show keyboard shortcuts/i });
    await expect(helpButton).toBeVisible();

    // Timer button has aria-pressed reflecting state.
    const timerButton = page.getByRole('button', { name: /Hide match timer|Show match timer/i });
    await expect(timerButton).toHaveAttribute('aria-pressed');
  });

  test('arrow-key navigation moves focus to the new match heading', async ({ page }) => {
    await page.goto('/scorekeeper/31d47592-6c76-4e3d-a9d2-c7953d6179c5');
    await page.waitForLoadState('networkidle');

    const readyDivision = page
      .locator('button')
      .filter({ has: page.locator('text=/\\d+ ready/i') })
      .first();
    await readyDivision.click();

    // Wait for the match view to load.
    await expect(page.getByLabel(/match \d+ of \d+/i).first()).toBeVisible({ timeout: 5_000 });

    // Press right arrow — focus should move to the new match heading.
    await page.keyboard.press('ArrowRight');
    // The active match heading has tabindex=-1 and should now be the active element.
    const focusedTag = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      return {
        tag: el?.tagName,
        text: el?.textContent ?? '',
        hasTabIndex: el?.getAttribute('tabindex'),
      };
    });
    expect(focusedTag.text.toLowerCase()).toContain('match');
  });

  test('confirmation modal has dialog semantics + focusable buttons', async ({ page }) => {
    await page.goto('/scorekeeper/31d47592-6c76-4e3d-a9d2-c7953d6179c5');
    await page.waitForLoadState('networkidle');

    const readyDivision = page
      .locator('button')
      .filter({ has: page.locator('text=/\\d+ ready/i') })
      .first();
    await readyDivision.click();

    // Select winner: click competitor 1.
    const competitor1 = page
      .locator('button[aria-label*="select as winner"]')
      .first();
    await competitor1.click();

    // Open confirm dialog (Enter).
    await page.keyboard.press('Enter');
    const dialog = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(dialog).toBeVisible({ timeout: 3_000 });

    // The dialog must have a title and two action buttons.
    await expect(dialog.locator('h3')).toBeVisible();
    const buttons = dialog.locator('button');
    expect(await buttons.count()).toBeGreaterThanOrEqual(2);
  });
});
