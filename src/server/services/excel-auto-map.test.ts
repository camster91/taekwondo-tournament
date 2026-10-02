import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  autoDetectMapping,
  readUploadedWorkbook,
  resolveImportSheet,
  sheetRowsForImport,
  SHEET_READ_ROWS,
} from './excel-auto-map.js';
import { importFromExcel } from './excel-import.js';

// Resolve the .xlsm fixture path relative to this test file, not to
// the developer's home directory. The original test hard-coded
// `/Users/biancabienaime/taekwondo-tournament/...` which only worked
// on Cam's machine; CI failed with ENOENT because no such path
// existed in the GitHub Actions runner.
//
// The .xlsm lives at the repo root. vitest's test runner sets CWD
// to the repo root, so a relative resolve() is enough. We also
// gracefully skip the tests if the file isn't present (it can be
// gitignored in lightweight clones).
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_PATH = resolve(__dirname, '../../../2025 NEWTONS CHAMPIONSHIP LIST.xlsm');

const fixtureExists = existsSync(FIXTURE_PATH);
const itIfFixture = fixtureExists ? it : it.skip;

describe('Auto-detect mapping', () => {
  let buf: Buffer;

  beforeAll(() => {
    if (!fixtureExists) return;
    buf = readFileSync(FIXTURE_PATH);
  });

  itIfFixture('detects the Newton\'s Championship 2025 .xlsm layout', () => {
    const result = autoDetectMapping(buf);

    // Basic expectations
    expect(result.availableSheets.length).toBe(12);
    expect(result.rowCount).toBeGreaterThan(500);
    expect(result.suggestedSheet).toBeTruthy();

    // Should detect the Gender, Belt, Weight, Patterns, Sparring, School columns
    // (the .xlsm uses "Name" as a combined column, not First/Last)
    expect(result.mapping.gender).toBe('Gender');
    expect(result.mapping.belt).toBe('Belt');
    expect(result.mapping.weight).toBe('Weight (lbs)');
    expect(result.mapping.school).toBe('School');
    expect(result.mapping.patterns).toBe('Patterns');
    expect(result.mapping.sparring).toBe('Sparring');
    expect(result.mapping.danRank).toBe('DAN');
    expect(result.mapping.height).toBe('Height');

    // Should detect "Name" as a combined column and flag the warning
    expect(result.mapping.name).toBe('Name');
    expect(result.warnings.some((w) => w.toLowerCase().includes('name'))).toBe(true);

    // High confidence on the well-known fields
    expect(result.confidence.gender).toBeGreaterThanOrEqual(80);
    expect(result.confidence.belt).toBeGreaterThanOrEqual(80);
    expect(result.confidence.weight).toBeGreaterThanOrEqual(80);
  });

  itIfFixture('picks the most data-rich sheet', () => {
    const result = autoDetectMapping(buf);
    // The "Competitors list" sheet has 684 rows, more than any other
    expect(result.suggestedSheet).toBe('Competitors list');
  });

  // Always-run guard so a missing fixture gives a clear failure
  // rather than 2 silent skips. If the file is checked in to the
  // repo this should never trigger; if it's been gitignored, the
  // test suite is intentionally silent rather than failing the
  // build over a data file.
  it('fixture is present at the expected path', () => {
    expect(fixtureExists).toBe(true);
  });
});

