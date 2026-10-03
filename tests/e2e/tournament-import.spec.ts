import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
import { loginAsEmail, skipOnboardingTour, withE2EPrisma } from './helpers';

// "Import from spreadsheet" on the tournament page: rows marked in an event
// column become registrations for that event. Columns are found by the
// sport's own event names (Karate: Kata / Kumite). A competitor already in
// the list is reused as-is, and nothing is written before the preview is
// confirmed.
test('import a spreadsheet straight into a tournament', async ({ page }) => {
  const stamp = `${Date.now()}${test.info().project.name.replace(/\W/g, '')}`;
  const email = `tournament-import-${stamp}@example.test`;
  const tournamentId = randomUUID();
  const existingId = randomUUID();
  const lastName = `E2EImport${stamp}`;
  await withE2EPrisma(async (prisma) => {
    await prisma.user.create({ data: { email, firstName: 'Import', lastName: 'Director', role: 'admin' } });
    await prisma.tournament.create({
      data: { id: tournamentId, name: `E2E Import ${stamp}`, date: new Date('2026-11-14T12:00:00Z'), sportProfileSlug: 'karate' },
    });
    await prisma.competitor.create({
      data: {
        id: existingId, firstName: 'Ava', lastName, gender: 'F', belt: 'Green',
        dateOfBirth: new Date('2014-05-02T00:00:00Z'), weightLbs: 70, schoolDojang: 'E2E Dojo',
      },
    });
  });

  const sheet = XLSX.utils.aoa_to_sheet([
    ['First Name', 'Last Name', 'Gender', 'Date of Birth', 'Belt', 'Weight (lbs)', 'School', 'Kata', 'Kumite'],
    ['Ava', lastName, 'F', '2014-05-02', 'Blue', 75, 'E2E Dojo', 'Y', ''],
    ['Ben', lastName, 'M', '2012-01-20', 'Orange', 90, 'E2E Dojo', 'x', 'yes'],
    ['Cy', lastName, 'M', '2013-03-03', 'White', 60, 'E2E Dojo', '', ''],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Competitors');
  const file = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  try {
    await skipOnboardingTour(page);
    await loginAsEmail(page, email);
    await page.goto(`/tournaments/${tournamentId}`);
    await page.getByRole('button', { name: 'Import from spreadsheet' }).click();
    const dialog = page.getByRole('dialog', { name: 'Import from spreadsheet' });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel('Choose a spreadsheet to import').setInputFiles({
      name: 'club-entries.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: file,
    });

    // Preview: counts, detected event columns, skipped row. Nothing written yet.
    const preview = dialog.getByRole('region', { name: 'What will happen' });
    await expect(preview).toContainText('2 competitors will be added to this tournament');
    await expect(preview).toContainText('1 is new to your competitor list');
    await expect(preview).toContainText('1 is already in your list');
    await expect(preview).toContainText('Kata: 2 · Kumite: 1');
    await expect(preview).toContainText('1 row will be skipped');
    await expect(dialog.getByLabel('Kata column')).toHaveValue('Kata');
    await expect(dialog.getByLabel('Kumite column')).toHaveValue('Kumite');
    expect(await withE2EPrisma((prisma) => prisma.registration.count({ where: { tournamentId } }))).toBe(0);

    await dialog.getByRole('button', { name: 'Import 2 competitors' }).click();
    await expect(dialog.getByRole('status')).toContainText('2 competitors added to this tournament');
    await dialog.getByRole('button', { name: 'Close' }).last().click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(`Ben ${lastName}`).filter({ visible: true }).first()).toBeVisible();

    const result = await withE2EPrisma(async (prisma) => ({
      registrations: await prisma.registration.findMany({
        where: { tournamentId },
        select: { patterns: true, sparring: true, waitlistStatus: true, competitor: { select: { id: true, firstName: true, belt: true } } },
        orderBy: { competitor: { firstName: 'asc' } },
      }),
      competitors: await prisma.competitor.count({ where: { lastName } }),
    }));
    expect(result.competitors).toBe(2); // Ava reused, Ben created, Cy skipped
    expect(result.registrations).toEqual([
      // The existing record keeps its own belt (never overwritten by the sheet).
      { patterns: true, sparring: false, waitlistStatus: 'active', competitor: { id: existingId, firstName: 'Ava', belt: 'Green' } },
      { patterns: true, sparring: true, waitlistStatus: 'active', competitor: expect.objectContaining({ firstName: 'Ben', belt: 'Orange' }) },
    ]);
  } finally {
    await withE2EPrisma(async (prisma) => {
      await prisma.tournament.deleteMany({ where: { id: tournamentId } });
      await prisma.competitor.deleteMany({ where: { lastName } });
      await prisma.magicLink.deleteMany({ where: { email } });
      await prisma.user.deleteMany({ where: { email } });
    });
  }
});
