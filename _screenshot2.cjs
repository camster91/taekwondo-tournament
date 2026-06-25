const { chromium } = require('@playwright/test');
const BASE = 'https://tkd.ashbi.ca';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext({ viewport: { width: 1440, height: 900 } }).then(c => c.newPage());
  await page.goto(BASE + '/login');
  await page.getByRole('button', { name: /Try the demo/i }).click();
  await page.waitForURL(/\/$/, { timeout: 15000 });
  await page.evaluate(() => localStorage.setItem('tkd_tour_completed', '1'));
  // Regenerate the schedule so the data is fresh
  const tok = (await (await fetch(BASE + '/api/auth/demo', { method: 'POST' })).json()).token;
  await fetch(BASE + '/api/tournaments/435ab382-fe49-4469-be51-b826a40ddcf3/schedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
  });

  await page.goto(BASE + '/tournaments/435ab382-fe49-4469-be51-b826a40ddcf3/schedule');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/audit-schedule-final.png', fullPage: true });
  console.log('Screenshot saved');
  await browser.close();
})();
