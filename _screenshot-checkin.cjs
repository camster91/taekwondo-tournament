const { chromium } = require('@playwright/test');
const BASE = 'https://tkd.ashbi.ca';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext({ viewport: { width: 1440, height: 900 } }).then(c => c.newPage());
  await page.goto(BASE + '/login');
  await page.getByRole('button', { name: /Try the demo/i }).click();
  await page.waitForURL(new RegExp('/$'), { timeout: 15000 });
  await page.evaluate(() => localStorage.setItem('tkd_tour_completed', '1'));
  await page.goto(BASE + '/checkin/435ab382-fe49-4469-be51-b826a40ddcf3');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/audit-checkin.png', fullPage: true });
  console.log('saved');
  await browser.close();
})();
