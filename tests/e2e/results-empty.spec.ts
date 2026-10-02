import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { loginAsEmail, skipOnboardingTour, withE2EPrisma } from './helpers';

// Before any match is scored, Results says so plainly instead of showing
// an empty medal table.
test('results page explains when there are no results yet', async ({ page }) => {
  const tournamentId = randomUUID();
  const email = `results-empty-${randomUUID()}@example.test`;
  await withE2EPrisma(async (prisma) => {
    await prisma.tournament.create({ data: { id: tournamentId, name: '[E2E] Results Empty', date: new Date('2030-03-01') } });
    await prisma.user.create({ data: { email, firstName: 'Results', lastName: 'Viewer', role: 'admin' } });
  });

  try {
    await skipOnboardingTour(page);
    await loginAsEmail(page, email);
    await page.goto(`/tournaments/${tournamentId}/results`);
    await expect(page.getByRole('heading', { name: 'No results yet' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'School' })).toHaveCount(0);
  } finally {
    await withE2EPrisma(async (prisma) => {
      await prisma.tournament.deleteMany({ where: { id: tournamentId } });
      await prisma.magicLink.deleteMany({ where: { email } });
      await prisma.user.deleteMany({ where: { email } });
    });
  }
});
