const { chromium } = require('@playwright/test');
const BASE = 'https://tkd.ashbi.ca';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext({ viewport: { width: 1440, height: 900 } }).then(c => c.newPage());
  page.on('pageerror', e => console.log('[err]', e.message.slice(0, 300)));
  await page.goto(BASE + '/login');
  await page.getByRole('button', { name: /Try the demo/i }).click();
  await page.waitForURL(/\/$/, { timeout: 15000 });
  await page.evaluate(() => localStorage.setItem('tkd_tour_completed', '1'));
  await page.goto(BASE + '/tournaments/435ab382-fe49-4469-be51-b826a40ddcf3');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
  // All buttons with their accessible names
  const btns = await page.locator('button').all();
  for (const b of btns) {
    const t = (await b.textContent())?.trim();
    const al = await b.getAttribute('aria-label');
    if (t && (t.includes('Clone') || t.includes('Email') || t.includes('Manage'))) {
      console.log('Button:', JSON.stringify(t), JSON.stringify(al));
    }
  }
  await browser.close();
})();
