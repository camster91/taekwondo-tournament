import * as XLSX from 'xlsx';
import type { ColumnMapping } from './excel-import.js';

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
  sampleRow: Record<string, any>;
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
 * Parse a date from various common formats
 */
function tryParseDate(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  const s = String(v).trim();
  if (!s) return null;
  // ISO format
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d;
  }
  // Excel serial date number
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = parseFloat(s);
    if (n > 25000 && n < 80000) {
      // Excel date serial: days since 1900-01-01
      const d = new Date((n - 25569) * 86400 * 1000);
      if (!isNaN(d.getTime())) return d;
    }
  }
  // MM/DD/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) {
    const [m, d, y] = s.split('/');
    const fullY = y.length === 2 ? 2000 + parseInt(y) : parseInt(y);
    return new Date(fullY, parseInt(m) - 1, parseInt(d));
  }
  return null;
}

/**
 * Parse a height in 4'11" or 5'10 format to total inches
 */
function tryParseHeightInches(v: any): number | null {
  if (!v) return null;
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
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const availableSheets = workbook.SheetNames;
  const warnings: string[] = [];

  // Pick the most likely sheet — the one with the most data rows
  let bestSheet = availableSheets[0];
  let bestRowCount = 0;
  for (const name of availableSheets) {
    const sheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<any>(sheet, { header: 1, defval: null });
    // Count rows that have at least 3 non-null cells
    const real = rows.filter((r) => Array.isArray(r) && r.filter((c) => c != null && c !== '').length >= 3);
    if (real.length > bestRowCount) {
      bestRowCount = real.length;
      bestSheet = name;
    }
  }

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
  const allRows = XLSX.utils.sheet_to_json<any>(sheet, { header: 1, defval: null });

  // Detect header row: scan the first 5 rows, pick the one that matches the
  // most field aliases
  let headerRowIdx = 0;
  let headerMatchScore = 0;
  for (let i = 0; i < Math.min(5, allRows.length); i++) {
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

  const rawHeaders: string[] = (allRows[headerRowIdx] || []).map((c) => String(c || '').trim());
  const dataRows = allRows.slice(headerRowIdx + 1);
  const sampleRow: Record<string, any> = {};
  for (let i = 0; i < dataRows.length; i++) {
    if (dataRows[i] && dataRows[i].some((c: any) => c != null && c !== '')) {
      rawHeaders.forEach((h, idx) => {
        sampleRow[h] = dataRows[i][idx];
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
      // Only set if not already taken (highest confidence wins)
      if (!Object.values(mapping).includes(bestHeader)) {
        (mapping as any)[f] = bestHeader;
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
    if (!tryParseDate(sampleRow[mapping.dateOfBirth])) {
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
