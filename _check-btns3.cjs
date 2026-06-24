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
  // Scroll to registrations card
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/audit-final.png', fullPage: false });
  const emailBtn = await page.getByRole('button', { name: /Email Parents/i }).count();
  console.log('Email Parents button count:', emailBtn);
  // Check by text content
  const allBtns = await page.locator('button').evaluateAll((els) => els.map(e => e.textContent?.trim().slice(0, 30)).filter(Boolean));
  console.log('All buttons:', allBtns);
  await browser.close();
})();
