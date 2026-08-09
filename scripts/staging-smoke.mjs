import { chromium, firefox, webkit } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const baseURL = process.env.STAGING_BASE_URL;
if (!baseURL?.startsWith('https://')) {
  throw new Error('STAGING_BASE_URL must be an https URL');
}

const outputDir = resolve('test-results', 'staging-smoke');
await mkdir(outputDir, { recursive: true });

for (const [name, browserType] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await browserType.launch({ headless: true });
  try {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.addInitScript(() => localStorage.setItem('bowin_tour_completed', '1'));
    await page.goto('/login', { waitUntil: 'networkidle' });
    const demoButton = page.getByRole('button', { name: /Explore the live demo/i });
    await demoButton.waitFor({ state: 'visible' });
    const demoResponsePromise = page.waitForResponse(
      (response) => response.url().endsWith('/api/auth/demo'),
    );
    await demoButton.click();
    const demoResponse = await demoResponsePromise;
    if (!demoResponse.ok()) {
      throw new Error(`${name}: /api/auth/demo returned ${demoResponse.status()} ${await demoResponse.text()}`);
    }
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));

    const meResponse = await context.request.get('/api/auth/me');
    if (!meResponse.ok()) throw new Error(`${name}: /api/auth/me returned ${meResponse.status()}`);
    const me = await meResponse.json();
    if (me.role !== 'admin') throw new Error(`${name}: demo role was ${me.role}`);

    const tournamentsResponse = await context.request.get('/api/tournaments');
    if (!tournamentsResponse.ok()) {
      throw new Error(`${name}: /api/tournaments returned ${tournamentsResponse.status()}`);
    }
    const tournaments = await tournamentsResponse.json();
    const seeded = tournaments.find((tournament) => tournament.name === 'Spring Championship 2026');
    if (!seeded) throw new Error(`${name}: fabricated tournament was not returned`);

    await page.goto('/tournaments', { waitUntil: 'networkidle' });
    await page.getByText('Spring Championship 2026').first().waitFor({ state: 'visible' });
    await page.screenshot({ path: `${outputDir}/${name}-tournaments.png`, fullPage: true });

    for (const path of [
      `/tournaments/${seeded.id}`,
      `/checkin/${seeded.id}`,
      `/scorekeeper/${seeded.id}`,
    ]) {
      const response = await page.goto(path, { waitUntil: 'networkidle' });
      if (!response?.ok()) throw new Error(`${name}: ${path} returned ${response?.status()}`);
      if (page.url().includes('/login')) throw new Error(`${name}: ${path} redirected to login`);
    }

    if (pageErrors.length) throw new Error(`${name}: page errors: ${pageErrors.join(' | ')}`);
    console.log(`${name}: PASS tournament=${seeded.id}`);
    await context.close();
  } finally {
    await browser.close();
  }
}