function workbookBuffer(sheets: Record<string, unknown[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** Rewrite sheet1's declared <dimension> inside the .xlsx zip (the cells stay tiny). */
function withDeclaredDimension(buf: Buffer, ref: string): Buffer {
  const zip = XLSX.CFB.read(buf, { type: 'buffer' });
  const entry = zip.FileIndex[zip.FullPaths.findIndex((p) => p.endsWith('xl/worksheets/sheet1.xml'))];
  const xml = Buffer.from(entry.content as Uint8Array).toString();
  entry.content = Buffer.from(xml.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="${ref}"/>`));
  entry.size = entry.content.length;
  return XLSX.CFB.write(zip, { type: 'buffer', fileType: 'zip' }) as Buffer;
}

function importDouble() {
  const tx = {
    competitor: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
    },
  };
  return { tx, prisma: { $transaction: vi.fn(async (fn: any) => fn(tx)) } as any };
}

describe('server import reads the sheet the client mapped (D4)', () => {
  // What Competitors.tsx sends for the Newton's file: it previews the
  // "Competitors list" sheet with the header on row 1 and maps the
  // combined Name column.
  const clientMapping = {
    name: 'Name', gender: 'Gender', age: 'Age', belt: 'Belt', danRank: 'DAN',
    height: 'Height', weight: 'Weight (lbs)', school: 'School',
  };

  itIfFixture('imports the Newton roster from the chosen sheet (SheetNames[0] imported 0 rows)', async () => {
    const buf = readFileSync(FIXTURE_PATH);
    const workbook = readUploadedWorkbook(buf);

    // The old server path: first sheet ("Macro"), header row 1.
    const oldRows = sheetRowsForImport(workbook, workbook.SheetNames[0], 1);
    const old = await importFromExcel(importDouble().prisma, oldRows, clientMapping);
    expect(old.imported).toBe(0);

    const { sheetName, headerRow } = resolveImportSheet(workbook, { sheetName: 'Competitors list', headerRow: 1 });
    const result = await importFromExcel(importDouble().prisma, sheetRowsForImport(workbook, sheetName, headerRow), clientMapping);
    expect(sheetName).toBe('Competitors list');
    expect(result.imported).toBeGreaterThan(600);
    // Every skipped row is reported with its real spreadsheet row number.
    expect(result.errors.length).toBe(result.skipped);
    expect(result.errors.every((e) => e.row >= 2 && e.row <= 684)).toBe(true);
  });

  itIfFixture('falls back to the same auto-detection as /auto-map when no sheet is named', () => {
    const workbook = readUploadedWorkbook(readFileSync(FIXTURE_PATH));
    expect(resolveImportSheet(workbook)).toEqual({ sheetName: 'Competitors list', headerRow: 1 });
  });

  it('detects a header that is not on row 1 and rejects an unknown sheet', () => {
    const workbook = readUploadedWorkbook(workbookBuffer({
      Cover: [['Spring Open']],
      Roster: [['Spring Open roster'], [], ['First Name', 'Last Name', 'Gender', 'Belt', 'Weight'], ['Ana', 'Lee', 'F', 'Blue', 70], ['Bo', 'Kim', 'M', 'Red', 80]],
    }));
    expect(resolveImportSheet(workbook)).toEqual({ sheetName: 'Roster', headerRow: 3 });
    const rows = sheetRowsForImport(workbook, 'Roster', 3);
    expect(rows.map((r) => r['First Name'])).toEqual(['Ana', 'Bo']);
    expect(() => resolveImportSheet(workbook, { sheetName: 'Nope' })).toThrow(/not found/);
  });
});

describe('bounded spreadsheet parsing (D10)', () => {
  it('parses a tiny file that declares A1:J1048576 quickly', () => {
    const buf = withDeclaredDimension(
      workbookBuffer({ Sheet1: [['First Name', 'Last Name', 'Gender', 'Belt', 'Weight'], ['Ana', 'Lee', 'F', 'Blue', 70]] }),
      'A1:J1048576',
    );
    expect(buf.length).toBeLessThan(64 * 1024);
    expect(XLSX.read(buf, { type: 'buffer', sheetRows: 1 }).Sheets.Sheet1['!fullref']).toBe('A1:J1048576');
    const started = Date.now();
    const result = autoDetectMapping(buf);
    const workbook = readUploadedWorkbook(buf);
    const rows = sheetRowsForImport(workbook, resolveImportSheet(workbook).sheetName, 1);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(result.rowCount).toBe(1);
    expect(rows).toHaveLength(1);
  });

  it('rejects a sheet with more rows than an import accepts (400)', () => {
    const aoa: unknown[][] = [['First Name', 'Last Name', 'Gender', 'Belt', 'Weight']];
    for (let i = 0; i < SHEET_READ_ROWS + 10; i++) aoa.push([`F${i}`, 'L', 'M', 'Blue', 80]);
    const buf = workbookBuffer({ Big: aoa });
    expect(() => resolveImportSheet(readUploadedWorkbook(buf))).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(() => autoDetectMapping(buf)).toThrow(/more than 5000 rows/);
  });
});

describe('import template', () => {
  it('ships an empty Competitors sheet and never imports the example sheet', async () => {
    const { generateImportTemplate, EXAMPLE_SHEET_NAME } = await import('./excel-template.js');
    const workbook = XLSX.read(generateImportTemplate(), { type: 'buffer' });
    expect(workbook.SheetNames[0]).toBe('Competitors');
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.Competitors)).toHaveLength(0);
    expect(XLSX.utils.sheet_to_json(workbook.Sheets[EXAMPLE_SHEET_NAME]).length).toBeGreaterThan(0);

    // Even with only one real row typed in, auto-detection picks
    // Competitors, not the fuller example sheet.
    XLSX.utils.sheet_add_aoa(workbook.Sheets.Competitors, [
      ['Ava', 'Lee', 'F', '2014-05-02', 'Green', '', 72, '', 'Test Dojang', 'Y', '', ''],
    ], { origin: 'A2' });
    expect(resolveImportSheet(workbook).sheetName).toBe('Competitors');
  });
});
