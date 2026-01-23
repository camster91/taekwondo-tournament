import { PrismaClient } from '@prisma/client';
import { normalizeBelt } from '../../shared/constants/belts.js';

export interface ColumnMapping {
  firstName: string;
  lastName: string;
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
  const result: ImportResult = {
    imported: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // Account for header row

    try {
      // Extract and validate required fields
      const firstName = String(row[mapping.firstName] || '').trim();
      const lastName = String(row[mapping.lastName] || '').trim();

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

      // Check for existing competitor (by name + DOB + school)
      const existing = await prisma.competitor.findFirst({
        where: {
          firstName: { equals: firstName, mode: 'insensitive' },
          lastName: { equals: lastName, mode: 'insensitive' },
          dateOfBirth,
        },
      });

      if (existing) {
        // Update existing competitor
        await prisma.competitor.update({
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
        await prisma.competitor.create({
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

  // Handle "5'11\"" format
  const feetInchesMatch = str.match(/(\d+)'?\s*(\d*)"?/);
  if (feetInchesMatch) {
    const feet = parseInt(feetInchesMatch[1]) || 0;
    const inches = parseInt(feetInchesMatch[2]) || 0;
    return feet * 12 + inches;
  }

  // Handle raw inches or cm
  const num = parseFloat(str);
  if (!isNaN(num)) {
    return num > 12 && num < 100 ? num : num * 12; // Assume feet if small number
  }

  return null;
}

function parseWeight(value: any): number | null {
  if (!value) return null;

  const str = String(value).trim();
  const num = parseFloat(str.replace(/[^\d.]/g, ''));

  return isNaN(num) ? null : num;
}
