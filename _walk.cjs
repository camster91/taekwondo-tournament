const { chromium } = require('@playwright/test');
const BASE = 'https://tkd.ashbi.ca';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext({ viewport: { width: 1440, height: 900 } }).then(c => c.newPage());
  let pass = 0, fail = 0;
  const check = (name, cond) => { if (cond) { console.log('  PASS', name); pass++; } else { console.log('  FAIL', name); fail++; } };

  page.on('pageerror', e => console.log('[err]', e.message.slice(0, 300)));
  page.on('response', r => { if (r.url().includes('/api/') && r.status() >= 500) console.log('[5xx]', r.status(), r.url()); });

  await page.goto(BASE + '/login');
  await page.getByRole('button', { name: /Try the demo/i }).click();
  await page.waitForURL(/\/$/, { timeout: 15000 });
  await page.evaluate(() => localStorage.setItem('tkd_tour_completed', '1'));

  // Visit each admin surface and take a screenshot
  const pages = [
    { name: 'Dashboard', path: '/' },
    { name: 'Tournaments', path: '/tournaments' },
    { name: 'TournamentDetail', path: '/tournaments/435ab382-fe49-4469-be51-b826a40ddcf3' },
    { name: 'DirectorDashboard', path: '/director' },
    { name: 'Divisions', path: '/tournaments/435ab382-fe49-4469-be51-b826a40ddcf3/divisions' },
    { name: 'Competitors', path: '/competitors' },
    { name: 'Settings', path: '/tournaments/435ab382-fe49-4469-be51-b826a40ddcf3/settings' },
    { name: 'Results', path: '/tournaments/435ab382-fe49-4469-be51-b826a40ddcf3/results' },
    { name: 'Users', path: '/admin/users' },
  ];

  for (const p of pages) {
    await page.goto(BASE + p.path);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    const h1 = await page.locator('h1, h2').first().textContent().catch(() => 'none');
    const errs = await page.locator('text=/Error|Something went wrong/i').count();
    console.log(`  ${p.name.padEnd(22)} H1: ${h1?.slice(0, 50).padEnd(50)} errors: ${errs}`);
    if (errs > 0) {
      await page.screenshot({ path: `/tmp/audit-err-${p.name}.png`, fullPage: true });
    }
  }

  await browser.close();
  console.log(`\n${pass} PASS, ${fail} FAIL`);
  if (fail > 0) process.exit(1);
})();
