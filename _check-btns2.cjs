const { chromium } = require('@playwright/test');
const BASE = 'https://tkd.ashbi.ca';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext({ viewport: { width: 1440, height: 900 } }).then(c => c.newPage());
  await page.goto(BASE + '/login');
  await page.getByRole('button', { name: /Try the demo/i }).click();
  await page.waitForURL(/\/$/, { timeout: 15000 });
  await page.evaluate(() => localStorage.setItem('tkd_tour_completed', '1'));
  await page.goto(BASE + '/tournaments/435ab382-fe49-4469-be51-b826a40ddcf3');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/audit-final.png', fullPage: false, clip: { x: 0, y: 0, width: 1440, height: 400 } });
  // Dump all buttons on the page
  const btns = await page.locator('button, a').evaluateAll((els) => els.map(e => ({ tag: e.tagName, text: e.textContent?.trim().slice(0, 40), label: e.getAttribute('aria-label') })).catch(() => []);
  console.log(JSON.stringify(btns.slice(0, 30), null, 2));
  await browser.close();
})();
