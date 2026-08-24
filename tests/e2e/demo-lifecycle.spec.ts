import { expect, test } from '@playwright/test';

test.describe('guided fabricated showcase', () => {
  const journeys = [
    { name: 'Director command centre', url: /\/tournaments\/00000000-0000-4000-8000-000000000003\/director$/, heading: /Director Dashboard/i },
    { name: 'Scorekeeper station', url: /\/scorekeeper\/00000000-0000-4000-8000-000000000003$/, heading: /^Scorekeeper$/i },
    { name: 'Athlete check-in', url: /\/checkin\/00000000-0000-4000-8000-000000000003$/, heading: /^Check-In$/i },
    { name: 'Parent scoreboard', url: /\/scoreboard\/parent\/00000000-0000-4000-8000-000000000003\?key=bowin-demo-live-championship$/, heading: /Bowin Live Championship \(Demo\)/i },
    { name: 'Venue display', url: /\/scoreboard\/bowin-demo-live-championship$/, heading: /Bowin Live Championship \(Demo\)/i },
  ];

  for (const journey of journeys) {
    test(`reaches ${journey.name} in exactly two choices`, async ({ page }) => {
      await page.goto('/login');
      await page.getByRole('button', { name: 'Explore the live demo' }).click();
      await expect(page).toHaveURL('/');
      await expect(page.getByRole('status', { name: 'Fabricated demo data notice' })).toBeVisible();

      const guide = page.getByRole('dialog', { name: 'Choose your tournament-day view' });
      await expect(guide).toBeVisible();
      await expect(guide.getByText('Everything here is fabricated.')).toBeVisible();
      await expect(guide.getByText(/Self-service reset is not available/i)).toBeVisible();
      await expect(page.getByText(/Welcome to Bowin/i)).toHaveCount(0);

      await guide.getByRole('button', { name: new RegExp(journey.name, 'i') }).click();
      await expect(page).toHaveURL(journey.url);
      await expect(page.getByRole('status', { name: 'Fabricated demo data notice' })).toBeVisible();
      await expect(page.getByRole('heading', { name: journey.heading }).first()).toBeVisible();
    });
  }

  test('dismissed guide remains restartable from the dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Explore the live demo' }).click();
    const guide = page.getByRole('dialog', { name: 'Choose your tournament-day view' });
    await guide.getByRole('button', { name: 'Close demo guide' }).click();
    await expect(guide).toBeHidden();
    await page.getByRole('button', { name: 'Open demo guide' }).click();
    await expect(guide).toBeVisible();
  });

  test('keeps keyboard focus during later dashboard query renders', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Explore the live demo' }).click();
    const guide = page.getByRole('dialog', { name: 'Choose your tournament-day view' });
    const scorekeeper = guide.getByRole('button', { name: /Scorekeeper station/i });
    await scorekeeper.focus();
    await page.waitForTimeout(1_000);
    await expect(scorekeeper).toBeFocused();
  });

  test('records a fabricated result through the demo capability boundary', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Explore the live demo' }).click();
    const guide = page.getByRole('dialog', { name: 'Choose your tournament-day view' });
    await guide.getByRole('button', { name: /Scorekeeper station/i }).click();
    await page.getByRole('button', { name: /\d+ ready/i }).first().click();
    await page.locator('button[aria-label*="select as winner"]').first().click();
    await page.locator('#scorekeeper-score1').fill('5');
    await page.locator('#scorekeeper-score2').fill('2');
    await page.getByRole('button', { name: /^Record Result$/i }).click();
    const responsePromise = page.waitForResponse((response) =>
      response.request().method() === 'PUT' && /\/api\/brackets\/match\/[^/]+$/.test(new URL(response.url()).pathname)
    );
    await page.getByRole('dialog', { name: /Confirm Result/i }).getByRole('button', { name: /^Confirm/i }).click();
    expect((await responsePromise).status()).toBe(200);
    await expect(page.getByRole('dialog', { name: /Confirm Result/i })).toBeHidden();
  });

  test('updates fabricated check-in and exposes the shared result to a second demo session', async ({ page, browser }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Explore the live demo' }).click();
    const guide = page.getByRole('dialog', { name: 'Choose your tournament-day view' });
    await guide.getByRole('button', { name: /Athlete check-in/i }).click();
    await page.getByRole('button', { name: /^Check In$/i }).first().click();
    const competitorName = await page.getByRole('dialog').locator('h2, h3').first().textContent();
    await page.getByRole('spinbutton', { name: 'Enter weight' }).fill('150');
    const responsePromise = page.waitForResponse((response) =>
      response.request().method() === 'PUT' && /\/api\/tournaments\/[^/]+\/registrations\/[^/]+$/.test(new URL(response.url()).pathname)
    );
    await page.getByRole('button', { name: /Confirm Check-In/i }).click();
    expect((await responsePromise).status()).toBe(200);

    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    await secondPage.goto('/login');
    await secondPage.getByRole('button', { name: 'Explore the live demo' }).click();
    await secondPage.getByRole('dialog', { name: 'Choose your tournament-day view' })
      .getByRole('button', { name: /Athlete check-in/i }).click();
    if (competitorName) {
      const cleanName = competitorName.replace(/^Check In:\s*/i, '').trim();
      await secondPage.locator('input[placeholder*="Search"]').first().fill(cleanName);
    }
    await expect(secondPage.getByRole('button', { name: /^Undo$/i }).first()).toBeVisible();
    await secondContext.close();
  });
});
