import { expect, test } from '@playwright/test';
import { checkA11y } from './axe-helper';
import { loginAsEmail, skipOnboardingTour, withE2EPrisma } from './helpers';

// #192: a director staffs rings, sees gaps and double-bookings, and a staff
// member sees only their own run sheet. The tournament is org-less (legacy
// pool) so both users, who belong to no organization, can open it.

test.describe.configure({ mode: 'serial' });

test('director staffs rings and a staff member sees only their own assignments', async ({ page, browser }) => {
  const stamp = `${Date.now()}-${test.info().project.name}`;
  const directorEmail = `e2e-staffing-director-${stamp}@example.com`;
  const staffEmail = `e2e-staffing-staff-${stamp}@example.com`;

  const { tournamentId } = await withE2EPrisma(async (prisma) => {
    const director = await prisma.user.create({
      data: { email: directorEmail, firstName: 'E2E', lastName: 'StaffDirector', role: 'director' },
    });
    await prisma.user.create({
      data: { email: staffEmail, firstName: 'Casey', lastName: 'Keeper', role: 'scorekeeper' },
    });
    const tournament = await prisma.tournament.create({
      data: {
        name: `E2E Staffing ${stamp}`,
        date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdById: director.id,
        settings: JSON.stringify({ schedule: { startTime: '09:00', endTime: '12:00', ringCount: 2 } }),
      },
    });
    return { tournamentId: tournament.id };
  });

  const staffContext = await browser.newContext();
  try {
    await skipOnboardingTour(page);
    await loginAsEmail(page, directorEmail);
    await page.goto(`/tournaments/${tournamentId}/staffing`);

    const summary = page.getByTestId('coverage-summary');
    await expect(summary).toHaveText(/0 of 2 rings fully staffed · 2 gaps · 0 double-bookings/);
    await expect(page.getByText('Ring 1: no scorekeeper 09:00–12:00')).toBeVisible();

    // Staff Ring 1 for the whole window (times default to the schedule window).
    const form = page.getByRole('form', { name: 'Add assignment' });
    await form.getByLabel('Person').selectOption({ label: `Casey Keeper (${staffEmail})` });
    await form.getByLabel('Where').selectOption({ label: 'Ring 1' });
    await form.getByRole('button', { name: 'Add assignment' }).click();
    await expect(summary).toHaveText(/1 of 2 rings fully staffed · 1 gap · 0 double-bookings/);

    // Book the same person on Ring 2 for the first hour: a double-booking.
    await form.getByLabel('Person').selectOption({ label: `Casey Keeper (${staffEmail})` });
    await form.getByLabel('Where').selectOption({ label: 'Ring 2' });
    await form.getByLabel('End').fill('10:00');
    await form.getByRole('button', { name: 'Add assignment' }).click();
    await expect(summary).toHaveText(/1 of 2 rings fully staffed · 1 gap · 1 double-booking/);
    await expect(page.getByText('Casey Keeper is double-booked 09:00–10:00')).toBeVisible();

    const a11y = await checkA11y(page);
    expect(a11y.violations.map((v) => v.id)).toEqual([]);

    // The staff member's run sheet: their lines only, no competitor data.
    const staffPage = await staffContext.newPage();
    await skipOnboardingTour(staffPage);
    await loginAsEmail(staffPage, staffEmail);
    await staffPage.goto('/my-assignments');
    await expect(staffPage.getByRole('heading', { name: `E2E Staffing ${stamp}` })).toBeVisible();
    await expect(staffPage.getByText('Scorekeeper · Ring 1')).toBeVisible();
    await expect(staffPage.getByText('Scorekeeper · Ring 2')).toBeVisible();
    // A scorekeeper cannot open the director board.
    const denied = await staffPage.request.get(`/api/staffing/tournament/${tournamentId}`);
    expect(denied.status()).toBe(403);

    // Withdrawing the Ring 2 line clears the double-booking and keeps history.
    await page.getByRole('button', { name: /Withdraw Casey Keeper from Ring 2 09:00–10:00/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Withdraw' }).click();
    await expect(summary).toHaveText(/1 of 2 rings fully staffed · 1 gap · 0 double-bookings/);
    await expect(page.getByText('Withdrawn (1)')).toBeVisible();

    await staffPage.reload();
    await expect(staffPage.getByText('Scorekeeper · Ring 1')).toBeVisible();
    await expect(staffPage.getByText('Scorekeeper · Ring 2')).toHaveCount(0);

    // The director dashboard shows the same coverage.
    await page.goto(`/tournaments/${tournamentId}/director`);
    await expect(page.getByTestId('director-staff-coverage')).toHaveText(/1 of 2 rings fully staffed · 1 gap · 0 double-bookings/);
  } finally {
    await staffContext.close();
    await withE2EPrisma(async (prisma) => {
      await prisma.tournament.deleteMany({ where: { id: tournamentId } });
      await prisma.magicLink.deleteMany({ where: { email: { in: [directorEmail, staffEmail] } } });
      await prisma.user.deleteMany({ where: { email: { in: [directorEmail, staffEmail] } } });
    });
  }
});
