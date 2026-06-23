const { chromium } = require('@playwright/test');
const BASE = 'https://tkd.ashbi.ca';
const log = (...a) => console.log('[S0]', ...a);

(async () => {
  const browser = await chromium.launch({ headless: true });

  // Test F2 — Division Status empty state on a tournament with no brackets
  log('=== F2: Division Status empty state ===');
  let page = await browser.newContext().then(c => c.newPage());
  await page.goto(`${BASE}/display/435ab382-fe49-4469-be51-b826a40ddcf3`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  // Find Division Status heading and check for empty state text below it
  const divisionStatusHeading = page.locator('h3', { hasText: 'DIVISION STATUS' });
  const visible = await divisionStatusHeading.isVisible();
  log('  DIVISION STATUS heading visible:', visible);
  if (visible) {
    const sectionText = await divisionStatusHeading.locator('..').parent().textContent();
    const hasEmptyState = sectionText.includes('No divisions generated yet') || sectionText.includes('36+');
    log('  has division content or empty state:', hasEmptyState);
  }

  // Test F5 — View Public button on TournamentDetail
  log('=== F5: View Public button ===');
  await page.goto(`${BASE}/tournaments`);
  await page.waitForLoadState('networkidle');
  // Log in as demo
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

  // Test F10 — dashboard CTA dedupe
  log('=== F10: Dashboard CTA dedupe ===');
  await page.goto(`${BASE}/`);
  await page.waitForLoadState('networkidle');
  const quickActions = page.locator('text=Quick actions').first().locator('..');
  const quickActionsText = await quickActions.textContent();
  const hasCreate = quickActionsText?.includes('Create tournament');
  const hasViewAll = quickActionsText?.includes('View all tournaments');
  log('  Quick Actions has "Create tournament":', hasCreate);
  log('  Quick Actions has "View all tournaments":', hasViewAll);
  if (!hasCreate && hasViewAll) {
    log('  ✓ F10 — Quick Actions dedupe correct');
  } else {
    log('  ✗ F10 — Quick Actions still has Create');
  }

  await browser.close();
})().catch(e => { console.error('err:', e.message); process.exit(1); });
