import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { loginAsEmail, skipOnboardingTour, withE2EPrisma } from './helpers';

// The full-screen "Add competitors" picker narrows the registry by age on
// the tournament day, belt, gender and school so a director can build a
// small age group and add everyone shown in one go.
test('filter the registry by age and belt, then add everyone shown', async ({ page }) => {
  const stamp = `${Date.now()}${test.info().project.name.replace(/\W/g, '')}`;
  const email = `picker-${stamp}@example.test`;
  const tournamentId = randomUUID();
  const school = `Picker Dojang ${stamp}`;
  const people = [
    { firstName: 'Ana', dob: '2016-03-01', belt: 'Yellow', gender: 'F' }, // 10 on 2026-09-01
    { firstName: 'Bo', dob: '2015-12-01', belt: 'Yellow', gender: 'M' },  // 10
    { firstName: 'Cy', dob: '2016-05-01', belt: 'Black', gender: 'M' },   // 10, black belt
    { firstName: 'Di', dob: '2010-01-01', belt: 'Yellow', gender: 'F' },  // 16
  ];
  const ids = people.map(() => randomUUID());
  await withE2EPrisma(async (prisma) => {
    await prisma.user.create({ data: { email, firstName: 'Picker', lastName: 'Director', role: 'admin' } });
    await prisma.tournament.create({ data: { id: tournamentId, name: `[E2E] Picker ${stamp}`, date: new Date('2026-09-01T00:00:00Z') } });
    await prisma.competitor.createMany({
      data: people.map((p, i) => ({
        id: ids[i], firstName: p.firstName, lastName: `Pick${stamp}`, gender: p.gender, belt: p.belt,
        danRank: p.belt === 'Black' ? 1 : null, dateOfBirth: new Date(`${p.dob}T00:00:00Z`), weightLbs: 70, schoolDojang: school,
      })),
    });
  });

  try {
    await skipOnboardingTour(page);
    await loginAsEmail(page, email);
    await page.goto(`/tournaments/${tournamentId}`);
    await page.getByRole('button', { name: 'Add Competitors' }).first().click();
    const picker = page.getByRole('dialog', { name: 'Add competitors' });
    await expect(picker).toBeVisible();

    // Narrow to this test's school, ages 9-11, yellow belts.
    if (await picker.getByRole('button', { name: /^Filters/ }).isVisible()) {
      await picker.getByRole('button', { name: /^Filters/ }).click();
    }
    await picker.getByLabel('School', { exact: true }).selectOption(school);
    await picker.getByLabel('Youngest age').fill('9');
    await picker.getByLabel('Oldest age').fill('11');
    await picker.getByRole('button', { name: 'Yellow', exact: true }).click();
    await expect(picker.getByText('Showing 2 of')).toBeVisible();
    await expect(picker.getByRole('checkbox', { name: `Select Ana Pick${stamp}` })).toBeVisible();
    await expect(picker.getByRole('checkbox', { name: `Select Bo Pick${stamp}` })).toBeVisible();

    await picker.getByRole('button', { name: 'Select all 2 shown' }).click();
    await picker.getByRole('button', { name: 'Add 2 competitors' }).click();
    await expect(picker).toBeHidden();

    const registered = await withE2EPrisma((prisma) => prisma.registration.findMany({
      where: { tournamentId }, select: { competitorId: true },
    }));
    expect(registered.map((r) => r.competitorId).sort()).toEqual([ids[0], ids[1]].sort());
  } finally {
    await withE2EPrisma(async (prisma) => {
      await prisma.tournament.deleteMany({ where: { id: tournamentId } });
      await prisma.competitor.deleteMany({ where: { id: { in: ids } } });
      await prisma.magicLink.deleteMany({ where: { email } });
      await prisma.user.deleteMany({ where: { email } });
    });
  }
});
