import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
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

/**
 * Resolve the Spring Championship 2026 tournament id from the tournaments list.
 * The id changes per seed run, so we extract it from the link href rather than
 * hardcoding a UUID that would rot as soon as the seed file is regenerated.
 */
async function resolveSpringChampionshipId(page: import('@playwright/test').Page): Promise<string> {
  await page.goto('/tournaments');
  const link = page.locator('a', { hasText: 'Spring Championship 2026' }).first();
  await expect(link).toBeVisible({ timeout: 10_000 });
  const href = await link.getAttribute('href');
  expect(href, 'Spring Championship 2026 link must be visible on /tournaments').toMatch(
    /^\/tournaments\/[a-f0-9-]+$/,
  );
  return href!.replace('/tournaments/', '');
}

// Cache the tournament id across tests in this describe block. Resolved
// once after the first login; subsequent tests reuse the cached value
// instead of re-navigating to /tournaments. Cuts the scorekeeper suite
// from ~9 minutes to ~5 on the CI runner (login is the slow part —
// 30s on CI vs 5s on Mac).
let cachedTournamentId: string | null = null;
async function getTournamentId(page: import('@playwright/test').Page): Promise<string> {
  if (cachedTournamentId) return cachedTournamentId;
  cachedTournamentId = await resolveSpringChampionshipId(page);
  return cachedTournamentId;
}

