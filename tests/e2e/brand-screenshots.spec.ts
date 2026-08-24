import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { test } from '@playwright/test';
import { loginAsDemo } from './helpers';

const outputDir = path.resolve(process.cwd(), 'public', 'brand-kit');

async function prepareCapture(page: import('@playwright/test').Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addStyleTag({
    content: `
      *, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }
      #bowin-sample-capture-badge {
        position: fixed; z-index: 2147483647; top: 16px; right: 16px;
        padding: 9px 13px; border-radius: 999px; background: #f6b93b; color: #0b1220;
        border: 2px solid #0b1220; font: 700 12px/1.1 Arial, sans-serif; letter-spacing: .08em;
        box-shadow: 0 8px 24px rgba(11,18,32,.22);
      }
    `,
  });
  await page.evaluate(() => {
    document.getElementById('bowin-sample-capture-badge')?.remove();
    const badge = document.createElement('div');
    badge.id = 'bowin-sample-capture-badge';
    badge.textContent = 'SAMPLE DATA - NOT A LIVE EVENT';
    document.body.appendChild(badge);
  });
}

async function capture(page: import('@playwright/test').Page, name: string) {
  await prepareCapture(page);
  await page.screenshot({
    path: path.join(outputDir, name),
    fullPage: false,
    animations: 'disabled',
  });
}

test('builds the public brand screenshot set from synthetic demo data', async ({ page, context }) => {
  await mkdir(outputDir, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 960 });

  await loginAsDemo(page);

  const tournamentsResponse = await page.request.get('/api/tournaments');
  const tournamentsPayload = await tournamentsResponse.json();
  const tournaments = Array.isArray(tournamentsPayload)
    ? tournamentsPayload
    : tournamentsPayload.tournaments ?? tournamentsPayload.data ?? [];
  const tournament = tournaments.find((item: { name?: string }) => item.name?.includes('Spring Championship')) ?? tournaments[0];
  if (!tournament?.id) throw new Error('No synthetic demo tournament was available for brand screenshots');

  await page.goto(`/tournaments/${tournament.id}/director`);
  await page.waitForLoadState('networkidle');
  await capture(page, 'sample-organizer-dashboard.png');

  await page.goto(`/tournaments/${tournament.id}`);
  await page.waitForLoadState('networkidle');
  await capture(page, 'sample-tournament-operations.png');

  await page.goto(`/tournaments/${tournament.id}/divisions`);
  await page.waitForLoadState('networkidle');
  const bracketLink = page.locator('a[href*="/bracket"]').first();
  if (await bracketLink.isVisible().catch(() => false)) {
    await bracketLink.click();
    await page.waitForLoadState('networkidle');
  }
  await capture(page, 'sample-divisions-brackets.png');

  await context.clearCookies();
  await page.goto('/register');
  await page.waitForLoadState('networkidle');
  await page.locator('[role="alert"]').filter({ hasText: /session has expired/i }).evaluateAll((alerts) => {
    alerts.forEach((alert) => alert.remove());
  });
  await capture(page, 'sample-public-registration.png');

  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Open support chat' }).click();
  await page.getByRole('button', { name: 'Close support chat' }).waitFor({ state: 'visible' });
  await capture(page, 'sample-support-ai.png');
});
