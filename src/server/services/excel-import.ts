import { Prisma, PrismaClient } from '@prisma/client';
import { normalizeBelt } from '../../shared/constants/belts.js';
import { AppError, ErrorCode } from '../utils/errors.js';

/**
 * A single cell from an uploaded spreadsheet. SheetJS returns the
 * JS-native value: string, number, boolean, Date, or null/undefined.
 * `unknown` is the honest input type for parser helpers — they each
 * narrow internally (Number for numerics, `String(value).trim()` for
 * strings) and return the typed value the rest of the pipeline wants.
 */
export type ExcelCellValue = string | number | boolean | Date | null | undefined;
export type ExcelRow = Record<string, ExcelCellValue>;

export interface ColumnMapping {
  firstName: string;
  lastName: string;
  name?: string;        // Combined "Full Name" column (e.g. Newton's .xlsm)
  gender: string;
  dateOfBirth?: string;
  age?: string;
  belt: string;
  danRank?: string;
  height?: string;
  weight: string;
  school?: string;
  patterns?: string;
  sparring?: string;
  specialNeeds?: string;
}

export interface ImportResult {
  imported: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
}

export interface ImportOptions {
  /**
   * Which existing competitors an imported row may match (and
   * overwrite) by name + DOB:
   *  - 'all': any competitor (admins only);
   *  - a Prisma where-clause: only competitors inside that scope — pass
   *    the caller's competitor WRITE filter so an import never
   *    overwrites another tenant's record;
   *  - 'none' (default, fail closed): never match; always create.
   */
  matchScope?: Prisma.CompetitorWhereInput | 'all' | 'none';
  /** Owning organization for newly created competitors (null = legacy pool). */
  ownerOrganizationId?: string | null;
}

/** Most rows a single import accepts. */
export const MAX_IMPORT_ROWS = 5000;

/**
 * Rows written per transaction. A single interactive transaction around a
 * whole 5000-row import ran into Prisma's default 5 s timeout and rolled the
 * entire import back with a 500. Batches commit independently.
 */
const IMPORT_BATCH_SIZE = 100;
const IMPORT_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 60_000 } as const;

/** A row that passed validation and is ready to be written. */
interface PreparedRow {
  rowNum: number;
  firstName: string;
  lastName: string;
  gender: 'M' | 'F';
  dateOfBirth: Date;
  /** Birth year implied by an age-only row (DOB synthesized as Jan 1). */
  syntheticBirthYear: number | null;
  belt: string;
  danRank: number | null;
  heightInches: number | null;
  weightLbs: number | null;
  schoolDojang: string | null;
  specialNeeds: string | null;
}

const collapseSpaces = (s: string) => s.trim().replace(/\s+/g, ' ');

/**
 * Spreadsheet row number for error messages. SheetJS tags each parsed row
 * with a non-enumerable 0-based `__rowNum__`; rows that arrive as JSON (the
 * pre-parsed client path) fall back to "header on row 1, no blank rows".
 */
function spreadsheetRowNumber(row: ExcelRow, index: number): number {
  const tagged = (row as { __rowNum__?: unknown }).__rowNum__;
  return typeof tagged === 'number' ? tagged + 1 : index + 2;
}

