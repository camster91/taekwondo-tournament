const { chromium } = require('@playwright/test');
const BASE = 'https://tkd.ashbi.ca';
const log = (...a) => console.log('[S0]', ...a);

(async () => {
  const browser = await chromium.launch({ headless: true });

  // Test F2 — Division Status section on a real tournament
  log('=== F2: Division Status ===');
  let page = await browser.newContext().then(c => c.newPage());
  await page.goto(`${BASE}/display/435ab382-fe49-4469-be51-b826a40ddcf3`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  // Get all text under DIVISION STATUS heading
  const allText = await page.locator('body').textContent();
  const hasNoDivsMsg = allText.includes('No divisions generated yet');
  const hasBracketData = allText.includes('10-11 CB-All');
  log('  has "No divisions generated yet" message:', hasNoDivsMsg);
  log('  has bracket data "10-11 CB-All":', hasBracketData);
  if (hasBracketData) {
    log('  ✓ F2 — Division Status rendering real data');
  } else if (hasNoDivsMsg) {
    log('  ✓ F2 — Division Status empty state shown');
  } else {
    log('  ? F2 — Division Status section has unexpected content');
  }

  // Test F5 — View Public button
  log('=== F5: View Public button ===');
  await page.goto(`${BASE}/login`);
  await page.getByRole('button', { name: /Try the demo/i }).click();
  await page.waitForURL(/\/$/, { timeout: 15000 });
  await page.goto(`${BASE}/tournaments/435ab382-fe49-4469-be51-b826a40ddcf3`);
  await page.waitForLoadState('networkidle');
  const viewPublicBtn = page.getByRole('link', { name: /View Public/i });
  const viewPublicVisible = await viewPublicBtn.isVisible();
  const viewPublicHref = viewPublicVisible ? await viewPublicBtn.getAttribute('href') : null;
  log('  View Public button visible:', viewPublicVisible);
  log('  View Public href:', viewPublicHref);
  if (viewPublicVisible && viewPublicHref && viewPublicHref.startsWith('/display/')) {
    log('  ✓ F5 — View Public button works');
  }

  // Test F10 — dashboard CTA dedupe
  log('=== F10: Dashboard CTA dedupe ===');
  await page.goto(`${BASE}/`);
  await page.waitForLoadState('networkidle');
  const quickActionsCard = page.locator('div').filter({ hasText: 'Quick actions' }).filter({ hasText: 'Import competitors' }).first();
  const qaText = await quickActionsCard.textContent();
  log('  Quick Actions text:', qaText?.slice(0, 300));
  if (qaText && !qaText.includes('Create tournament') && qaText.includes('View all tournaments')) {
    log('  ✓ F10 — Quick Actions shows View all, not Create');
  }

  await browser.close();
})().catch(e => { console.error('err:', e.message); process.exit(1); });
