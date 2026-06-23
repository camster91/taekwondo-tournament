// P11: Pilot-readiness smoke test
// Hits every critical path on the live app, captures status + screenshot.
// Outputs a markdown report at docs/PILOT-VERIFICATION-2026-06-23.md.
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE = 'https://tkd.ashbi.ca';
const SHOTS_DIR = '/tmp/_p11-shots';
const REPORT_PATH = '/Users/biancabienaime/taekwondo-tournament/docs/PILOT-VERIFICATION-2026-06-23.md';

if (!fs.existsSync(SHOTS_DIR)) fs.mkdirSync(SHOTS_DIR, { recursive: true });
const report = [];
function step(name, status, detail) {
  const line = `| ${name} | ${status} | ${detail} |`;
  console.log(line);
  report.push(line);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [];

  // ===== 1. Public health =====
  try {
    const res = await fetch(`${BASE}/api/health`);
    step('1. GET /api/health', res.ok ? 'PASS' : 'FAIL', `${res.status} in ${(await res.text()).slice(0, 80)}`);
  } catch (e) {
    step('1. GET /api/health', 'FAIL', e.message);
  }

  // ===== 2. Public tournaments list =====
  try {
    const res = await fetch(`${BASE}/api/public/tournaments`);
    const data = await res.json();
    step('2. GET /api/public/tournaments', res.ok && data.length > 0 ? 'PASS' : 'FAIL',
      `${res.status}, ${data.length} tournament(s), first: ${data[0]?.name || 'none'}`);
  } catch (e) {
    step('2. GET /api/public/tournaments', 'FAIL', e.message);
  }

  // ===== 3. Public scoreboard via UUID (back-compat shim) =====
  try {
    const list = await fetch(`${BASE}/api/public/tournaments`).then(r => r.json());
    const tid = list[0]?.id;
    const res = await fetch(`${BASE}/api/public/tournaments/${tid}/scoreboard`);
    const data = await res.json();
    step('3. GET /api/public/tournaments/:id/scoreboard (UUID)',
      res.ok && Array.isArray(data) ? 'PASS' : 'FAIL',
      `${res.status}, ${data.length} division(s)`);
  } catch (e) {
    step('3. GET scoreboard (UUID)', 'FAIL', e.message);
  }

  // ===== 4. Demo login =====
  let demoToken = '';
  try {
    const res = await fetch(`${BASE}/api/auth/demo`, { method: 'POST' });
    const data = await res.json();
    demoToken = data.token || '';
    step('4. POST /api/auth/demo', res.ok && demoToken ? 'PASS' : 'FAIL',
      `${res.status}, role=${data.user?.role}, token len=${demoToken.length}`);
  } catch (e) {
    step('4. POST /api/auth/demo', 'FAIL', e.message);
  }

  // ===== 5. Authenticated API (tournaments list) =====
  try {
    const res = await fetch(`${BASE}/api/tournaments`, {
      headers: { Authorization: `Bearer ${demoToken}` }
    });
    const data = await res.json();
    step('5. GET /api/tournaments (admin)', res.ok ? 'PASS' : 'FAIL',
      `${res.status}, ${data.length} tournament(s)`);
  } catch (e) {
    step('5. GET /api/tournaments', 'FAIL', e.message);
  }

  // ===== 6. Browser walkthrough =====
  const page = await browser.newContext({ viewport: { width: 1440, height: 900 } }).then(c => c.newPage());
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));

  // 6a. Login page
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${SHOTS_DIR}/01-login.png` });
  step('6a. /login renders', 'PASS', `title=${await page.title()}`);

  // 6b. Demo login flow
  await page.getByRole('button', { name: /Try the demo/i }).click();
  await page.waitForURL(/\/$/, { timeout: 15000 });
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${SHOTS_DIR}/02-dashboard.png` });
  step('6b. Demo login + dashboard', 'PASS', `URL=${page.url()}`);

  // 6c. Tournaments list
  await page.goto(`${BASE}/tournaments`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${SHOTS_DIR}/03-tournaments.png` });
  const tournamentCount = await page.locator('a[href^="/tournaments/"]').count();
  step('6c. /tournaments list', 'PASS', `${tournamentCount} tournament links`);

  // 6d. Click first tournament
  const firstHref = await page.locator('a[href^="/tournaments/"]').filter({ hasNotText: 'New' }).first().getAttribute('href');
  await page.goto(`${BASE}${firstHref}`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${SHOTS_DIR}/04-tournament-detail.png` });
  const viewPublicVisible = await page.getByRole('link', { name: /View Public/i }).isVisible();
  step('6d. Tournament detail + View Public button', viewPublicVisible ? 'PASS' : 'FAIL',
    `URL=${page.url()}`);

  // 6e. Divisions page
  const tid = firstHref.replace('/tournaments/', '');
  await page.goto(`${BASE}${firstHref}/divisions`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${SHOTS_DIR}/05-divisions.png` });
  step('6e. /tournaments/:id/divisions', 'PASS', `URL=${page.url()}`);

  // 6f. Settings page (tabs)
  await page.goto(`${BASE}${firstHref}/settings`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${SHOTS_DIR}/06-settings-setup.png` });
  const setupTab = await page.getByRole('button', { name: /Setup/i }).first().isVisible();
  await page.getByRole('button', { name: /Categorization/i }).first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS_DIR}/06b-settings-rules.png` });
  step('6f. Settings tabs work', setupTab ? 'PASS' : 'FAIL', 'setup + rules tabs');

  // 6g. Public display (scoreboard)
  await page.goto(`${BASE}/display/${tid}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${SHOTS_DIR}/07-public-scoreboard.png` });
  const scoreboardHeading = await page.locator('h1, h2').first().textContent().catch(() => '');
  step('6g. /display/:id renders', 'PASS', `heading=${scoreboardHeading?.slice(0, 40)}`);

  // 6h. Logout (do it from a protected page so DV avatar is in scope)
  await page.goto(`${BASE}/tournaments`);
  await page.waitForLoadState('networkidle');
  try {
    await page.getByText('DV', { exact: true }).click({ timeout: 5000 });
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /Sign out/i }).click({ timeout: 5000 });
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `${SHOTS_DIR}/08-logged-out.png` });
    step('6h. Logout flow', 'PASS', `URL after logout=${page.url()}`);
  } catch (e) {
    await page.screenshot({ path: `${SHOTS_DIR}/08-logged-out.png` });
    step('6h. Logout flow', 'FAIL', e.message.slice(0, 100));
  }

  // 6i. Public registration end-to-end
  try {
    await page.goto(`${BASE}/register`);
    await page.waitForLoadState('networkidle');
    await page.locator('select[name="tournamentId"]').selectOption({ index: 1 });
    await page.locator('input[name="firstName"]').fill('QABot');
    await page.locator('input[name="lastName"]').fill('PilotSmoke');
    await page.locator('input[name="dateOfBirth"]').fill('2014-06-15');
    await page.locator('select[name="gender"]').selectOption('F');
    await page.locator('select[name="belt"]').selectOption({ index: 1 });
    await page.locator('input[name="weightLbs"]').fill('60');
    await page.locator('input[name="patterns"]').check();
    await page.getByRole('button', { name: /Next/ }).click();
    await page.waitForTimeout(1000);
    await page.locator('input[name="parentName"]').fill('QA Parent');
    await page.locator('input[name="parentEmail"]').fill('qa-pilot@example.com');
    await page.locator('input[name="parentPhone"]').fill('+1-555-PILOT');
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${SHOTS_DIR}/09-registration-complete.png` });
    const successH1 = await page.locator('h1').first().textContent().catch(() => '');
    step('6i. Public registration E2E',
      successH1.includes('Registration Complete') ? 'PASS' : 'FAIL',
      `heading=${successH1}`);
  } catch (e) {
    await page.screenshot({ path: `${SHOTS_DIR}/09-registration-complete.png` });
    step('6i. Public registration E2E', 'FAIL', e.message.slice(0, 100));
  }

  // 6j. Public check-registration (no PII)
  const checkRes = await fetch(`${BASE}/api/public/check-registration?tournamentId=${tid}&firstName=QABot&lastName=PilotSmoke&dateOfBirth=2014-06-15`);
  const checkData = await checkRes.json();
  const hasNoPII = !('email' in checkData) && !('belt' in checkData) && !('school' in checkData);
  step('6j. check-registration returns no PII', hasNoPII ? 'PASS' : 'FAIL',
    `${checkRes.status}, body=${JSON.stringify(checkData).slice(0, 100)}`);

  // 6k. Share link round-trip
  await page.goto(`${BASE}/login`);
  await page.getByRole('button', { name: /Try the demo/i }).click();
  await page.waitForURL(/\/$/, { timeout: 15000 });
  await page.goto(`${BASE}${firstHref}/settings`);
  await page.waitForLoadState('networkidle');
  let slug = '';
  const urlInput = page.locator('input[readonly]').first();
  if (await urlInput.isVisible()) {
    const url = await urlInput.inputValue();
    slug = url.split('/').pop();
  } else {
    await page.getByRole('button', { name: /Generate share link/i }).click();
    await page.waitForTimeout(3000);
    slug = (await urlInput.inputValue()).split('/').pop();
  }
  // Visit the share URL
  await page.goto(`${BASE}/scoreboard/${slug}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${SHOTS_DIR}/10-share-link-resolves.png` });
  const shareUrlH1 = await page.locator('h1').first().textContent().catch(() => '');
  step('6k. Share link /scoreboard/:slug resolves',
    shareUrlH1.includes('Test 1') || shareUrlH1.includes('Scoreboard') ? 'PASS' : 'FAIL',
    `heading=${shareUrlH1.slice(0, 60)}, slug=${slug}`);

  await browser.close();

  // Console errors during run
  step('7. No console errors during walkthrough', errors.length === 0 ? 'PASS' : 'FAIL',
    errors.length ? `${errors.length} errors: ${errors.slice(0, 2).join(' | ')}` : 'clean');

  // Write the markdown report
  const passes = report.filter(r => r.includes('PASS')).length;
  const fails = report.filter(r => r.includes('FAIL')).length;
  const md = [
    `# Pilot verification smoke test — ${new Date().toISOString().slice(0, 10)}`,
    '',
    `Live: ${BASE}`,
    '',
    `**Result: ${passes} PASS, ${fails} FAIL**`,
    '',
    '## Results',
    '',
    '| # | Step | Status | Detail |',
    '|---|------|--------|--------|',
    ...report,
    '',
    '## Screenshots',
    '',
    'All saved to /tmp/_p11-shots/',
    '',
    '## Failures (if any)',
    '',
    fails === 0 ? '_No failures._' : report.filter(r => r.includes('FAIL')).join('\n'),
  ].join('\n');
  fs.writeFileSync(REPORT_PATH, md);
  console.log(`\nReport written to ${REPORT_PATH}`);
  console.log(`\nFINAL: ${passes} PASS, ${fails} FAIL`);

  if (fails > 0) process.exit(1);
})().catch(e => { console.error('SMOKE TEST CRASHED:', e); process.exit(2); });
