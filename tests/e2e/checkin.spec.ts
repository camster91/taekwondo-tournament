import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { loginAsDemo } from './helpers';

test.describe('check-in (weigh-in flow)', () => {
  test.beforeEach(async () => {
    const prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
    try {
      await prisma.registration.updateMany({
        where: {
          competitor: { firstName: 'Minho', lastName: 'Kim' },
          tournament: { name: 'Spring Championship 2026' },
        },
        data: { checkedIn: false, checkInTime: null, checkInWeight: null },
      });
    } finally {
      await prisma.$disconnect();
    }
  });

  test('staff checks in a competitor with a weigh-in and the row updates', async ({ page }) => {
    await loginAsDemo(page);

    // Find the seeded tournament and navigate to its check-in page.
    await page.goto('/tournaments');
    await expect(page.getByText('Spring Championship 2026').first()).toBeVisible({ timeout: 10_000 });

    const tournamentLink = page.locator('a', { hasText: 'Spring Championship 2026' }).first();
    const href = await tournamentLink.getAttribute('href');
    expect(href).toMatch(/^\/tournaments\/[a-f0-9-]+$/);
    const tournamentId = href!.replace('/tournaments/', '');

    await page.goto(`/checkin/${tournamentId}`);

    // Search for a known BB (black belt) sparring competitor. "Minho" is the
    // first BB Male in the seed; sparring=true means the row opens a
    // weigh-in modal instead of doing a direct PUT. (Sorting by name puts a
    // CB patterns-only competitor first, so searching is the cleanest way
    // to land on a sparring row.)
    const searchInput = page.locator('input[placeholder*="Search"]').first();
    await expect(searchInput).toBeVisible({ timeout: 10_000 });
    await searchInput.fill('Minho');

    const checkInButton = page.getByRole('button', { name: /^Check In$/i }).first();
    await expect(checkInButton).toBeVisible({ timeout: 10_000 });
    await checkInButton.click();

    // Verify the weigh-in modal opens with the weight field and prefills
    // the registered weight — this is the weigh-in path, separate from the
    // patterns-only path which just PUTs.
    const weightInput = page.locator('input[placeholder="Enter weight"]');
    await expect(weightInput).toBeVisible({ timeout: 5_000 });
    const prefilled = await weightInput.inputValue();
    expect(prefilled).not.toBe(''); // server-side prefill from weightAtRegistration
    expect(parseFloat(prefilled)).toBeGreaterThan(0);
  });

  test('check-in list shows mixed checked / unchecked states', async ({ page }) => {
    await loginAsDemo(page);
    await page.goto('/tournaments');
    const tournamentLink = page.locator('a', { hasText: 'Spring Championship 2026' }).first();
    const href = await tournamentLink.getAttribute('href');
    const tournamentId = href!.replace('/tournaments/', '');
    await page.goto(`/checkin/${tournamentId}`);

    // Per global-setup, 1 of the 20 seeded registrations is unchecked.
    // The list should contain BOTH "Check In" and "Undo" buttons.
    await expect(page.getByRole('button', { name: /^Check In$/i }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /^Undo$/i }).first()).toBeVisible();
  });

  test('offline check-in persists locally and syncs after reconnection', async ({ page, context }) => {
    await loginAsDemo(page);
    await page.goto('/tournaments');
    const href = await page.locator('a', { hasText: 'Spring Championship 2026' }).first().getAttribute('href');
    const tournamentId = href!.replace('/tournaments/', '');
    await page.goto(`/checkin/${tournamentId}`);

    await page.locator('input[placeholder*="Search"]').first().fill('Minho');
    const unchecked = page.getByRole('button', { name: /^Check In$/i }).first();
    await expect(unchecked).toBeVisible();
    await context.setOffline(true);
    await unchecked.click();
    await page.getByRole('button', { name: /Confirm Check-In/i }).click();
    await expect(page.getByText(/check-in saved on this device/i)).toBeVisible();
    await expect(page.getByText(/1 check-in pending sync/i)).toBeVisible();
    const stored = await page.evaluate(() => localStorage.getItem('bowin_offline_operations_v1'));
    expect(stored).toContain('check_in');

    let rejectSync = true;
    await page.route('**/api/tournaments/*/registrations/*', async (route) => {
      if (route.request().method() === 'PUT' && rejectSync) {
        await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Registration changed during the venue outage' }) });
        return;
      }
      await route.continue();
    });
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByRole('alert').filter({ hasText: /Registration changed during the venue outage/i })).toBeVisible();
    await expect(page.getByText(/Minho/i).filter({ hasText: /Attempted: Checked in/i })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('bowin_offline_operations_v1'))).toContain('needs_review');

    await page.reload();
    const persistedReview = page.getByRole('alert').filter({ hasText: /Registration changed during the venue outage/i });
    await expect(persistedReview).toBeVisible();
    await persistedReview.getByRole('button', { name: /Discard local change/i }).click();
    const discardDialog = page.getByRole('dialog', { name: /Discard unsynced check-in/i });
    await expect(discardDialog).toBeVisible();
    await discardDialog.getByRole('button', { name: /^Cancel$/i }).click();
    await expect(persistedReview).toBeVisible();

    rejectSync = false;
    await persistedReview.getByRole('button', { name: /^Retry$/i }).click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('bowin_offline_operations_v1')), { timeout: 10_000 }).toBe('[]');
    await expect(page.getByText(/Registration changed during the venue outage/i)).toBeHidden();

  });
});
