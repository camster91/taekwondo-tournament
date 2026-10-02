import { expect, test } from '@playwright/test';
import { withE2EPrisma } from './helpers';

// A parent asks for their link, opens it, sees the registration and opens
// the change/withdraw page from it. Dev mode returns the emailed link.
test('parent sees their registrations from an emailed link', async ({ page }, testInfo) => {
  const email = `e2e-family-${testInfo.project.name}-${Date.now()}@example.com`;
  const ids = await withE2EPrisma(async (prisma) => {
    const tournament = await prisma.tournament.create({
      data: { name: `E2E Family Open ${testInfo.project.name}`, date: new Date('2027-06-12T15:00:00Z'), location: 'E2E Sports Hall', status: 'registration' },
    });
    const competitor = await prisma.competitor.create({
      data: { firstName: 'Lina', lastName: 'E2E Family', gender: 'F', dateOfBirth: new Date('2015-04-02'), belt: 'Green' },
    });
    await prisma.registration.create({
      data: { tournamentId: tournament.id, competitorId: competitor.id, patterns: true, sparring: false, parentEmail: email },
    });
    return { tournamentId: tournament.id, competitorId: competitor.id };
  });

  try {
    await page.goto('/my-registrations');
    await page.getByLabel('Your email').fill(email);
    await page.getByRole('button', { name: 'Email me a link' }).click();
    await expect(page.getByText('Check your email')).toBeVisible();

    await page.getByTestId('family-dev-link').click();
    await expect(page.getByRole('heading', { name: 'Lina E2E Family' })).toBeVisible();
    await expect(page.getByText(`E2E Family Open ${testInfo.project.name}`)).toBeVisible();
    await expect(page.getByText('E2E Sports Hall')).toBeVisible();
    await expect(page.getByText('Registered', { exact: true })).toBeVisible();
    // The private link is removed from the address bar.
    expect(page.url()).not.toContain('token=');

    await page.getByRole('button', { name: 'Change or withdraw' }).click();
    await expect(page).toHaveURL(/\/manage-registration\?token=/);
    await expect(page.getByRole('heading', { name: 'Lina E2E Family' })).toBeVisible();
  } finally {
    await withE2EPrisma(async (prisma) => {
      await prisma.familyAccessLink.deleteMany({ where: { email } });
      await prisma.tournament.delete({ where: { id: ids.tournamentId } });
      await prisma.competitor.delete({ where: { id: ids.competitorId } });
    });
  }
});

test('unknown email gets the same answer and no link', async ({ request }) => {
  const res = await request.post('/api/public/family/request-link', { data: { email: 'nobody-e2e-family@example.com' } });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.message).toContain('If we have registrations');
  expect(body.devAccessUrl).toBeUndefined();

  const list = await request.post('/api/public/family/registrations', { data: { token: 'x'.repeat(43) } });
  expect(list.status()).toBe(401);
});
