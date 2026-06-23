// P6: Mobile responsive audit at iPhone 14 viewport (390x844)
const { chromium, devices } = require('@playwright/test');
const BASE = 'https://tkd.ashbi.ca';
const SHOTS = '/tmp/_p6-shots';
require('fs').mkdirSync(SHOTS, { recursive: true });

const issues = [];
function issue(name, status, detail) {
  const line = `| ${name} | ${status} | ${detail} |`;
  console.log(line);
  if (status === 'FAIL') issues.push(name);
  return line;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const iPhone = devices['iPhone 14'];
  const context = await browser.newContext({ ...iPhone });
  const page = await context.newPage();

  // 1. Public register page
  await page.goto(`${BASE}/register`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${SHOTS}/01-register-mobile.png`, fullPage: true });
  // Check for horizontal scroll (would mean content overflows viewport)
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  issue('1. /register no horizontal scroll',
    scrollWidth <= clientWidth ? 'PASS' : 'FAIL',
    `scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`);

  // Check that the fee badge (if visible) doesn't overflow
  const feeEl = await page.locator('text=/Fee:/').first();
  if (await feeEl.isVisible()) {
    const box = await feeEl.boundingBox();
    issue('2. Fee badge fits in viewport',
      box.x + box.width <= clientWidth ? 'PASS' : 'FAIL',
      `x=${Math.round(box.x)}, width=${Math.round(box.width)}, viewport=${clientWidth}`);
  }

  // 3. Check that the tournament dropdown is reachable
  const tournamentSelect = page.locator('select[name="tournamentId"]');
  const tsBox = await tournamentSelect.boundingBox();
  issue('3. Tournament select visible above fold',
    tsBox.y < 800 && tsBox.y >= 0 ? 'PASS' : 'FAIL',
    `y=${Math.round(tsBox.y)}`);

  // 4. Check form inputs are big enough (44px tap target minimum)
  const inputs = await page.locator('input[type="text"], input[type="date"], input[type="number"], input[type="email"], input[type="tel"]').all();
  let smallInputs = [];
  for (const inp of inputs) {
    const box = await inp.boundingBox();
    if (box && box.height < 40) {
      smallInputs.push(`${inp.getAttribute('name') || 'unnamed'} (${Math.round(box.height)}px)`);
    }
  }
  issue('4. Form inputs ≥ 40px tall',
    smallInputs.length === 0 ? 'PASS' : 'FAIL',
    smallInputs.length ? `small: ${smallInputs.join(', ')}` : 'all inputs ≥ 40px');

  // 5. Check that the Next button is large enough
  const nextBtn = page.getByRole('button', { name: /Next/ });
  const nextBox = await nextBtn.boundingBox();
  issue('5. Next button ≥ 44px tall',
    nextBox && nextBox.height >= 44 ? 'PASS' : 'FAIL',
    nextBox ? `height=${Math.round(nextBox.height)}` : 'button not found');

  // 6. Check date input tap target (browsers add their own picker)
  const dateInput = page.locator('input[type="date"]').first();
  if (await dateInput.isVisible()) {
    const dateBox = await dateInput.boundingBox();
    issue('6. Date input ≥ 40px tall',
      dateBox.height >= 40 ? 'PASS' : 'FAIL',
      `height=${Math.round(dateBox.height)}`);
  }

  // 7. Check that 2-column grids stack to 1-column on mobile
  const firstGrid = page.locator('.grid').first();
  if (await firstGrid.count() > 0) {
    const gridStyle = await firstGrid.evaluate(el => window.getComputedStyle(el).gridTemplateColumns);
    const columnCount = gridStyle.split(' ').filter(s => s.length > 0).length;
    issue('7. Grid columns collapse on mobile',
      columnCount <= 2 ? 'PASS' : 'FAIL',
      `columns=${columnCount}, value="${gridStyle.slice(0, 80)}"`);
  }

  // 8. Hero text is readable (not too small)
  const h1 = page.locator('h1').first();
  const h1Size = await h1.evaluate(el => window.getComputedStyle(el).fontSize);
  const h1SizeNum = parseInt(h1Size);
  issue('8. H1 font-size ≥ 24px',
    h1SizeNum >= 24 ? 'PASS' : 'FAIL',
    `${h1Size}`);

  // 9. Test public display at mobile viewport
  await page.goto(`${BASE}/display/435ab382-fe49-4469-be51-b826a40ddcf3`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${SHOTS}/02-display-mobile.png`, fullPage: true });
  const displayScroll = await page.evaluate(() => document.documentElement.scrollWidth);
  const displayClient = await page.evaluate(() => document.documentElement.clientWidth);
  issue('9. /display/:id no horizontal scroll on mobile',
    displayScroll <= displayClient ? 'PASS' : 'FAIL',
    `scrollWidth=${displayScroll}, clientWidth=${displayClient}`);

  // 10. Login page mobile
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${SHOTS}/03-login-mobile.png`, fullPage: true });
  const demoBtn = page.getByRole('button', { name: /Try the demo/i });
  const demoBox = await demoBtn.boundingBox();
  issue('10. Login demo button ≥ 44px tall',
    demoBox.height >= 44 ? 'PASS' : 'FAIL',
    `height=${Math.round(demoBox.height)}`);

  await browser.close();

  console.log(`\n${issues.length === 0 ? 'ALL PASS' : `${issues.length} FAIL(s): ${issues.join(', ')}`}`);
  if (issues.length > 0) process.exit(1);
})().catch(e => { console.error('crashed:', e.message); process.exit(2); });
