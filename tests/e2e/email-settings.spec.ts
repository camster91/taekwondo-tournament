import { expect, test } from '@playwright/test';
import { loginAsEmail, skipOnboardingTour, withE2EPrisma } from './helpers';

// Root admin sets up email delivery in the app. The e2e server runs without
// Mailgun, so the page starts at "not set up". Saving fake settings must
// switch it to "set up" (key shown only by its last 4 characters), and the
// test always removes them again so the rest of the suite keeps dev-mode
// sign-in.
test('admin can save and remove Mailgun settings', async ({ page }) => {
  const email = `email-settings-${Date.now()}-${test.info().project.name}@example.test`;
  await withE2EPrisma((prisma) => prisma.user.create({ data: { email, firstName: 'Root', lastName: 'Admin', role: 'admin' } }));

  try {
    await skipOnboardingTour(page);
    await loginAsEmail(page, email);
    await page.goto('/admin/email');
    await expect(page.getByRole('heading', { name: 'Email delivery' })).toBeVisible();
    await expect(page.getByText('Email is not set up.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send test email to me' })).toBeDisabled();

    // A sender off the sending domain is refused before anything is saved.
    await page.getByLabel('Mailgun API key').fill('key-e2e-not-real-123456');
    await page.getByLabel('Sending domain').fill('mg.example.test');
    await page.getByLabel('Sender name').fill('E2E Club');
    await page.getByLabel('Sender address').fill('noreply@other.test');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByRole('alert')).toContainText('The sender address should be on mg.example.test');

    await page.getByLabel('Sender address').fill('noreply@mg.example.test');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText(/Email is set up: sending as/)).toBeVisible();
    await expect(page.getByText(/key ending 3456/)).toBeVisible();
    await expect(page.getByLabel('Mailgun API key')).toHaveValue('');

    const row = await withE2EPrisma((prisma) => prisma.platformSetting.findUnique({ where: { key: 'email.mailgun' } }));
    expect(row?.value).toBeTruthy();
    expect(row?.value).not.toContain('key-e2e-not-real-123456');

    await page.getByRole('button', { name: 'Remove saved settings' }).click();
    await expect(page.getByText('Email is not set up.')).toBeVisible();
  } finally {
    // Never leave fake Mailgun settings active for the rest of the suite.
    await page.request.delete('/api/admin/email-settings', {
      headers: { 'X-CSRF-Token': (await page.context().cookies()).find((c) => c.name === 'bowin_csrf')?.value ?? '' },
    }).catch(() => undefined);
    await withE2EPrisma(async (prisma) => {
      await prisma.platformSetting.deleteMany({ where: { key: 'email.mailgun' } });
      await prisma.magicLink.deleteMany({ where: { email } });
      await prisma.user.deleteMany({ where: { email } });
    });
  }
});
