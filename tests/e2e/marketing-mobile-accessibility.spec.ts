import { expect, test } from '@playwright/test';

test('mobile marketing navigation and anonymous support intake remain accessible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await expect(page.getByRole('link', { name: 'Plan organizer setup' }).first()).toHaveAttribute(
    'href',
    'mailto:support@ashbi.ca?subject=Bowin%20organizer%20setup',
  );

  await page.locator('.bowin-mobile-nav summary').click();
  const mobileNavigation = page.getByRole('navigation', { name: 'Mobile marketing navigation' });
  await expect(mobileNavigation).toBeVisible();
  await expect(mobileNavigation.getByRole('link', { name: 'Product screens', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Open support chat' }).click();
  const supportPanel = page.getByRole('dialog', { name: 'Support Assistant' });
  await expect(supportPanel).toBeVisible();
  await expect(page.getByLabel('Describe your issue')).toBeFocused();
  await expect(page.locator('#supportName')).toHaveCount(0);
  await expect(page.locator('#supportEmail')).toHaveCount(0);

  await page.route('**/api/support', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ answer: 'Synthetic help response.', escalated: false, ticket: null }),
    });
  });
  await page.getByLabel('Describe your issue').fill('How do I find public registration?');
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(supportPanel.getByText('Synthetic help response.')).toBeVisible();

  await page.getByLabel('Escalate to support').check();
  await expect(page.locator('#supportName')).toHaveAttribute('aria-required', 'true');
  await expect(page.locator('#supportEmail')).toHaveAttribute('aria-required', 'true');
  await expect(supportPanel.getByRole('link', { name: 'Privacy Notice' })).toHaveAttribute('href', '/legal/privacy');

  await page.keyboard.press('Escape');
  await expect(supportPanel).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open support chat' })).toBeFocused();
});
