import { expect, test } from '@playwright/test';
import { checkA11y } from './axe-helper';
import { loginAsEmail, skipOnboardingTour, withE2EPrisma } from './helpers';

// #17: the top-bar bell lists real items (a new registration, rings without
// a scorekeeper the day before the event) with an unread badge that clears
// once the panel is opened.
// #15: a director reads special-needs notes on the Divisions page, in the
// bracket editor and on check-in. The tournament is org-less (legacy pool)
// so the org-less director can manage it.

test.describe.configure({ mode: 'serial' });

test('bell shows notifications and directors see special-needs notes', async ({ page }) => {
  const stamp = `${Date.now()}-${test.info().project.name}`;
  const directorEmail = `e2e-bell-director-${stamp}@example.com`;
  const tournamentName = `E2E Bell ${stamp}`;
  const note = `E2E needs a quiet warm-up area ${stamp}`;

  const { tournamentId, divisionId } = await withE2EPrisma(async (prisma) => {
    const director = await prisma.user.create({
      data: { email: directorEmail, firstName: 'E2E', lastName: 'BellDirector', role: 'director' },
    });
    const tournament = await prisma.tournament.create({
      data: {
        name: tournamentName,
        // Tomorrow: inside the staffing-warning window.
        date: new Date(Date.now() + 24 * 60 * 60 * 1000),
        status: 'registration',
        createdById: director.id,
        settings: JSON.stringify({ schedule: { startTime: '09:00', endTime: '12:00', ringCount: 2 } }),
      },
    });
    const competitor = await prisma.competitor.create({
      data: {
        firstName: 'E2E Robin',
        lastName: `Note${stamp}`,
        gender: 'F',
        dateOfBirth: new Date('2014-05-01'),
        belt: 'Green',
        specialNeeds: note,
      },
    });
    const registration = await prisma.registration.create({
      data: { tournamentId: tournament.id, competitorId: competitor.id, patterns: true, specialNeeds: note },
    });
    const division = await prisma.division.create({
      data: {
        tournamentId: tournament.id,
        name: `E2E Bell Division ${stamp}`,
        beltLevel: 'CB',
        gender: 'F',
        eventType: 'patterns',
        ageMin: 10,
        ageMax: 13,
        assignments: { create: [{ registrationId: registration.id, seedPosition: 1 }] },
      },
    });
    return { tournamentId: tournament.id, divisionId: division.id };
  });

  try {
    await skipOnboardingTour(page);
    await loginAsEmail(page, directorEmail);
    await page.goto('/dashboard');

    // Unread badge, then the panel with plain-language items and links.
    const bell = page.getByRole('button', { name: /^Notifications, \d+ new$/ });
    await expect(bell).toBeVisible();
    await expect(page.getByTestId('notification-badge')).toBeVisible();
    await bell.click();
    const panel = page.getByRole('dialog', { name: 'Notifications' });
    await expect(panel).toBeVisible();
    const registrationItem = panel.getByRole('link', { name: new RegExp(`1 new registration.*${tournamentName}`) });
    await expect(registrationItem).toBeVisible();
    await expect(panel.getByRole('link', { name: new RegExp(`2 of 2 rings need a scorekeeper.*${tournamentName}`) })).toBeVisible();

    const a11y = await checkA11y(page, { include: ['[data-testid="notifications-panel"]'] });
    expect(a11y.violations.map((v) => v.id)).toEqual([]);

    // Opening the panel marks everything seen; Escape closes it.
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(page.getByRole('button', { name: 'Notifications' })).toBeVisible();
    await expect(page.getByTestId('notification-badge')).toHaveCount(0);

    // Links go where the item says.
    await page.getByRole('button', { name: 'Notifications' }).click();
    await page.getByRole('dialog', { name: 'Notifications' })
      .getByRole('link', { name: new RegExp(`1 new registration.*${tournamentName}`) }).click();
    await expect(page).toHaveURL(new RegExp(`/tournaments/${tournamentId}$`));

    // Divisions page: the row says who has a note; expanding shows it.
    await page.goto(`/tournaments/${tournamentId}/divisions`);
    const summary = page.getByText('1 with special needs');
    await expect(summary).toBeVisible();
    await summary.click();
    await expect(page.getByTestId('division-special-needs').getByText(note)).toBeVisible();

    // Bracket editor: a "Special needs" section with the full note.
    await page.goto(`/tournaments/${tournamentId}/divisions/${divisionId}/bracket`);
    const section = page.getByRole('region', { name: 'Special needs' });
    await expect(section.getByText(note)).toBeVisible();
    await expect(section.getByText(`E2E Robin Note${stamp}:`)).toBeVisible();

    // Check-in: the note sits under the competitor's details.
    await page.goto(`/checkin/${tournamentId}`);
    await expect(page.getByTestId('special-needs-note').filter({ hasText: note })).toBeVisible();
  } finally {
    await withE2EPrisma(async (prisma) => {
      await prisma.tournament.deleteMany({ where: { id: tournamentId } });
      await prisma.competitor.deleteMany({ where: { lastName: `Note${stamp}` } });
      await prisma.magicLink.deleteMany({ where: { email: directorEmail } });
      await prisma.user.deleteMany({ where: { email: directorEmail } });
    });
  }
});
