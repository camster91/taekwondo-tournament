import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { loginAsEmail, skipOnboardingTour, withE2EPrisma } from './helpers';

// Auto-generating divisions saves a backup first. The Backup & Restore
// panel must show it straight away, not keep saying "No backup yet" until
// the page is reloaded.
test('backup panel shows the backup made by auto-generate', async ({ page }) => {
  const tournamentId = randomUUID();
  const competitorId = randomUUID();
  const email = `division-backup-${randomUUID()}@example.test`;
  await withE2EPrisma(async (prisma) => {
    await prisma.tournament.create({ data: { id: tournamentId, name: '[E2E] Division Backup Panel', date: new Date('2030-03-01') } });
    await prisma.user.create({ data: { email, firstName: 'Backup', lastName: 'Director', role: 'admin' } });
    await prisma.competitor.create({ data: { id: competitorId, firstName: 'Amina', lastName: 'Rahman', gender: 'F', dateOfBirth: new Date('2020-01-01'), belt: 'Yellow', schoolDojang: 'North Star' } });
    await prisma.registration.create({ data: { tournamentId, competitorId, patterns: true, ageAtTournament: 10 } });
  });

  try {
    await skipOnboardingTour(page);
    await loginAsEmail(page, email);
    await page.goto(`/tournaments/${tournamentId}/divisions`);
    await expect(page.getByText(/No backup yet/)).toBeVisible();

    await page.getByRole('button', { name: 'Auto-Generate Divisions' }).click();
    await expect(page.getByText(/Last backup:/)).toBeVisible();
    await expect(page.getByText(/No backup yet/)).toHaveCount(0);
  } finally {
    await withE2EPrisma(async (prisma) => {
      await prisma.tournament.deleteMany({ where: { id: tournamentId } });
      await prisma.competitor.deleteMany({ where: { id: competitorId } });
      await prisma.magicLink.deleteMany({ where: { email } });
      await prisma.user.deleteMany({ where: { email } });
    });
  }
});