export async function importFromExcel(
  prisma: PrismaClient,
  rows: ExcelRow[],
  // Caller-provided mapping. `gender` / `belt` / `weight` and either
  // `firstName` + `lastName` or a combined `name` column are required;
  // everything else is optional because not every upload carries a DOB
  // column or a school column.
  mapping: Partial<ColumnMapping>,
  options: ImportOptions = {}
): Promise<ImportResult> {
  const matchScope = options.matchScope ?? 'none';
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new AppError(`Import limited to ${MAX_IMPORT_ROWS} rows`, ErrorCode.IMPORT_FAILED, 400, {
      recoverable: true,
      suggestion: `Split the file into parts of at most ${MAX_IMPORT_ROWS} rows.`,
    });
  }

  // Required-field guard. Throwing here keeps the existing per-row
  // error reporting downstream (`result.errors.push(...)`) untouched —
  // a missing required mapping is a hard failure for the whole import,
  // not a per-row error.
  const firstNameCol = mapping.firstName || undefined;
  const lastNameCol = mapping.lastName || undefined;
  const genderCol = mapping.gender;
  const beltCol = mapping.belt;
  const weightCol = mapping.weight;
  const hasNameColumns = Boolean((firstNameCol && lastNameCol) || mapping.name);
  if (!hasNameColumns || !genderCol || !beltCol || !weightCol) {
    throw new AppError(
      'Mapping is missing required columns: firstName and lastName (or a combined name column), gender, belt, weight',
      ErrorCode.VALIDATION_ERROR,
      400,
    );
  }

  const result: ImportResult = {
    imported: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  // Phase 1: validate every row (no database access).
  const prepared: PreparedRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = spreadsheetRowNumber(row, i);
    const skip = (message: string) => {
      result.errors.push({ row: rowNum, message });
      result.skipped++;
    };

    let firstName = firstNameCol ? collapseSpaces(String(row[firstNameCol] || '')) : '';
    let lastName = lastNameCol ? collapseSpaces(String(row[lastNameCol] || '')) : '';

    // Handle combined "Name" column (Newton's .xlsm format)
    if ((!firstName || !lastName) && mapping.name) {
      const full = collapseSpaces(String(row[mapping.name] || ''));
      if (full) {
        const parts = full.split(' ');
        if (parts.length === 1) {
          firstName = parts[0];
        } else {
          firstName = parts[0];
          lastName = parts.slice(1).join(' ');
        }
      }
    }

    if (!firstName || !lastName) {
      skip('Missing first or last name');
      continue;
    }

    // Parse gender
    const genderRaw = String(row[genderCol] || '').toUpperCase().trim();
    const gender = genderRaw.startsWith('M') ? 'M' : genderRaw.startsWith('F') ? 'F' : null;

    if (!gender) {
      skip(`Invalid gender: ${genderRaw}`);
      continue;
    }

    // Parse date of birth or calculate from age
    let dateOfBirth: Date | null = null;
    // Set when the DOB is synthesized (Jan 1) from an age-only column.
    // Such a DOB is shared by every same-age namesake, so it is never an
    // exact match key; matching uses name + school + birth year instead.
    let syntheticBirthYear: number | null = null;

    if (mapping.dateOfBirth && row[mapping.dateOfBirth]) {
      dateOfBirth = parseDateOfBirth(row[mapping.dateOfBirth]);
    } else if (mapping.age && row[mapping.age]) {
      // Calculate approximate DOB from age
      const age = parseInt(String(row[mapping.age]));
      if (!isNaN(age)) {
        syntheticBirthYear = new Date().getUTCFullYear() - age;
        dateOfBirth = new Date(Date.UTC(syntheticBirthYear, 0, 1));
      }
    }

    if (!dateOfBirth) {
      skip('Could not determine date of birth');
      continue;
    }

    // Parse belt
    const beltRaw = String(row[beltCol] || '').trim();
    const belt = normalizeBelt(beltRaw);

    if (!belt) {
      skip('Missing belt');
      continue;
    }

    prepared.push({
      rowNum,
      firstName,
      lastName,
      gender,
      dateOfBirth,
      syntheticBirthYear,
      belt,
      danRank: mapping.danRank ? parseDanRank(row[mapping.danRank]) : null,
      heightInches: mapping.height ? parseHeight(row[mapping.height]) : null,
      weightLbs: parseWeight(row[weightCol]),
      schoolDojang: mapping.school ? collapseSpaces(String(row[mapping.school] || '')) || null : null,
      specialNeeds: mapping.specialNeeds ? String(row[mapping.specialNeeds] || '').trim() || null : null,
    });
  }

  // Phase 2: write in batches. Each batch commits on its own; if one fails
  // (Postgres aborts the whole transaction on the first error), its rows are
  // retried one by one so good rows still land and the failing row gets its
  // real error.
  const writeRow = async (tx: Prisma.TransactionClient, row: PreparedRow): Promise<'imported' | 'updated'> => {
    // Check for existing competitor (by name + exact DOB).
    // Closes B7: case-insensitive match so a parent who
    // imported "Minho Kim" doesn't create a new row when
    // the next import contains "MINHO KIM".
    //
    // Multi-tenant: only competitors inside `matchScope` (the
    // importer's writable set) are candidates; anything else gets
    // a new row instead of overwriting another tenant's record.
    //
    // Age-only rows have a synthetic DOB, so they match on name + school
    // + the birth year implied by the age (either side of the birthday)
    // instead; otherwise every re-import duplicated them.
    const dobWhere: Prisma.CompetitorWhereInput = row.syntheticBirthYear === null
      ? { dateOfBirth: row.dateOfBirth }
      : {
          dateOfBirth: {
            gte: new Date(Date.UTC(row.syntheticBirthYear - 1, 0, 1)),
            lt: new Date(Date.UTC(row.syntheticBirthYear + 1, 0, 1)),
          },
          schoolDojang: row.schoolDojang === null ? null : { equals: row.schoolDojang, mode: 'insensitive' },
        };
    const existing =
      matchScope === 'none'
        ? null
        : await tx.competitor.findFirst({
            where: {
              firstName: { equals: row.firstName, mode: 'insensitive' },
              lastName: { equals: row.lastName, mode: 'insensitive' },
              ...dobWhere,
              deletedAt: null,
              ...(matchScope === 'all' ? {} : { AND: [matchScope] }),
            },
            orderBy: { createdAt: 'asc' }, // deterministic: the oldest record
          });

    if (existing) {
      // Update existing competitor (an age-only row never overwrites the
      // stored DOB, which may be the real one).
      await tx.competitor.update({
        where: { id: existing.id },
        data: {
          gender: row.gender,
          belt: row.belt,
          danRank: row.danRank,
          heightInches: row.heightInches,
          weightLbs: row.weightLbs,
          schoolDojang: row.schoolDojang,
          specialNeeds: row.specialNeeds,
        },
      });
      return 'updated';
    }
    // Create new competitor
    await tx.competitor.create({
      data: {
        firstName: row.firstName,
        lastName: row.lastName,
        gender: row.gender,
        dateOfBirth: row.dateOfBirth,
        belt: row.belt,
        danRank: row.danRank,
        heightInches: row.heightInches,
        weightLbs: row.weightLbs,
        schoolDojang: row.schoolDojang,
        specialNeeds: row.specialNeeds,
        organizationId: options.ownerOrganizationId ?? null,
      },
    });
    return 'imported';
  };

  const tally = (outcome: 'imported' | 'updated') => {
    if (outcome === 'imported') result.imported++;
    else result.updated++;
  };

  for (let start = 0; start < prepared.length; start += IMPORT_BATCH_SIZE) {
    const batch = prepared.slice(start, start + IMPORT_BATCH_SIZE);
    try {
      const outcomes = await prisma.$transaction(async (tx) => {
        const done: Array<'imported' | 'updated'> = [];
        for (const row of batch) done.push(await writeRow(tx, row));
        return done;
      }, IMPORT_TRANSACTION_OPTIONS);
      outcomes.forEach(tally);
    } catch {
      for (const row of batch) {
        try {
          tally(await prisma.$transaction((tx) => writeRow(tx, row), IMPORT_TRANSACTION_OPTIONS));
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          result.errors.push({ row: row.rowNum, message });
          result.skipped++;
        }
      }
    }
  }

  result.errors.sort((a, b) => a.row - b.row);
  return result;
}

