import { PrismaClient } from '@prisma/client';
import XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();

// Belt normalization mapping
const BELT_ALIASES = {
  'W': 'White',
  'WHITE': 'White',
  'Y': 'Yellow',
  'YELLOW': 'Yellow',
  'G': 'Green',
  'GREEN': 'Green',
  'B': 'Blue',
  'BLUE': 'Blue',
  'R': 'Red',
  'RED': 'Red',
  'BL': 'Black',
  'BLACK': 'Black',
  'BB': 'Black',
};

function normalizeBelt(belt) {
  if (!belt) return null;
  const upper = belt.toUpperCase().trim();
  return BELT_ALIASES[upper] || belt.trim();
}

function parseHeight(value) {
  if (!value) return null;
  const str = String(value).trim();

  // Handle "5'11\"" or "5'11" format
  const feetInchesMatch = str.match(/(\d+)'?\s*(\d*)"?/);
  if (feetInchesMatch) {
    const feet = parseInt(feetInchesMatch[1]) || 0;
    const inches = parseInt(feetInchesMatch[2]) || 0;
    return feet * 12 + inches;
  }

  const num = parseFloat(str);
  if (!isNaN(num)) {
    return num > 12 && num < 100 ? num : num * 12;
  }

  return null;
}

function parseWeight(value) {
  if (!value) return null;
  const str = String(value).trim();
  const num = parseFloat(str.replace(/[^\d.]/g, ''));
  return isNaN(num) ? null : num;
}

function parseDanRank(value) {
  if (!value) return null;
  const str = String(value).toLowerCase().trim();
  const match = str.match(/(\d+)/);
  if (match) {
    const rank = parseInt(match[1]);
    return rank >= 1 && rank <= 6 ? rank : null;
  }
  return null;
}

function splitName(fullName) {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }
  const firstName = parts[0];
  const lastName = parts.slice(1).join(' ');
  return { firstName, lastName };
}

async function importCompetitors() {
  const excelPath = path.join(__dirname, '../../2025 NEWTONS CHAMPIONSHIP LIST.xlsm');
  console.log('Reading Excel file:', excelPath);

  const workbook = XLSX.readFile(excelPath);
  const worksheet = workbook.Sheets['Competitors list'];

  if (!worksheet) {
    throw new Error('Could not find "Competitors list" sheet');
  }

  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  const headers = data[0];
  console.log('Headers found:', headers);

  // Find column indices
  const colIndex = {
    gender: headers.indexOf('Gender'),
    name: headers.indexOf('Name'),
    age: headers.indexOf('Age'),
    belt: headers.indexOf('Belt'),
    dan: headers.indexOf('DAN'),
    height: headers.indexOf('Height'),
    weight: headers.findIndex(h => h && h.toLowerCase().includes('weight')),
    school: headers.indexOf('School'),
    patterns: headers.indexOf('Patterns'),
    sparring: headers.indexOf('Sparring'),
  };

  console.log('Column indices:', colIndex);

  const stats = { imported: 0, skipped: 0, errors: [] };

  // Process data rows (skip header)
  for (let i = 1; i < data.length; i++) {
    const row = data[i];

    // Skip empty rows
    if (!row || row.length === 0 || !row[colIndex.name]) {
      continue;
    }

    const fullName = String(row[colIndex.name] || '').trim();
    if (!fullName) continue;

    try {
      const { firstName, lastName } = splitName(fullName);

      // Parse gender
      const genderRaw = String(row[colIndex.gender] || '').toUpperCase().trim();
      const gender = genderRaw.startsWith('M') ? 'M' : genderRaw.startsWith('F') ? 'F' : null;

      if (!gender) {
        stats.errors.push({ row: i + 1, message: `Invalid gender: "${genderRaw}" for ${fullName}` });
        stats.skipped++;
        continue;
      }

      // Parse age and calculate DOB
      const age = parseInt(String(row[colIndex.age] || ''));
      if (isNaN(age)) {
        stats.errors.push({ row: i + 1, message: `Invalid age for ${fullName}` });
        stats.skipped++;
        continue;
      }

      // Calculate approximate DOB (use Jan 1 of birth year)
      const today = new Date();
      const dateOfBirth = new Date(today.getFullYear() - age, 0, 1);

      // Parse belt
      const beltRaw = String(row[colIndex.belt] || '').trim();
      const belt = normalizeBelt(beltRaw);

      if (!belt) {
        stats.errors.push({ row: i + 1, message: `Missing belt for ${fullName}` });
        stats.skipped++;
        continue;
      }

      // Parse optional fields
      const danRank = colIndex.dan >= 0 ? parseDanRank(row[colIndex.dan]) : null;
      const heightInches = colIndex.height >= 0 ? parseHeight(row[colIndex.height]) : null;
      const weightLbs = colIndex.weight >= 0 ? parseWeight(row[colIndex.weight]) : null;
      const schoolDojang = colIndex.school >= 0 ? String(row[colIndex.school] || '').trim() || null : null;

      // Check if competitor already exists
      const existing = await prisma.competitor.findFirst({
        where: {
          firstName: { equals: firstName },
          lastName: { equals: lastName },
        },
      });

      if (existing) {
        // Update existing
        await prisma.competitor.update({
          where: { id: existing.id },
          data: {
            gender,
            dateOfBirth,
            belt,
            danRank,
            heightInches,
            weightLbs,
            schoolDojang,
          },
        });
        console.log(`Updated: ${firstName} ${lastName}`);
      } else {
        // Create new
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
          },
        });
        console.log(`Imported: ${firstName} ${lastName}`);
      }

      stats.imported++;
    } catch (error) {
      stats.errors.push({ row: i + 1, message: error.message });
      stats.skipped++;
    }
  }

  return stats;
}

async function main() {
  try {
    console.log('Starting import...\n');
    const stats = await importCompetitors();

    console.log('\n=== Import Complete ===');
    console.log(`Imported/Updated: ${stats.imported}`);
    console.log(`Skipped: ${stats.skipped}`);

    if (stats.errors.length > 0) {
      console.log('\nErrors:');
      stats.errors.forEach(e => console.log(`  Row ${e.row}: ${e.message}`));
    }

    // Show total count in database
    const total = await prisma.competitor.count();
    console.log(`\nTotal competitors in database: ${total}`);

  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