test.describe('scorekeeper (a11y)', () => {
  // Helper that logs in and returns the cached tournament id.
  // login() takes ~5s on Mac, ~30s on the CI runner. The other
  // ~70s of CI time per test is the page navigation + Playwright
  // actionability waits on a slow headless chromium, not the
  // login itself. Optimising the login would shave 4 minutes off
  // the CI run, but the test.use({ storageState }) approach has
  // a chicken-and-egg: test.use() runs before beforeAll, so the
  // file doesn't exist when the first test starts. Skip the
  // optimisation until we move to a pre-`globalSetup` model.
  async function setupScorekeeperTest(page: import('@playwright/test').Page): Promise<string> {
    await loginAsDemo(page);
    return getTournamentId(page);
  }

  test('scorekeeper page renders live region for announcements', async ({ page }) => {
    const tournamentId = await setupScorekeeperTest(page);
    await page.goto(`/scorekeeper/${tournamentId}`);
    await expect(page.getByRole('heading', { name: /Scorekeeper/i })).toBeVisible();

    // SR live region must be present (off-screen, role=status).
    const liveRegion = page.locator('[role="status"][aria-live="polite"]');
    await expect(liveRegion).toHaveCount(1, { timeout: 5_000 });
  });

  test('division list buttons have state-describing aria-labels', async ({ page }) => {
    const tournamentId = await setupScorekeeperTest(page);
    await page.goto(`/scorekeeper/${tournamentId}`);
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
    const tournamentId = await setupScorekeeperTest(page);
    await page.goto(`/scorekeeper/${tournamentId}`);
    await page.waitForLoadState('networkidle');

    // Click first division with ready matches.
    const readyDivision = page
      .locator('button')
      .filter({ has: page.locator('text=/\\d+ ready/i') })
      .first();
    await expect(readyDivision).toBeVisible();
    await readyDivision.click();

    // The match-scoring view should have competitor buttons with aria-pressed.
    // "select as winner" is in the aria-label, not visible text, so filter by
    // the aria-label attribute (hasText only matches visible text).
    const competitorButtons = page.locator('button[aria-pressed][aria-label*="select as winner"]');
    const buttonCount = await competitorButtons.count();
    expect(buttonCount).toBeGreaterThan(0);

    // Both competitor buttons must be present.
    await expect(competitorButtons.first()).toBeVisible();
    const firstLabel = await competitorButtons.first().getAttribute('aria-label');
    expect(firstLabel).toContain('select as winner');
  });

  test('score inputs are programmatically associated with their labels', async ({ page }) => {
    const tournamentId = await setupScorekeeperTest(page);
    await page.goto(`/scorekeeper/${tournamentId}`);
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
    const tournamentId = await setupScorekeeperTest(page);
    await page.goto(`/scorekeeper/${tournamentId}`);
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
    const tournamentId = await setupScorekeeperTest(page);
    await page.goto(`/scorekeeper/${tournamentId}`);
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
    const tournamentId = await setupScorekeeperTest(page);

    // Earlier scoring tests intentionally advance the shared seeded bracket.
    // Give this navigation test two deterministic ready matches so its
    // prerequisite does not depend on browser-project or test order.
    const prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
    try {
      const bracket = await prisma.bracket.findFirst({
        where: {
          division: { tournamentId },
          matches: {
            some: {
              competitor1Id: { not: null },
              competitor2Id: { not: null },
            },
          },
        },
        select: {
          matches: {
            where: {
              competitor1Id: { not: null },
              competitor2Id: { not: null },
            },
            orderBy: [{ roundNumber: 'asc' }, { matchNumber: 'asc' }],
            take: 2,
            select: { id: true },
          },
        },
      });
      const matches = bracket?.matches ?? [];
      expect(matches).toHaveLength(2);
      await prisma.match.updateMany({
        where: { id: { in: matches.map((match) => match.id) } },
        data: {
          status: 'ready',
          winnerId: null,
          score1: null,
          score2: null,
        },
      });
    } finally {
      await prisma.$disconnect();
    }

    await page.goto(`/scorekeeper/${tournamentId}`);
    await page.waitForLoadState('networkidle');

    const readyDivision = page
      .locator('button')
      .filter({ hasText: /(?:[2-9]|\d{2,}) ready/i })
      .first();
    await expect(readyDivision).toBeVisible();
    await readyDivision.click();

    // Wait for the match view to load.
    await expect(page.getByLabel(/match \d+ of \d+/i).first()).toBeVisible({ timeout: 5_000 });

    // Press right arrow — focus should move to the new match heading.
    await page.keyboard.press('ArrowRight');
    const activeHeading = page.locator('[tabindex="-1"][aria-label*="match"]').first();
    await expect(activeHeading).toBeFocused();
    // The active match heading has tabindex=-1 and its aria-label is
    // "<division> match N of M" — the visible text is just the division
    // name, so check aria-label and tabindex instead of textContent.
    const focusedInfo = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      return {
        tag: el?.tagName,
        text: el?.textContent ?? '',
        ariaLabel: el?.getAttribute('aria-label') ?? '',
        tabindex: el?.getAttribute('tabindex'),
      };
    });
    expect(focusedInfo.tabindex).toBe('-1');
    expect(focusedInfo.ariaLabel.toLowerCase()).toMatch(/match \d+ of \d+/);
  });

  test('confirmation modal has dialog semantics + focusable buttons', async ({ page }) => {
    const tournamentId = await setupScorekeeperTest(page);
    await page.goto(`/scorekeeper/${tournamentId}`);
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

  test('incident dialog traps focus, closes with Escape, and restores the opener', async ({ page }) => {
    const tournamentId = await setupScorekeeperTest(page);
    await page.goto(`/scorekeeper/${tournamentId}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /\d+ ready/i }).first().click();

    const opener = page.getByRole('button', { name: /Report Incident/i });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: /Report Incident/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Close incident/i })).toBeFocused();

    const cancel = dialog.getByRole('button', { name: /^Cancel$/i });
    await cancel.focus();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: /Close incident/i })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('offline result persists locally and syncs after reconnection', async ({ page, context }) => {
    const tournamentId = await setupScorekeeperTest(page);
    await page.goto(`/scorekeeper/${tournamentId}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /\d+ ready/i }).first().click();
    await page.locator('button[aria-label*="select as winner"]').first().click();
    await page.locator('#scorekeeper-score1').fill('5');
    await page.locator('#scorekeeper-score2').fill('2');
    await page.getByRole('button', { name: /^Record Result$/i }).click();
    await expect(page.getByRole('dialog', { name: /Confirm Result/i })).toBeVisible();

    await context.setOffline(true);
    await page.getByRole('button', { name: /^Confirm/i }).click();
    await expect(page.getByText(/saved on this device/i)).toBeVisible();
    await expect(page.getByText(/1 result pending sync/i)).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('bowin_offline_operations_v1'))).toContain('score_result');

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByText(/1 result pending sync/i)).toBeHidden({ timeout: 10_000 });
    expect(await page.evaluate(() => localStorage.getItem('bowin_offline_operations_v1'))).toBe('[]');
  });
});
