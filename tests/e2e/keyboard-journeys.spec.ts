import { test, expect, type Locator, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { loginAsDemo, skipOnboardingTour } from './helpers';

/**
 * Slice 2 — Keyboard-only journey tests (WCAG 2.2 SC 2.1.1, 2.1.2)
 *
 * These tests verify that critical user flows can be completed using ONLY
 * keyboard input (Tab, Shift+Tab, Enter, Space, Arrow keys, Escape, Ctrl+Z).
 * No mouse/pointer interaction is allowed.
 *
 * Success criteria: User can complete each journey from start to finish
 * without touching the mouse. No keyboard traps. All interactive elements
 * are reachable via Tab/Shift+Tab.
 */

/**
 * Press Tab (or Shift+Tab) until `target` has focus. The journeys assert
 * keyboard reachability and order-independent operability; exact Tab counts
 * broke every time a skip link, header control, or help button was added.
 */
async function tabTo(page: Page, target: Locator, { max = 40, reverse = false } = {}) {
  await expect(target).toBeVisible();
  for (let i = 0; i < max; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press(reverse ? 'Shift+Tab' : 'Tab');
  }
  await expect(target).toBeFocused();
}

async function openSeededTournament(page: Page, suffix: string) {
  await page.goto('/tournaments');
  const link = page.locator('a', { hasText: 'Spring Championship 2026' }).first();
  await expect(link).toBeVisible({ timeout: 10_000 });
  const href = await link.getAttribute('href');
  await page.goto(`${href}/${suffix}`);
}

test.describe('keyboard-only journeys', () => {
  test('login journey: email → code → dashboard (keyboard-only)', async ({ page }) => {
    await skipOnboardingTour(page);
    const magicLinkResponse = page.waitForResponse(
      (resp) => resp.url().endsWith('/api/auth/request-magic-link') && resp.request().method() === 'POST',
    );

    await page.goto('/login');
    const emailField = page.getByLabel('Email address');
    await tabTo(page, emailField);
    await page.keyboard.type(`keyboard-test-${Date.now()}@example.com`);

    await tabTo(page, page.getByRole('button', { name: /Send sign-in link/i }));
    await page.keyboard.press('Enter');

    const response = await magicLinkResponse;
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.devMode).toBe(true);
    expect(body.code).toMatch(/^\d{6}$/);

    const codeInput = page.getByLabel('6-digit code');
    await tabTo(page, codeInput);
    await page.keyboard.type(body.code);

    await tabTo(page, page.getByRole('button', { name: /Verify code/i }));
    await page.keyboard.press('Enter');

    // The signed-in landing page is /dashboard (/ is the marketing site).
    await expect(page).toHaveURL('/dashboard');
  });

  test('public registration journey: 2-step form (keyboard-only)', async ({ page }) => {
    await page.goto('/register');
    await expect(page.locator('option', { hasText: 'E2E Open 2026' })).toHaveCount(1, { timeout: 10_000 });

    // --- Step 1: Athlete ---
    const tournamentSelect = page.locator('select[name="tournamentId"]');
    await tabTo(page, tournamentSelect);
    await page.keyboard.type('E2E'); // select type-ahead
    await expect(tournamentSelect.locator('option:checked')).toHaveText(/E2E Open 2026/);

    await tabTo(page, page.getByLabel(/First Name/));
    await page.keyboard.type('Keyboard');
    await tabTo(page, page.getByLabel(/Last Name/));
    await page.keyboard.type('Tester');

    const gender = page.locator('select[name="gender"]');
    await tabTo(page, gender);
    await page.keyboard.type('Male');
    await expect(gender).toHaveValue(/.+/);

    await tabTo(page, page.locator('input[name="dateOfBirth"]'));
    await page.keyboard.type('01152016');
    await expect(page.locator('input[name="dateOfBirth"]')).toHaveValue('2016-01-15');

    const belt = page.locator('select[name="belt"]');
    await tabTo(page, belt);
    await page.keyboard.type('Yellow');
    await expect(belt).toHaveValue('Yellow');

    await tabTo(page, page.getByLabel('School / Dojang'));
    await page.keyboard.type('E2E Keyboard Academy');

    const patternsCheckbox = page.locator('input[name="patterns"]');
    await tabTo(page, patternsCheckbox);
    await page.keyboard.press('Space');
    await expect(patternsCheckbox).toBeChecked();

    await tabTo(page, page.getByRole('button', { name: /Next: Parent & Consent/i }));
    await page.keyboard.press('Enter');

    // --- Step 2: Parent & Consent ---
    await tabTo(page, page.getByLabel(/Parent\/Guardian Name/i));
    await page.keyboard.type('Parent Keyboarder');
    await tabTo(page, page.locator('input[name="parentEmail"]'));
    await page.keyboard.type(`parent-kb-${Date.now()}@example.com`);

    for (const name of ['privacyAccepted', 'rulesAccepted', 'guardianAttested']) {
      const checkbox = page.locator(`input[name="${name}"]`);
      await tabTo(page, checkbox);
      await page.keyboard.press('Space');
      await expect(checkbox).toBeChecked();
    }

    await tabTo(page, page.getByRole('button', { name: /Complete Registration/i }));
    await page.keyboard.press('Enter');

    await expect(page.getByRole('heading', { name: 'Registration Complete!' })).toBeVisible({ timeout: 10_000 });
  });

  test('scorekeeper journey: select division → score match → undo (keyboard-only)', async ({ page }) => {
    await loginAsDemo(page);
    await openSeededTournament(page, 'scorekeeper');
    await expect(page.getByRole('heading', { name: /Scorekeeper/i }).first()).toBeVisible();

    const readyDivision = page.getByRole('button', { name: /\d+ ready/i }).first();
    await tabTo(page, readyDivision, { max: 80 });
    await page.keyboard.press('Enter');

    const competitor1Button = page.locator('button[aria-pressed][aria-label*="select as winner"]').first();
    await tabTo(page, competitor1Button);
    await page.keyboard.press('Enter');
    await expect(competitor1Button).toHaveAttribute('aria-pressed', 'true');

    const score1Input = page.locator('#scorekeeper-score1');
    await tabTo(page, score1Input);
    await page.keyboard.type('6');
    await tabTo(page, page.locator('#scorekeeper-score2'));
    await page.keyboard.type('3');

    await tabTo(page, page.getByRole('button', { name: /^Record Result$/i }));
    await page.keyboard.press('Enter');

    const confirmDialog = page.getByRole('dialog', { name: /Confirm Result/i });
    await expect(confirmDialog).toBeVisible();
    await tabTo(page, confirmDialog.getByRole('button', { name: /^Confirm/i }), { max: 10 });
    // Undo applies to acknowledged results: wait for the save and the refresh.
    const saved = page.waitForResponse((resp) => resp.request().method() === 'PUT' && /\/api\/brackets\/match\/[^/]+$/.test(resp.url()));
    const refreshed = page.waitForResponse((resp) => resp.url().includes('withMatches=true'));
    await page.keyboard.press('Enter');
    await expect(confirmDialog).toBeHidden();
    expect((await saved).ok()).toBeTruthy();
    await refreshed;

    // --- Undo the result with the keyboard shortcut ---
    await page.keyboard.press('Control+z');
    const undoDialog = page.getByRole('dialog', { name: 'Undo this result?' });
    await expect(undoDialog).toBeVisible();
    await tabTo(page, undoDialog.getByRole('button', { name: 'Undo result' }), { max: 10 });
    await page.keyboard.press('Enter');

    await expect(page.getByRole('status').filter({ hasText: 'Last result undone' })).toBeVisible({ timeout: 10_000 });
  });

  test('check-in journey: search → check in competitor (keyboard-only)', async ({ page }) => {
    // checkin.spec checks Minho Kim in earlier in the run; start unchecked.
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
    try {
      await prisma.registration.updateMany({
        where: { tournament: { name: 'Spring Championship 2026' }, competitor: { firstName: 'Minho', lastName: 'Kim' } },
        data: { checkedIn: false, checkInTime: null, checkInWeight: null },
      });
    } finally {
      await prisma.$disconnect();
    }
    await loginAsDemo(page);
    await openSeededTournament(page, 'checkin');

    const searchInput = page.getByLabel('Search competitors by name or school');
    await tabTo(page, searchInput);
    await page.keyboard.type('Minho');

    const checkInButton = page.getByRole('button', { name: /^Check In$/i }).first();
    await tabTo(page, checkInButton);
    await page.keyboard.press('Enter');

    const weightDialog = page.getByRole('dialog', { name: /^Check In:/ });
    if (await weightDialog.isVisible()) {
      await tabTo(page, weightDialog.getByLabel('Weigh-In Weight (lbs)'), { max: 10 });
      await page.keyboard.type('75');
      await tabTo(page, weightDialog.getByRole('button', { name: /Confirm Check-In/i }), { max: 10 });
      await page.keyboard.press('Enter');
      await expect(weightDialog).toBeHidden();
    }

    await expect(page.getByRole('button', { name: /^Undo$/i }).first()).toBeVisible();
  });
});
