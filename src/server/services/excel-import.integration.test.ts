import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { importFromExcel } from './excel-import.js';
import { readUploadedWorkbook, resolveImportSheet, sheetRowsForImport } from './excel-auto-map.js';

const databaseUrl = process.env.EXCEL_IMPORT_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const organizationId = randomUUID();
const FIXTURE_PATH = resolve(process.cwd(), '2025 NEWTONS CHAMPIONSHIP LIST.xlsm');
let prisma: PrismaClient;

integration('importFromExcel against disposable Postgres', () => {
  const scope = { organizationId };
  const options = () => ({ matchScope: scope, ownerOrganizationId: organizationId });
  const mapping = { firstName: 'First', lastName: 'Last', gender: 'Gender', belt: 'Belt', weight: 'Weight', dateOfBirth: 'DOB', age: 'Age', school: 'School' };

  beforeAll(async () => {
    if (!/^postgresql:\/\/[^/]+@(localhost|127\.0\.0\.1)(:\d+)?\/[^?]*(?:_test|_e2e)(?:\?|$)/.test(databaseUrl!)) {
      throw new Error('EXCEL_IMPORT_DATABASE_URL must target a local *_test or *_e2e database');
    }
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    await prisma.organization.create({ data: { id: organizationId, name: '[E2E] Import', slug: `import-${organizationId}` } });
  });

  beforeEach(async () => {
    await prisma.competitor.deleteMany({ where: { organizationId } });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.competitor.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  it('completes a 5000-row import (one transaction used to time out and roll back)', async () => {
    const rows = Array.from({ length: 5000 }, (_, i) => ({
      First: `Bulk${i}`, Last: 'Import', Gender: i % 2 ? 'M' : 'F', Belt: 'Blue', Weight: 80, DOB: '2013-06-07',
    }));
    const result = await importFromExcel(prisma, rows, mapping, options());
    expect(result).toMatchObject({ imported: 5000, updated: 0, skipped: 0, errors: [] });
    expect(await prisma.competitor.count({ where: { organizationId } })).toBe(5000);
  }, 120_000);

  it('re-importing age-only rows updates instead of duplicating (D12)', async () => {
    const rows = [
      { First: 'Ava', Last: 'Stone', Gender: 'F', Belt: 'Yellow', Weight: 60, Age: 9, School: 'Celis TKD' },
      { First: 'Ava', Last: 'Stone', Gender: 'F', Belt: 'Green', Weight: 62, Age: 9, School: 'Other TKD' },
    ];
    expect(await importFromExcel(prisma, rows, mapping, options())).toMatchObject({ imported: 2, updated: 0 });
    const again = await importFromExcel(prisma, rows.map((r) => ({ ...r, First: 'AVA', Belt: 'Blue' })), mapping, options());
    expect(again).toMatchObject({ imported: 0, updated: 2 });
    expect(await prisma.competitor.count({ where: { organizationId } })).toBe(2);
  });

  it('an exported DOB (YYYY-MM-DD) re-imports as the same competitor (D8)', async () => {
    await importFromExcel(prisma, [{ First: 'Noah', Last: 'Park', Gender: 'M', Belt: 'Red', Weight: 90, DOB: 40972 }], mapping, options());
    const stored = await prisma.competitor.findFirstOrThrow({ where: { organizationId, firstName: 'Noah' } });
    expect(stored.dateOfBirth.toISOString()).toBe('2012-03-04T00:00:00.000Z');
    const exported = stored.dateOfBirth.toISOString().slice(0, 10);
    const again = await importFromExcel(prisma, [{ First: 'Noah', Last: 'Park', Gender: 'M', Belt: 'Black', Weight: 91, DOB: exported }], mapping, options());
    expect(again).toMatchObject({ imported: 0, updated: 1 });
  });

  (existsSync(FIXTURE_PATH) ? it : it.skip)('imports the real Newton roster from the sheet the client previewed (D4)', async () => {
    const workbook = readUploadedWorkbook(readFileSync(FIXTURE_PATH));
    const { sheetName, headerRow } = resolveImportSheet(workbook, { sheetName: 'Competitors list', headerRow: 1 });
    const result = await importFromExcel(prisma, sheetRowsForImport(workbook, sheetName, headerRow), {
      name: 'Name', gender: 'Gender', age: 'Age', belt: 'Belt', danRank: 'DAN', height: 'Height', weight: 'Weight (lbs)', school: 'School',
    }, options());
    expect(result.imported + result.updated).toBeGreaterThan(600);
    expect(await prisma.competitor.count({ where: { organizationId } })).toBe(result.imported);
  }, 60_000);
});
