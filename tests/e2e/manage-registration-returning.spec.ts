import { createHash, randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { withE2EPrisma } from './helpers';

// A competitor registered in two tournaments shares one Competitor row, so
// the management link hides gender/belt/school. The page must still load
// and let the family change what they can.
test('a returning competitor can still manage their registration', async ({ page }, testInfo) => {
  const token = randomBytes(32).toString('base64url');
  const ids = await withE2EPrisma(async (prisma) => {
    const competitor = await prisma.competitor.create({
      data: { firstName: 'Rowan', lastName: 'E2E Returning', gender: 'M', dateOfBirth: new Date('2014-03-03'), belt: 'Blue', schoolDojang: 'E2E North Dojang' },
    });
    const earlier = await prisma.tournament.create({
      data: { name: `E2E Returning Fall ${testInfo.project.name}`, date: new Date('2026-01-10T15:00:00Z'), status: 'completed' },
    });
    const next = await prisma.tournament.create({
      data: { name: `E2E Returning Spring ${testInfo.project.name}`, date: new Date('2027-05-10T15:00:00Z'), status: 'registration' },
    });
    await prisma.registration.create({ data: { tournamentId: earlier.id, competitorId: competitor.id, patterns: true } });
    await prisma.registration.create({
      data: {
        tournamentId: next.id, competitorId: competitor.id, patterns: true,
        managementTokenHash: createHash('sha256').update(token).digest('hex'),
        managementTokenExpiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    return { competitorId: competitor.id, tournamentIds: [earlier.id, next.id] };
  });

  try {
    await page.goto(`/manage-registration?token=${token}`);
    await expect(page.getByRole('heading', { name: 'Rowan E2E Returning' })).toBeVisible();
    await expect(page.getByText('Kept by the organizer. Ask them if this needs to change.').first()).toBeVisible();

    await page.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByLabel('First name')).toHaveCount(0);
    await page.getByLabel('Special considerations / accommodations').fill('Needs a water break');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status')).toContainText('Saved at');
  } finally {
    await withE2EPrisma(async (prisma) => {
      await prisma.tournament.deleteMany({ where: { id: { in: ids.tournamentIds } } });
      await prisma.competitor.deleteMany({ where: { id: ids.competitorId } });
    });
  }
});