/**
 * Parse a date of birth into a UTC-midnight Date (how DOBs are stored).
 *
 * - Excel serial numbers and `YYYY-MM-DD` strings are calendar dates, read
 *   as UTC so the server's time zone never shifts them.
 * - Slash dates follow the documented MM/DD/YYYY convention (see the import
 *   template). A first part above 12 can only be a day, so DD/MM/YYYY is
 *   accepted when unambiguous; impossible dates are rejected.
 * - Anything else falls back to the JS parser, keeping its calendar day.
 */
export function parseDateOfBirth(value: ExcelCellValue): Date | null {
  if (value === null || value === undefined || value === '') return null;

  const utcDate = (y: number, m: number, d: number): Date | null => {
    if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
    if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    const date = new Date(Date.UTC(y, m - 1, d));
    // Reject roll-over dates such as 02/30.
    return date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null;
  };

  // Excel serial date number (days since 1899-12-30; time of day dropped)
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86_400_000);
    return utcDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }

  if (value instanceof Date) {
    // SheetJS (cellDates) and JS parsers produce local midnight; keep the
    // calendar day the spreadsheet showed.
    if (isNaN(value.getTime())) return null;
    return utcDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  const str = String(value).trim();
  if (!str) return null;

  const iso = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T\s])/);
  if (iso) return utcDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const slash = str.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    let year = Number(slash[3]);
    if (slash[3].length === 2) {
      // Two-digit years: a birth year cannot be in the future.
      const currentYY = new Date().getUTCFullYear() % 100;
      year += year > currentYY ? 1900 : 2000;
    }
    // MM/DD/YYYY by convention; DD/MM/YYYY only when the first part
    // cannot be a month.
    return a > 12 ? utcDate(year, b, a) : utcDate(year, a, b);
  }

  const parsed = new Date(str);
  if (isNaN(parsed.getTime())) return null;
  return utcDate(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
}

