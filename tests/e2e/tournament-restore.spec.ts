import { expect, test } from '@playwright/test';
import { loginAsEmail, skipOnboardingTour, withE2EPrisma } from './helpers';

// Deleting a tournament only hides it. The director must be able to find
// it under "Deleted tournaments" and restore it with its data intact.
test('a deleted tournament can be restored from Deleted tournaments', async ({ page }) => {
  const stamp = `${Date.now()}-${test.info().project.name}`;
  const email = `e2e-restore-${stamp}@example.com`;
  const name = `E2E Restore ${stamp}`;
  const { tournamentId } = await withE2EPrisma(async (prisma) => {
    const director = await prisma.user.create({
      data: { email, firstName: 'E2E', lastName: 'Restorer', role: 'director' },
    });
    const tournament = await prisma.tournament.create({
      data: { name, date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), createdById: director.id },
    });
    return { tournamentId: tournament.id };
  });

  try {
    await skipOnboardingTour(page);
    await loginAsEmail(page, email);
    await page.goto('/tournaments');

    await page.getByRole('button', { name: `Delete ${name}` }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('you can restore it from Deleted tournaments');
    await dialog.getByRole('button', { name: 'Delete Tournament' }).click();
    await expect(page.getByRole('button', { name: `Delete ${name}` })).toBeHidden();

    await page.getByRole('link', { name: 'Deleted' }).click();
    await expect(page.getByRole('heading', { name: 'Deleted tournaments' })).toBeVisible();
    await page.getByRole('button', { name: `Restore ${name}` }).click();
    await expect(page.getByRole('button', { name: `Restore ${name}` })).toBeHidden();

    await page.getByRole('link', { name: 'Back to tournaments' }).click();
    await expect(page.getByRole('button', { name: `Delete ${name}` })).toBeVisible();
    const restored = await withE2EPrisma((prisma) =>
      prisma.tournament.findUnique({ where: { id: tournamentId }, select: { deletedAt: true } }),
    );
    expect(restored?.deletedAt).toBeNull();
  } finally {
    await withE2EPrisma(async (prisma) => {
      await prisma.tournament.deleteMany({ where: { id: tournamentId } });
      await prisma.magicLink.deleteMany({ where: { email } });
      await prisma.user.deleteMany({ where: { email } });
    });
  }
});
