import { expect, test } from '@playwright/test';

test.describe('marketing conversion flow', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/'); });

  test('presents one clear product story and working conversion paths', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1, name: /run the tournament/i })).toBeVisible();
    await expect(page.getByText('Illustrative interface, not live event data.')).toBeVisible();
    // The launch redesign (14197b4) made organizer setup the primary CTA and
    // moved sign-in to the header and public registration to the footer.
    await expect(page.getByRole('link', { name: /plan organizer setup/i }).first()).toHaveAttribute('href', /^mailto:/);
    await expect(page.getByRole('banner').getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    await expect(page.getByRole('navigation', { name: 'Footer navigation' }).getByRole('link', { name: 'Public registration' })).toHaveAttribute('href', '/register');
    await expect(page.locator('main #product')).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: 'Footer navigation' }).getByRole('link', { name: 'Privacy Notice' })).toHaveAttribute('href', '/legal/privacy');
    await expect(page.getByRole('navigation', { name: 'Footer navigation' }).getByRole('link', { name: 'Tournament Terms' })).toHaveAttribute('href', '/legal/terms');
  });

  test('publishes route-specific SEO metadata and structured data', async ({ page }) => {
    await expect(page).toHaveTitle('Bowin | Martial Arts Tournament Management Software');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /registration, divisions, brackets/i);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://tkd.ashbi.ca/');
    const jsonLd = await page.locator('script[data-bowin-marketing="true"]').textContent();
    expect(JSON.parse(jsonLd || '{}')).toMatchObject({ '@type': 'SoftwareApplication', name: 'Bowin' });
  });

  test('keeps answers keyboard-accessible', async ({ page }) => {
    await page.getByText('Does the AI make changes automatically?').click();
    await expect(page.getByText(/only organization-approved integrations/i)).toBeVisible();
  });

  test('does not create horizontal overflow on a phone viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    await expect(page.getByRole('heading', { level: 2, name: /help at the point of confusion/i })).toBeVisible();
  });
});
