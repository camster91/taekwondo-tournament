import { expect, test } from '@playwright/test';
import { loginAsEmail, skipOnboardingTour, withE2EPrisma } from './helpers';

// "Report a bug" saves a support ticket tagged as a bug report, with the
// page it was filed from, and it can be filtered on Support Tickets.
test('a signed-in user can report a bug and it lands in Support Tickets', async ({ page }) => {
  const stamp = `${Date.now()}-${test.info().project.name}`;
  const email = `report-bug-${stamp}@example.test`;
  const title = `E2E bug ${stamp}`;
  await withE2EPrisma((prisma) => prisma.user.create({ data: { email, firstName: 'Bug', lastName: 'Reporter', role: 'admin' } }));

  try {
    await skipOnboardingTour(page);
    await loginAsEmail(page, email);
    await page.goto('/competitors');

    await page.getByRole('button', { name: 'Report a bug' }).click();
    const dialog = page.getByRole('dialog', { name: 'Report a bug' });
    await dialog.getByLabel('Short title').fill(title);
    await dialog.getByLabel('What happened?').fill('The import button did nothing when I clicked it.');
    await dialog.getByLabel('How bad is it?').selectOption('high');
    await dialog.getByRole('button', { name: 'Send report' }).click();
    await expect(page.getByText('Thanks! Your bug report was sent.')).toBeVisible();
    await expect(dialog).toBeHidden();

    const ticket = await withE2EPrisma((prisma) => prisma.supportTicket.findFirst({ where: { subject: title } }));
    expect(ticket).toMatchObject({ source: 'bug-report', priority: 'high', status: 'open', page: '/competitors', requestedByEmail: email });
    expect(ticket?.lastUserMessage).toContain('What happened: The import button did nothing');

    await page.goto('/support/tickets');
    await page.getByLabel('Type').selectOption('bug-report');
    await expect(page.getByText(title)).toBeVisible();
  } finally {
    await withE2EPrisma(async (prisma) => {
      await prisma.supportTicket.deleteMany({ where: { subject: title } });
      await prisma.magicLink.deleteMany({ where: { email } });
      await prisma.user.deleteMany({ where: { email } });
    });
  }
});
