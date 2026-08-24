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
  await expect(page.getByRole('button', { name: 'Close support chat' })).toBeVisible();
  await expect(page.locator('#supportName')).toHaveAttribute('aria-required', 'true');
  await expect(page.locator('#supportEmail')).toHaveAttribute('aria-required', 'true');
  await expect(page.getByLabel('Describe your issue')).toHaveAttribute('aria-describedby', 'support-send-hint');
  await expect(page.locator('#support-send-hint')).toContainText('Enter your name and email before sending.');
  await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
});