function parseDanRank(value: ExcelCellValue): number | null {
  if (value === null || value === undefined || value === '') return null;

  const str = String(value).toLowerCase().trim();

  // Handle "1st", "2nd", "3rd", etc.
  const match = str.match(/(\d+)/);
  if (match) {
    const rank = parseInt(match[1]);
    return rank >= 1 && rank <= 6 ? rank : null;
  }

  return null;
}

function parseHeight(value: ExcelCellValue): number | null {
  if (!value) return null;

  const str = String(value).trim();
  if (!str) return null;

  // Closes B18: the previous regex `/(\d+)'?\s*(\d*)"?/` matched
  // *any* string starting with a digit, including bare inches like
  // "60" → parsed as 60 feet = 720 inches. New regex requires a
  // `'` or `"` somewhere in the input to interpret as feet/inches;
  // bare numbers are interpreted as inches (with cm conversion as
  // a fallback if the value is small).
  const feetInchesMatch = str.match(/^(\d+)\s*'[\s]*(\d+)?\s*"?$/);
  if (feetInchesMatch) {
    const feet = parseInt(feetInchesMatch[1]) || 0;
    const inches = parseInt(feetInchesMatch[2]) || 0;
    const total = feet * 12 + inches;
    // Sanity check: a real human height is 24" (2 ft) to 96" (8 ft).
    if (total < 24 || total > 96) return null;
    return total;
  }

  // Bare number: interpret as inches. Convert cm if the value
  // looks like it (50-250 is a plausible cm range; 12-96 is inches).
  const num = parseFloat(str);
  if (!isNaN(num)) {
    if (num > 12 && num < 100) return num; // already inches
    if (num >= 100 && num < 250) return Math.round(num / 2.54); // cm → inches
    return null; // implausible value
  }

  return null;
}

function parseWeight(value: ExcelCellValue): number | null {
  if (!value) return null;

  const str = String(value).trim();
  if (!str) return null;

  // Closes B20: detect unit by suffix. "60kg" → 132.3 lb (convert).
  // "60 lbs" / "60 lb" / "60" → 60 (assume pounds).
  const kgMatch = str.match(/^(\d+(?:\.\d+)?)\s*kg$/i);
  if (kgMatch) {
    const kg = parseFloat(kgMatch[1]);
    if (isNaN(kg) || kg < 20 || kg > 250) return null;
    return Math.round(kg * 2.20462 * 10) / 10;
  }
  const lbMatch = str.match(/^(\d+(?:\.\d+)?)\s*(?:lbs?|pounds?)?$/i);
  if (lbMatch) {
    const lb = parseFloat(lbMatch[1]);
    if (isNaN(lb) || lb < 20 || lb > 400) return null;
    return lb;
  }
  // Fallback: bare number, no unit — assume pounds. Validation
  // above (20-400) is the safety net.
  const num = parseFloat(str.replace(/[^\d.]/g, ''));
  if (isNaN(num)) return null;
  if (num < 20 || num > 400) return null;
  return num;
}
