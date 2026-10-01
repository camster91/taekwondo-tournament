import * as XLSX from 'xlsx';
import type { ColumnMapping, ExcelCellValue, ExcelRow } from './excel-import.js';
import { MAX_IMPORT_ROWS, parseDateOfBirth } from './excel-import.js';
import { AppError, ErrorCode } from '../utils/errors.js';

/** Highest header row (1-indexed) a caller may name for an import. */
export const MAX_HEADER_ROW = 20;
/** Rows scanned when auto-detecting the header row. */
const HEADER_SEARCH_ROWS = 5;
/**
 * Rows SheetJS materialises per sheet: the import cap plus room for a
 * header row. `sheet_to_json` walks the sheet's declared dimension, so
 * without this bound a 16 KB file declaring A1:J1048576 costs 13-20 s of CPU
 * and hundreds of MB.
 */
export const SHEET_READ_ROWS = MAX_IMPORT_ROWS + MAX_HEADER_ROW;

/**
 * Parse an uploaded workbook with a bounded row count. Every server-side
 * parse of user uploads goes through here.
 */
export function readUploadedWorkbook(buffer: Buffer): XLSX.WorkBook {
  return XLSX.read(buffer, { type: 'buffer', sheetRows: SHEET_READ_ROWS });
}

function rowHasData(sheet: XLSX.WorkSheet, rowIdx: number, range: XLSX.Range): boolean {
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: rowIdx, c })] as XLSX.CellObject | undefined;
    if (cell && cell.v !== undefined && cell.v !== null && cell.v !== '') return true;
  }
  return false;
}

/**
 * Reject (400) a sheet that holds more rows than an import accepts. A sheet
 * whose declared dimension is larger than the read window but whose data
 * stops short of it (a bloated `!ref`, common after formatting whole rows)
 * is fine: reading was already bounded by `sheetRows`.
 */
export function assertSheetWithinLimit(sheet: XLSX.WorkSheet, sheetName: string): void {
  const fullRef = sheet['!fullref'];
  const ref = sheet['!ref'];
  if (!fullRef || !ref || fullRef === ref) return;
  const full = XLSX.utils.decode_range(fullRef);
  const read = XLSX.utils.decode_range(ref);
  if (full.e.r <= read.e.r) return;
  // SheetJS shrinks `!ref` to the cells it kept, so the window is only
  // "full" when data reaches its last row.
  if (read.e.r >= SHEET_READ_ROWS - 1 && rowHasData(sheet, read.e.r, read)) {
    throw new AppError(
      `Sheet "${sheetName}" has more than ${MAX_IMPORT_ROWS} rows. Split it into smaller files (max ${MAX_IMPORT_ROWS} competitors per import).`,
      ErrorCode.IMPORT_FAILED,
      400,
      { recoverable: true, suggestion: `Import at most ${MAX_IMPORT_ROWS} rows at a time.` },
    );
  }
}

function sheetMatrix(sheet: XLSX.WorkSheet): unknown[][] {
  // `header: 1` returns each row as an array of cells. Cell values
  // are SheetJS's JS-native types (string/number/Date/null); we
  // declare them as `unknown[]` here and narrow at the call sites
  // that actually care (header detection, sample row assembly).
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
}

/** The sheet most likely to hold the roster: the one with the most data rows. */
function pickBestSheet(workbook: XLSX.WorkBook): string | undefined {
  let bestSheet = workbook.SheetNames[0];
  let bestRowCount = 0;
  for (const name of workbook.SheetNames) {
    const rows = sheetMatrix(workbook.Sheets[name]);
    // Count rows that have at least 3 non-null cells
    const real = rows.filter((r) => Array.isArray(r) && r.filter((c) => c != null && c !== '').length >= 3);
    if (real.length > bestRowCount) {
      bestRowCount = real.length;
      bestSheet = name;
    }
  }
  return bestSheet;
}

/**
 * Detect the header row: scan the first rows and pick the one that matches
 * the most field aliases. Returns a 0-based index.
 */
