import { PrismaClient } from '@prisma/client';
import { normalizeBelt } from '../../shared/constants/belts.js';

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

export async function importFromExcel(
  prisma: PrismaClient,
  rows: any[],
  mapping: ColumnMapping
): Promise<ImportResult> {
  if (rows.length > 5000) {
    throw new Error('Import limited to 5000 rows');
  }

  const result: ImportResult = {
    imported: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // Account for header row

      try {
        // Extract and validate required fields
        let firstName = String(row[mapping.firstName] || '').trim();
        let lastName = String(row[mapping.lastName] || '').trim();

        // Handle combined "Name" column (Newton's .xlsm format)
        if ((!firstName || !lastName) && mapping.name) {
          const full = String(row[mapping.name] || '').trim();
          if (full) {
            const parts = full.split(/\s+/);
            if (parts.length === 1) {
              firstName = parts[0];
            } else {
              firstName = parts[0];
              lastName = parts.slice(1).join(' ');
            }
          }
        }

        if (!firstName || !lastName) {
          result.errors.push({ row: rowNum, message: 'Missing first or last name' });
          result.skipped++;
          continue;
        }

        // Parse gender
        const genderRaw = String(row[mapping.gender] || '').toUpperCase().trim();
        const gender = genderRaw.startsWith('M') ? 'M' : genderRaw.startsWith('F') ? 'F' : null;

        if (!gender) {
          result.errors.push({ row: rowNum, message: `Invalid gender: ${genderRaw}` });
          result.skipped++;
          continue;
        }

        // Parse date of birth or calculate from age
        let dateOfBirth: Date | null = null;

        if (mapping.dateOfBirth && row[mapping.dateOfBirth]) {
          const dobRaw = row[mapping.dateOfBirth];
          dateOfBirth = parseDate(dobRaw);
        } else if (mapping.age && row[mapping.age]) {
          // Calculate approximate DOB from age
          const age = parseInt(String(row[mapping.age]));
          if (!isNaN(age)) {
            const today = new Date();
            dateOfBirth = new Date(today.getFullYear() - age, 0, 1);
          }
        }

        if (!dateOfBirth) {
          result.errors.push({ row: rowNum, message: 'Could not determine date of birth' });
          result.skipped++;
          continue;
        }

        // Parse belt
        const beltRaw = String(row[mapping.belt] || '').trim();
        const belt = normalizeBelt(beltRaw);

        if (!belt) {
          result.errors.push({ row: rowNum, message: 'Missing belt' });
          result.skipped++;
          continue;
        }

        // Parse optional fields
        const danRank = mapping.danRank ? parseDanRank(row[mapping.danRank]) : null;
        const heightInches = mapping.height ? parseHeight(row[mapping.height]) : null;
        const weightLbs = parseWeight(row[mapping.weight]);
        const schoolDojang = mapping.school ? String(row[mapping.school] || '').trim() || null : null;
        const specialNeeds = mapping.specialNeeds ? String(row[mapping.specialNeeds] || '').trim() || null : null;

        // Check for existing competitor (by name + DOB).
        // Closes B7: case-insensitive match so a parent who
        // imported "Minho Kim" doesn't create a new row when
        // the next import contains "MINHO KIM".
        const existing = await tx.competitor.findFirst({
          where: {
            firstName: { equals: firstName, mode: 'insensitive' },
            lastName: { equals: lastName, mode: 'insensitive' },
            dateOfBirth,
          },
        });

        if (existing) {
          // Update existing competitor
          await tx.competitor.update({
            where: { id: existing.id },
            data: {
              gender,
              belt,
              danRank,
              heightInches,
              weightLbs,
              schoolDojang,
              specialNeeds,
            },
          });
          result.updated++;
        } else {
          // Create new competitor
          await tx.competitor.create({
            data: {
              firstName,
              lastName,
              gender,
              dateOfBirth,
              belt,
              danRank,
              heightInches,
              weightLbs,
              schoolDojang,
              specialNeeds,
            },
          });
          result.imported++;
        }
      } catch (error: any) {
        result.errors.push({ row: rowNum, message: error.message });
        result.skipped++;
      }
    }
  });

  return result;
}

function parseDate(value: any): Date | null {
  if (!value) return null;

  // Handle Excel serial date number
  if (typeof value === 'number') {
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + value * 24 * 60 * 60 * 1000);
    return date;
  }

  // Handle string date
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

function parseDanRank(value: any): number | null {
  if (!value) return null;

  const str = String(value).toLowerCase().trim();

  // Handle "1st", "2nd", "3rd", etc.
  const match = str.match(/(\d+)/);
  if (match) {
    const rank = parseInt(match[1]);
    return rank >= 1 && rank <= 6 ? rank : null;
  }

  return null;
}

function parseHeight(value: any): number | null {
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

function parseWeight(value: any): number | null {
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
