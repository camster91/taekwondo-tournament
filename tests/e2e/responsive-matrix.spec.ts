import { expect, test } from '@playwright/test';

for (const viewport of [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'laptop', width: 1024, height: 768 },
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'wide', width: 1920, height: 1080 },
]) {
  test(`login remains usable without horizontal overflow at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/login');
    const layout = await page.evaluate(() => ({
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
    await expect(page.getByLabel('Email address')).toBeVisible();
    await expect(page.getByRole('button', { name: /Send sign-in link/i })).toBeVisible();
  });
}

test('mobile form controls meet the 44px touch-target minimum', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/login');
  const input = page.getByLabel('Email address');
  const button = page.getByRole('button', { name: /Send sign-in link/i });
  // boundingBox() does not wait; measure only after the sign-in card renders.
  await expect(input).toBeVisible();
  await expect(button).toBeVisible();
  const inputBox = await input.boundingBox();
  const buttonBox = await button.boundingBox();
  expect(inputBox?.height).toBeGreaterThanOrEqual(44);
  expect(buttonBox?.height).toBeGreaterThanOrEqual(44);
});