function detectHeaderRowIdx(allRows: unknown[][]): number {
  let headerRowIdx = 0;
  let headerMatchScore = 0;
  for (let i = 0; i < Math.min(HEADER_SEARCH_ROWS, allRows.length); i++) {
    const row = allRows[i] || [];
    let score = 0;
    const fields: (keyof ColumnMapping)[] = ['firstName', 'lastName', 'gender', 'belt', 'weight', 'school', 'age', 'dateOfBirth'];
    for (const f of fields) {
      for (const cell of row) {
        if (cell && scoreField(String(cell), f) > 50) {
          score++;
          break;
        }
      }
    }
    if (score > headerMatchScore) {
      headerMatchScore = score;
      headerRowIdx = i;
    }
  }
  return headerRowIdx;
}

/**
 * Resolve which sheet and header row (1-indexed) an import reads. Caller
 * choices win when given (the client sends what it previewed); otherwise
 * the same auto-detection `autoDetectMapping` uses. Throws 400 for a sheet
 * that does not exist or is over the row limit.
 */
export function resolveImportSheet(
  workbook: XLSX.WorkBook,
  choice: { sheetName?: string; headerRow?: number } = {},
): { sheetName: string; headerRow: number } {
  let sheetName = choice.sheetName;
  if (sheetName !== undefined && !workbook.SheetNames.includes(sheetName)) {
    throw new AppError(`Sheet "${sheetName}" was not found in the workbook`, ErrorCode.INVALID_FILE_FORMAT, 400);
  }
  sheetName ??= pickBestSheet(workbook);
  if (!sheetName) {
    throw new AppError('Workbook has no sheets', ErrorCode.INVALID_FILE_FORMAT, 400);
  }
  const sheet = workbook.Sheets[sheetName];
  assertSheetWithinLimit(sheet, sheetName);
  const headerRow = choice.headerRow ?? detectHeaderRowIdx(sheetMatrix(sheet)) + 1;
  return { sheetName, headerRow };
}

/**
 * Rows of `sheetName` as objects keyed by the header row's labels. Each row
 * keeps SheetJS's non-enumerable `__rowNum__` (0-based sheet row) so import
 * errors can name the real spreadsheet row.
 */
export function sheetRowsForImport(workbook: XLSX.WorkBook, sheetName: string, headerRow: number): ExcelRow[] {
  return XLSX.utils.sheet_to_json<ExcelRow>(workbook.Sheets[sheetName], { defval: '', range: headerRow - 1 });
}

/**
 * Auto-detect a column mapping for an uploaded Excel file.
 *
 * Real managers upload spreadsheets with various shapes:
 * - The "clean" template we ship (First Name, Last Name, ...)
 * - The Newton's 2025 .xlsm (Name, Age, Belt, Weight (lbs), Patterns, Sparring, ...)
 * - Karate tournament exports (Name, Age, Gender, Rank, ...)
 * - Registration-form dumps (no header normalization, mixed case)
 *
 * This function scans the actual column headers + first data row + sample
 * values to guess the right mapping. Returns confidence scores so the UI
 * can flag columns that need manual review.
 */

export interface AutoMapResult {
  mapping: Partial<ColumnMapping>;
  confidence: Record<keyof ColumnMapping, number>; // 0-100
  warnings: string[];
  suggestedSheet: string;
  availableSheets: string[];
  detectedHeaderRow: number;
  rawHeaders: string[];
  sampleRow: ExcelRow;
  rowCount: number;
}

// Aliases for each logical field, in priority order (most specific first)
const FIELD_ALIASES: Record<keyof ColumnMapping, string[]> = {
  firstName: ['first name', 'firstname', 'fname', 'given name', 'givenname'],
  lastName: ['last name', 'lastname', 'lname', 'surname', 'family name', 'familyname'],
  // For combined "Name" column, we special-case in the auto-detect
  name: [],
  gender: ['gender', 'sex', 'm/f', 'mf'],
  dateOfBirth: ['date of birth', 'dateofbirth', 'dob', 'birth date', 'birthdate', 'birthday'],
  age: ['age', 'ages', 'competitor age'],
  belt: ['belt', 'belt color', 'beltcolour', 'belt rank', 'current belt', 'rank'],
  danRank: ['dan', 'dan rank', 'danrank', 'degree', 'black belt degree', 'poom'],
  height: ['height', 'ht', 'height (in)', 'height (inches)', 'height (cm)'],
  weight: ['weight', 'wt', 'weight (lbs)', 'weight (lb)', 'weight lbs', 'weight lb', 'weight (kg)', 'weight kg', 'body weight'],
  school: ['school', 'dojang', 'school/dojang', 'schooldojang', 'academy', 'club', 'studio'],
  patterns: ['patterns', 'pattern', 'forms', 'form', 'kata', 'poomsae', 'poomse'],
  sparring: ['sparring', 'spar', 'kyorugi', 'kumite', 'combat', 'fighting', 'match'],
  specialNeeds: ['special needs', 'specialneeds', 'accommodations', 'notes', 'comments', 'remarks'],
};

