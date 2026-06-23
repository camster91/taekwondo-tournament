const { chromium } = require('@playwright/test');
const BASE = 'https://tkd.ashbi.ca';
const log = (...a) => console.log('[S0]', ...a);

(async () => {
  const browser = await chromium.launch({ headless: true });

  // Test F1 + F4 — Public registration with family re-entry + age-band preview
  log('=== F1 + F4 ===');
  let page = await browser.newContext().then(c => c.newPage());
  page.on('pageerror', e => console.log('[page-error]', e.message.slice(0, 200)));
  await page.goto(`${BASE}/register`);
  await page.waitForLoadState('networkidle');
  await page.locator('select[name="tournamentId"]').selectOption({ index: 1 });
  await page.locator('input[name="firstName"]').fill('FirstKid');
  await page.locator('input[name="lastName"]').fill('LastKid');
  await page.locator('input[name="dateOfBirth"]').fill('2013-06-15');
  await page.locator('select[name="gender"]').selectOption('M');
  await page.locator('select[name="belt"]').selectOption({ index: 1 });
  await page.locator('input[name="weightLbs"]').fill('70');
  await page.locator('input[name="patterns"]').check();
  // F4 check: age-band preview should be visible
  await page.waitForTimeout(300);
  const preview = await page.locator('[role="status"]').first().textContent();
  log('  age-band preview:', preview?.trim());
  // Click Next
  await page.getByRole('button', { name: /Next/ }).click();
  await page.waitForTimeout(1000);
  // Step 2
  await page.locator('input[name="parentName"]').fill('Parent A');
  await page.locator('input[name="parentEmail"]').fill('parent-a@example.com');
  await page.locator('input[name="parentPhone"]').fill('+1-555-0001');
  await page.locator('button[type="submit"]').click();
  await page.waitForTimeout(2000);
  log('  after submit 1, URL:', page.url());
  // Should see Registration Complete
  const successHeading = await page.locator('h1').first().textContent();
  log('  success heading:', successHeading?.trim());
  // F1 check: click "Register Another Competitor", verify parent fields preserved
  await page.getByRole('button', { name: /Register Another/i }).click();
  await page.waitForTimeout(1000);
  await page.waitForLoadState('networkidle');
  // Click Next to step 2 to verify parent fields are preserved
  await page.locator('input[name="firstName"]').fill('SecondKid');
  await page.locator('input[name="lastName"]').fill('LastKid');
  await page.locator('input[name="dateOfBirth"]').fill('2015-03-20');
  await page.locator('input[name="weightLbs"]').fill('55');
  await page.locator('input[name="patterns"]').check();
  await page.getByRole('button', { name: /Next/ }).click();
  await page.waitForTimeout(1000);
  const parentName = await page.locator('input[name="parentName"]').inputValue();
  const parentEmail = await page.locator('input[name="parentEmail"]').inputValue();
  log('  parent name after re-entry:', parentName);
  log('  parent email after re-entry:', parentEmail);
  if (parentName === 'Parent A' && parentEmail === 'parent-a@example.com') {
    log('  ✓ F1 — parent fields preserved correctly');
  } else {
    log('  ✗ F1 FAILED — parent fields not preserved');
  }
  await browser.close();
})().catch(e => { console.error('err:', e.message); process.exit(1); });
