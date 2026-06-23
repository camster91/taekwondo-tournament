const { chromium } = require('@playwright/test');
const BASE = 'https://tkd.ashbi.ca';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext().then(c => c.newPage());
  await page.goto(`${BASE}/display/435ab382-fe49-4469-be51-b826a40ddcf3`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
  // Find DIVISION STATUS heading
  const heading = page.locator('h3:has-text("DIVISION STATUS")');
  // Get the parent of the heading
  const divStatusContainer = heading.locator('xpath=ancestor::div[contains(@class,"mt-8")][1]');
  const html = await divStatusContainer.innerHTML();
  console.log(html);
  await browser.close();
})().catch(e => { console.error('err:', e.message); process.exit(1); });
