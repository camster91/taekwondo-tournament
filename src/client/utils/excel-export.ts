// Pure Excel multi-sheet builder extracted from Results.tsx so it can be unit
// tested. The browser-only XLSX.writeFile() call stays in Results.tsx (it
// triggers a download via the FileSaver API); this module returns a workbook
// object the caller can write.

import * as XLSX from 'xlsx';
import {
  type DivisionLike,
  type SchoolStats,
  getPlaceName,
} from './csv-export.js';

export interface BeltBreakdownRow {
  name: string;
  divisions: number;
  gold: number;
  silver: number;
  bronze: number;
}

export interface AgeBreakdownRow {
  name: string;
  divisions: number;
  gold: number;
  silver: number;
  bronze: number;
}

function parseDivisionName(name: string): { ageGroup: string; beltLevel: string } {
  const ageMatch = name.match(/^(\d+-\d+)/);
  const ageGroup = ageMatch ? ageMatch[1] : 'Unknown';
  const isBB = name.includes(' BB') || name.includes('BB-') || name.includes('Black Belt');
  const beltLevel = isBB ? 'Black Belt' : 'Colored Belt';
  return { ageGroup, beltLevel };
}

export function buildBeltBreakdown(filteredDivisions: DivisionLike[]): BeltBreakdownRow[] {
  const stats: Record<string, BeltBreakdownRow> = {
    'Black Belt': { name: 'Black Belt', divisions: 0, gold: 0, silver: 0, bronze: 0 },
    'Colored Belt': { name: 'Colored Belt', divisions: 0, gold: 0, silver: 0, bronze: 0 },
  };
  filteredDivisions.forEach((division) => {
    const { beltLevel } = parseDivisionName(division.name);
    stats[beltLevel].divisions++;
    division.bracket?.placements?.forEach((placement) => {
      if (placement.place === 1) stats[beltLevel].gold++;
      else if (placement.place === 2) stats[beltLevel].silver++;
      else if (placement.place === 3) stats[beltLevel].bronze++;
    });
  });
  return Object.values(stats);
}

export function buildAgeBreakdown(filteredDivisions: DivisionLike[]): AgeBreakdownRow[] {
  const stats: Record<string, AgeBreakdownRow> = {};
  filteredDivisions.forEach((division) => {
    const { ageGroup } = parseDivisionName(division.name);
    if (!stats[ageGroup]) {
      stats[ageGroup] = { name: ageGroup, divisions: 0, gold: 0, silver: 0, bronze: 0 };
    }
    stats[ageGroup].divisions++;
    division.bracket?.placements?.forEach((placement) => {
      if (placement.place === 1) stats[ageGroup].gold++;
      else if (placement.place === 2) stats[ageGroup].silver++;
      else if (placement.place === 3) stats[ageGroup].bronze++;
    });
  });
  return Object.values(stats).sort((a, b) => {
    const aNum = parseInt(a.name.split('-')[0]) || 999;
    const bNum = parseInt(b.name.split('-')[0]) || 999;
    return aNum - bNum;
  });
}

export function buildResultsWorkbook(
  schoolStats: SchoolStats[],
  filteredDivisions: DivisionLike[],
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const schoolData: (string | number)[][] = [
    ['Rank', 'School', 'Gold', 'Silver', 'Bronze', 'Total'],
    ...schoolStats.map((school, index) => [
      index + 1,
      school.name,
      school.gold,
      school.silver,
      school.bronze,
      school.gold + school.silver + school.bronze,
    ]),
  ];
  const schoolSheet = XLSX.utils.aoa_to_sheet(schoolData);
  schoolSheet['!cols'] = [{ wch: 6 }, { wch: 30 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }];
  XLSX.utils.book_append_sheet(wb, schoolSheet, 'School Standings');

  const divisionData: (string | number)[][] = [['Division', 'Event Type', 'Place', 'Competitor', 'School']];
  filteredDivisions.forEach((division) => {
    division.bracket?.placements
      ?.slice()
      .sort((a, b) => a.place - b.place)
      .forEach((placement) => {
        divisionData.push([
          division.name,
          division.eventType,
          getPlaceName(placement.place),
          `${placement.registration.competitor.firstName} ${placement.registration.competitor.lastName}`,
          placement.registration.competitor.schoolDojang || 'Independent',
        ]);
      });
  });
  const divisionSheet = XLSX.utils.aoa_to_sheet(divisionData);
  divisionSheet['!cols'] = [{ wch: 40 }, { wch: 12 }, { wch: 12 }, { wch: 25 }, { wch: 25 }];
  XLSX.utils.book_append_sheet(wb, divisionSheet, 'By Division');

  const beltBreakdown = buildBeltBreakdown(filteredDivisions);
  const beltData: (string | number)[][] = [
    ['Belt Level', 'Divisions', 'Gold', 'Silver', 'Bronze', 'Total'],
    ...beltBreakdown.map((belt) => [
      belt.name,
      belt.divisions,
      belt.gold,
      belt.silver,
      belt.bronze,
      belt.gold + belt.silver + belt.bronze,
    ]),
  ];
  const beltSheet = XLSX.utils.aoa_to_sheet(beltData);
  XLSX.utils.book_append_sheet(wb, beltSheet, 'By Belt Level');

  const ageBreakdown = buildAgeBreakdown(filteredDivisions);
  const ageData: (string | number)[][] = [
    ['Age Group', 'Divisions', 'Gold', 'Silver', 'Bronze', 'Total'],
    ...ageBreakdown.map((age) => [
      `${age.name} years`,
      age.divisions,
      age.gold,
      age.silver,
      age.bronze,
      age.gold + age.silver + age.bronze,
    ]),
    [
      'Total',
      ageBreakdown.reduce((s, a) => s + a.divisions, 0),
      ageBreakdown.reduce((s, a) => s + a.gold, 0),
      ageBreakdown.reduce((s, a) => s + a.silver, 0),
      ageBreakdown.reduce((s, a) => s + a.bronze, 0),
      ageBreakdown.reduce((s, a) => s + a.gold + a.silver + a.bronze, 0),
    ],
  ];
  const ageSheet = XLSX.utils.aoa_to_sheet(ageData);
  XLSX.utils.book_append_sheet(wb, ageSheet, 'By Age Group');

  return wb;
}
