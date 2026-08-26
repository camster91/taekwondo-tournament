import { test, expect } from '@playwright/test';

async function loginDemo(page: import('@playwright/test').Page) {
  const response = await page.request.post('/api/auth/demo');
  expect(response.ok()).toBeTruthy();
  await page.goto('/');
}

async function ensureControlled(page: import('@playwright/test').Page) {
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
}

test('check-in and scorekeeper reopen after an offline refresh and reconcile queued work', async ({ page, context }) => {
  await loginDemo(page);
  const tournaments = await (await page.request.get('/api/tournaments')).json() as Array<{ id: string; publicSlug?: string }>;
  const showcase = tournaments.find((item) => item.publicSlug === 'bowin-demo-live-championship') ?? tournaments[0];
  expect(showcase?.id).toBeTruthy();

  await page.goto(`/checkin/${showcase.id}`);
  await expect(page.getByRole('heading', { name: /Check-In/i })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some((key) => key.includes('bowin_venue_snapshot_v1') && key.endsWith(':checkin')))).toBe(true);
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem('bowin_offline_auth_v2')))).toBe(true);
  await ensureControlled(page);
  await expect.poll(() => page.evaluate(async () => {
    const controllerUrl = navigator.serviceWorker.controller?.scriptURL;
    const version = controllerUrl ? new URL(controllerUrl).searchParams.get('v') : null;
    if (!version) return false;
    const cacheVersion = version.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-96);
    const cache = await caches.open(`bowin-static-${cacheVersion}`);
    const assets = [
      ...Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]'), (item) => item.src),
      ...Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'), (item) => item.href),
    ];
    return assets.length > 0 && (await Promise.all(assets.map((asset) => cache.match(asset))))
      .every(Boolean);
  })).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText(/Offline mode: identity is from a recent server-validated session/i)).toBeVisible();
  await expect(page.getByText(/Cached check-in list from/i)).toBeVisible();

  const checkIn = page.getByRole('button', { name: /^Check In$/i }).first();
  await expect(checkIn).toBeVisible();
  await checkIn.click();
  const confirm = page.getByRole('button', { name: /Confirm Check-In/i });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('bowin_offline_operations_v1') || '')).toContain('check_in');

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => page.evaluate(() => localStorage.getItem('bowin_offline_operations_v1')), { timeout: 15_000 }).toBe('[]');
  await expect(page.getByText(/Offline mode: identity/i)).toBeHidden();

  await page.goto(`/scorekeeper/${showcase.id}`);
  await expect(page.getByRole('heading', { name: 'Scorekeeper' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some((key) => key.includes('bowin_venue_snapshot_v1') && key.endsWith(':scorekeeper')))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText(/Cached scorekeeper data from/i)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Scorekeeper' })).toBeVisible();
  await context.setOffline(false);

  await page.evaluate(async () => {
    const csrf = document.cookie.split('; ')
      .find((cookie) => cookie.startsWith('bowin_csrf='))?.split('=')[1];
    await fetch('/api/auth/logout', { method: 'POST', headers: csrf ? { 'X-CSRF-Token': decodeURIComponent(csrf) } : {} });
  });
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage)
    .filter((key) => key.startsWith('bowin_offline_auth_')
      || key.startsWith('bowin_venue_snapshot_')
      || key === 'bowin_offline_operations_v1'))).toEqual([]);
});