// Header detection patterns
function normalize(s: string): string {
  return String(s || '').toLowerCase().trim().replace(/[_\-\s]+/g, ' ').replace(/[^\w\s/()]/g, '');
}

function scoreField(headerRaw: string, field: keyof ColumnMapping): number {
  const h = normalize(headerRaw);
  if (!h) return 0;
  const aliases = FIELD_ALIASES[field] || [];
  for (let i = 0; i < aliases.length; i++) {
    const a = normalize(aliases[i]);
    if (h === a) return 100 - i; // exact match, prefer earlier aliases
    // If one is a prefix of the other (e.g. "weight" matches "weight (lbs)")
    if (a.length >= 4 && (h.startsWith(a + ' ') || h.startsWith(a + '('))) return 90 - i;
    if (a.length >= 4 && (h.endsWith(' ' + a) || h.endsWith('(' + a + ')'))) return 80 - i;
    if (h.includes(a)) return 60 - i;
  }
  return 0;
}

/**
 * Parse a height in 4'11" or 5'10 format to total inches.
 * Bare integers are interpreted as inches.
 */
function tryParseHeightInches(v: ExcelCellValue): number | null {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  const m = s.match(/^(\d+)'?\s*(\d+)?/);
  if (m) {
    const feet = parseInt(m[1]);
    const inches = m[2] ? parseInt(m[2]) : 0;
    return feet * 12 + inches;
  }
  const n = parseInt(s);
  return isNaN(n) ? null : n;
}

/**
 * Auto-detect mapping for an uploaded Excel file buffer.
 * Pass a Buffer (from multer or fs.readFile) of an .xlsx or .xlsm.
 */
export function autoDetectMapping(buffer: Buffer): AutoMapResult {
  const workbook = readUploadedWorkbook(buffer);
  const availableSheets = workbook.SheetNames;
  const warnings: string[] = [];

  // Pick the most likely sheet — the one with the most data rows
  const bestSheet = pickBestSheet(workbook);

  if (!bestSheet) {
    return {
      mapping: {},
      confidence: emptyConfidence(),
      warnings: ['No sheets found in the file'],
      suggestedSheet: '',
      availableSheets: [],
      detectedHeaderRow: 1,
      rawHeaders: [],
      sampleRow: {},
      rowCount: 0,
    };
  }

  const sheet = workbook.Sheets[bestSheet];
  assertSheetWithinLimit(sheet, bestSheet);
  const allRows = sheetMatrix(sheet);

  // Detect header row: scan the first rows, pick the one that matches the
  // most field aliases
  const headerRowIdx = detectHeaderRowIdx(allRows);

  const rawHeaders: string[] = (allRows[headerRowIdx] || []).map((c: unknown) => String(c || '').trim());
  const dataRows = allRows.slice(headerRowIdx + 1);
  const sampleRow: ExcelRow = {};
  for (let i = 0; i < dataRows.length; i++) {
    if (dataRows[i] && dataRows[i].some((c: unknown) => c != null && c !== '')) {
      rawHeaders.forEach((h, idx) => {
        sampleRow[h] = dataRows[i][idx] as ExcelCellValue;
      });
      break;
    }
  }

  // Score every header against every field
  const confidence: Record<string, number> = {};
  const mapping: Partial<ColumnMapping> = {};
  const fields = Object.keys(FIELD_ALIASES) as (keyof ColumnMapping)[];

  for (const f of fields) {
    confidence[f] = 0;
  }

  for (const f of fields) {
    let best = 0;
    let bestHeader = '';
    for (const h of rawHeaders) {
      const s = scoreField(h, f);
      if (s > best) {
        best = s;
        bestHeader = h;
      }
    }
    if (best >= 50 && bestHeader) {
      confidence[f] = best;
      // Only set if not already taken (highest confidence wins).
      // `Partial<ColumnMapping>` doesn't index by `keyof ColumnMapping`
      // in TS's view, so the cast stays local — we're populating the
      // partial object from a known key list.
      if (!Object.values(mapping).includes(bestHeader)) {
        (mapping as Record<string, string>)[f] = bestHeader;
      }
    }
  }

  // Special case: if there's a "Name" column but no firstName/lastName,
  // assume the file uses a single full-name column. Flag for the manager.
  if (!mapping.firstName && !mapping.lastName) {
    const nameCol = rawHeaders.find((h) => normalize(h) === 'name' || normalize(h) === 'full name' || normalize(h) === 'competitor');
    if (nameCol) {
      mapping.name = nameCol;
      confidence.name = 90;
      warnings.push(`Found single "Name" column ("${nameCol}"). Names will be split on the first space. Verify in the preview step.`);
    }
  }

  // Validate the mapping by checking sample values
  if (mapping.gender && sampleRow[mapping.gender]) {
    const g = String(sampleRow[mapping.gender]).toUpperCase().trim();
    if (g !== 'M' && g !== 'F' && g !== 'MALE' && g !== 'FEMALE' && g !== 'BOY' && g !== 'GIRL') {
      warnings.push(`Gender column "${mapping.gender}" has unexpected value "${sampleRow[mapping.gender]}". Expected M/F.`);
      confidence.gender = Math.min(confidence.gender, 60);
    }
  }

  if (mapping.weight && sampleRow[mapping.weight]) {
    const w = parseInt(String(sampleRow[mapping.weight]));
    if (isNaN(w) || w < 20 || w > 400) {
      warnings.push(`Weight column "${mapping.weight}" has unexpected value "${sampleRow[mapping.weight]}". Expected a number 20-400.`);
      confidence.weight = Math.min(confidence.weight, 50);
    }
  }

  if (mapping.height && sampleRow[mapping.height]) {
    const h = tryParseHeightInches(sampleRow[mapping.height]);
    if (h == null) {
      warnings.push(`Height column "${mapping.height}" has unexpected value "${sampleRow[mapping.height]}". Expected feet'inches (4\\'11) or inches (59).`);
    }
  }

  if (mapping.dateOfBirth && sampleRow[mapping.dateOfBirth]) {
    if (!parseDateOfBirth(sampleRow[mapping.dateOfBirth])) {
      warnings.push(`Date of Birth column "${mapping.dateOfBirth}" has unparseable value "${sampleRow[mapping.dateOfBirth]}". Falling back to age column if present.`);
      confidence.dateOfBirth = Math.min(confidence.dateOfBirth, 40);
    }
  }

  if (mapping.belt && sampleRow[mapping.belt]) {
    const b = String(sampleRow[mapping.belt]).toLowerCase();
    const validBelts = ['white', 'yellow', 'green', 'blue', 'red', 'black'];
    if (!validBelts.some((v) => b.includes(v))) {
      warnings.push(`Belt column "${mapping.belt}" has unexpected value "${sampleRow[mapping.belt]}". Expected White/Yellow/Green/Blue/Red/Black.`);
      confidence.belt = Math.min(confidence.belt, 50);
    }
  }

  // Compute row count (rows with at least one non-null cell beyond the header)
  const rowCount = dataRows.filter((r) => Array.isArray(r) && r.some((c) => c != null && c !== '')).length;

  // Check for required-field gaps
  const required: (keyof ColumnMapping)[] = ['gender', 'belt', 'weight'];
  for (const f of required) {
    if (!mapping[f]) {
      warnings.push(`No column found for required field "${f}". Please map it manually before importing.`);
    }
  }
  if (!mapping.firstName && !mapping.name) {
    warnings.push('No name column detected. Please map First Name, Last Name, or a combined Name column.');
  }

  return {
    mapping,
    confidence: confidence as Record<keyof ColumnMapping, number>,
    warnings,
    suggestedSheet: bestSheet,
    availableSheets,
    detectedHeaderRow: headerRowIdx + 1, // 1-indexed for humans
    rawHeaders,
    sampleRow,
    rowCount,
  };
}

function emptyConfidence(): Record<keyof ColumnMapping, number> {
  return {
    firstName: 0, lastName: 0, name: 0, gender: 0, dateOfBirth: 0, age: 0,
    belt: 0, danRank: 0, height: 0, weight: 0, school: 0, patterns: 0,
    sparring: 0, specialNeeds: 0,
  };
}
