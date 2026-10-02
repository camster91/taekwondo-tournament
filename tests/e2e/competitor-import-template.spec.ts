import { expect, test } from '@playwright/test';
import * as XLSX from 'xlsx';
import { loginAsEmail, skipOnboardingTour, withE2EPrisma } from './helpers';

// The downloadable template is the file clubs fill in. Its "Competitors"
// sheet must start empty (examples live on a separate sheet) and a filled
// copy must import exactly the rows the club typed, with nothing extra.
test('filled-in import template imports exactly the typed rows', async ({ page }) => {
  const stamp = `${Date.now()}${test.info().project.name.replace(/\W/g, '')}`;
  const email = `import-template-${stamp}@example.test`;
  const lastNames = [`Tplone${stamp}`, `Tpltwo${stamp}`];
  await withE2EPrisma((prisma) => prisma.user.create({ data: { email, firstName: 'Import', lastName: 'Director', role: 'admin' } }));

  try {
    await skipOnboardingTour(page);
    await loginAsEmail(page, email);

    const download = await page.request.get('/api/competitors/template');
    expect(download.ok()).toBeTruthy();
    const workbook = XLSX.read(await download.body(), { type: 'buffer' });
    expect(workbook.SheetNames[0]).toBe('Competitors');
    const sheet = workbook.Sheets.Competitors;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
    expect(rows).toHaveLength(1); // headings only, no sample people

    XLSX.utils.sheet_add_aoa(sheet, [
      ['Ava', lastNames[0], 'F', '2014-05-02', 'Green', '', 72, "4'7\"", 'Template Test Dojang', 'Y', '', ''],
      ['Ben', lastNames[1], 'M', '2009-11-20', 'Black', '2nd', 140.5, '', 'Template Test Dojang', 'Y', 'Y', ''],
    ], { origin: 'A2' });
    const filled = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    await page.goto('/competitors');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'my-club.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: filled,
    });
    const importButton = page.getByRole('button', { name: 'Import 2 Competitors' });
    await expect(importButton).toBeEnabled();
    const imported = page.waitForResponse((r) => r.url().includes('/api/competitors/import') && r.request().method() === 'POST');
    await importButton.click();
    const result = await (await imported).json();
    expect(result).toMatchObject({ imported: 2, skipped: 0 });

    const created = await withE2EPrisma((prisma) => prisma.competitor.findMany({
      where: { lastName: { in: lastNames } },
      orderBy: { lastName: 'asc' },
    }));
    expect(created.map((c) => [c.firstName, c.gender, c.belt, c.danRank, c.weightLbs, c.schoolDojang])).toEqual([
      ['Ava', 'F', 'Green', null, 72, 'Template Test Dojang'],
      ['Ben', 'M', 'Black', 2, 140.5, 'Template Test Dojang'],
    ]);
    expect(created[0].dateOfBirth?.toISOString().slice(0, 10)).toBe('2014-05-02');
  } finally {
    await withE2EPrisma(async (prisma) => {
      await prisma.competitor.deleteMany({ where: { lastName: { in: lastNames } } });
      await prisma.magicLink.deleteMany({ where: { email } });
      await prisma.user.deleteMany({ where: { email } });
    });
  }
});
