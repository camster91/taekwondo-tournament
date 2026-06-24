import { describe, it, expect } from 'vitest';
import {
  buildSchoolsCSV,
  buildResultsCSV,
  buildCompetitorsCSV,
  escapeCSVCell,
  getPlaceName,
  rowsToCSV,
  type DivisionLike,
  type SchoolStats,
} from './csv-export.js';
import {
  buildBeltBreakdown,
  buildAgeBreakdown,
  buildResultsWorkbook,
} from './excel-export.js';

// --- Fixtures ----------------------------------------------------------------

const mkCompetitor = (id: string, first: string, last: string, school: string | null) => ({
  id,
  firstName: first,
  lastName: last,
  schoolDojang: school,
});

const mkPlacement = (place: number, competitor: ReturnType<typeof mkCompetitor>) => ({
  place,
  registrationId: `reg-${competitor.id}-${place}`,
  registration: { competitor },
});

const mkDivision = (
  id: string,
  name: string,
  eventType: string,
  placements: ReturnType<typeof mkPlacement>[],
): DivisionLike => ({
  id,
  name,
  eventType,
  bracket: {
    id: `bracket-${id}`,
    status: 'completed',
    placements,
    matches: [{ id: 'm1', status: 'completed' }],
  },
});

const sampleDivisions: DivisionLike[] = [
  mkDivision('d1', '10-11 BB Male Sparring', 'sparring', [
    mkPlacement(1, mkCompetitor('c1', 'Alice', 'Nguyen', 'Dragon Taekwondo')),
    mkPlacement(2, mkCompetitor('c2', 'Bob', 'Patel', 'Dragon Taekwondo')),
    mkPlacement(3, mkCompetitor('c3', 'Carlos', 'Reyes', 'Eagle Martial Arts')),
  ]),
  mkDivision('d2', '12-14 Colored Female Patterns', 'patterns', [
    mkPlacement(1, mkCompetitor('c4', 'Dana', 'Kim', 'Eagle Martial Arts')),
    mkPlacement(2, mkCompetitor('c5', 'Eve', 'Singh', null)),
  ]),
];

const sampleSchools: SchoolStats[] = [
  { name: 'Dragon Taekwondo', gold: 1, silver: 1, bronze: 0, total: 2, competitors: 5 },
  { name: 'Eagle Martial Arts', gold: 1, silver: 0, bronze: 1, total: 2, competitors: 3 },
  { name: 'Independent', gold: 0, silver: 1, bronze: 0, total: 1, competitors: 1 },
];

// --- Pure helpers ------------------------------------------------------------

describe('getPlaceName', () => {
  it('formats 1/2/3 as 1st/2nd/3rd and 4+ as Nth', () => {
    expect(getPlaceName(1)).toBe('1st Place');
    expect(getPlaceName(2)).toBe('2nd Place');
    expect(getPlaceName(3)).toBe('3rd Place');
    expect(getPlaceName(4)).toBe('4th Place');
    expect(getPlaceName(11)).toBe('11th Place');
    expect(getPlaceName(21)).toBe('21st Place');
  });
});

describe('escapeCSVCell', () => {
  it('quotes a simple value', () => {
    expect(escapeCSVCell('hello')).toBe('"hello"');
  });

  it('escapes inner double quotes by doubling them', () => {
    expect(escapeCSVCell('she said "hi"')).toBe('"she said ""hi"""');
  });

  it('handles null and undefined as empty', () => {
    expect(escapeCSVCell(null)).toBe('""');
    expect(escapeCSVCell(undefined)).toBe('""');
  });

  it('stringifies numbers', () => {
    expect(escapeCSVCell(42)).toBe('"42"');
  });

  it('keeps commas intact inside quotes so the cell does not split', () => {
    expect(escapeCSVCell('Newton, MA')).toBe('"Newton, MA"');
  });
});

describe('rowsToCSV', () => {
  it('joins rows with newlines and wraps every cell', () => {
    const out = rowsToCSV([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(out).toBe('"a","b"\n"c","d"');
  });
});

// --- CSV builders: column count + at least one row of real data -------------

describe('buildSchoolsCSV', () => {
  it('has exactly 6 columns', () => {
    const data = buildSchoolsCSV(sampleSchools);
    expect(data.length).toBeGreaterThan(0);
    for (const row of data) {
      expect(row).toHaveLength(6);
    }
  });

  it('uses the documented column header order', () => {
    const data = buildSchoolsCSV(sampleSchools);
    expect(data[0]).toEqual(['Rank', 'School', 'Gold', 'Silver', 'Bronze', 'Total']);
  });

  it('emits at least one data row of real school stats', () => {
    const data = buildSchoolsCSV(sampleSchools);
    expect(data.length).toBe(sampleSchools.length + 1); // header + rows
    // First school row: rank 1, name, g, s, b, total
    const dragon = data.find((row) => row[1] === 'Dragon Taekwondo');
    expect(dragon).toBeDefined();
    expect(dragon).toEqual(['1', 'Dragon Taekwondo', '1', '1', '0', '2']);
  });

  it('handles empty input with header only', () => {
    const data = buildSchoolsCSV([]);
    expect(data).toHaveLength(1);
    expect(data[0]).toEqual(['Rank', 'School', 'Gold', 'Silver', 'Bronze', 'Total']);
  });
});

describe('buildResultsCSV', () => {
  it('has exactly 5 columns on every row', () => {
    const data = buildResultsCSV(sampleDivisions);
    for (const row of data) {
      expect(row).toHaveLength(5);
    }
  });

  it('uses the documented column header order', () => {
    const data = buildResultsCSV(sampleDivisions);
    expect(data[0]).toEqual(['Division', 'Event Type', 'Place', 'Competitor', 'School']);
  });

  it('emits at least one row of real placement data per division', () => {
    const data = buildResultsCSV(sampleDivisions);
    // 3 placements in d1 + 2 in d2 = 5 data rows + 1 header
    expect(data.length).toBe(6);

    // First d1 row should be 1st place, Alice Nguyen
    const alice = data.find((row) => row[3] === 'Alice Nguyen');
    expect(alice).toBeDefined();
    expect(alice).toEqual([
      '10-11 BB Male Sparring',
      'sparring',
      '1st Place',
      'Alice Nguyen',
      'Dragon Taekwondo',
    ]);
  });

  it('falls back to Independent when schoolDojang is null', () => {
    const data = buildResultsCSV(sampleDivisions);
    const eve = data.find((row) => row[3] === 'Eve Singh');
    expect(eve).toBeDefined();
    expect(eve![4]).toBe('Independent');
  });

  it('sorts placements within a division by place (1, 2, 3)', () => {
    const div = mkDivision('d-x', 'Test', 'sparring', [
      mkPlacement(3, mkCompetitor('c1', 'Third', 'A', 'X')),
      mkPlacement(1, mkCompetitor('c2', 'First', 'B', 'X')),
      mkPlacement(2, mkCompetitor('c3', 'Second', 'C', 'X')),
    ]);
    const data = buildResultsCSV([div]);
    expect(data[1][2]).toBe('1st Place');
    expect(data[2][2]).toBe('2nd Place');
    expect(data[3][2]).toBe('3rd Place');
  });

  it('handles empty input with header only', () => {
    expect(buildResultsCSV([])).toEqual([
      ['Division', 'Event Type', 'Place', 'Competitor', 'School'],
    ]);
  });
});

describe('buildCompetitorsCSV', () => {
  it('has exactly 5 columns on every row', () => {
    const data = buildCompetitorsCSV(sampleDivisions);
    for (const row of data) {
      expect(row).toHaveLength(5);
    }
  });

  it('uses the documented column header order', () => {
    const data = buildCompetitorsCSV(sampleDivisions);
    expect(data[0]).toEqual(['Competitor', 'School', 'Division', 'Event Type', 'Place']);
  });

  it('emits at least one row per (competitor, division) placement', () => {
    const data = buildCompetitorsCSV(sampleDivisions);
    // 5 placements total across the two divisions, all unique competitors
    expect(data.length).toBe(6); // header + 5
  });

  it('groups placements per competitor across multiple divisions', () => {
    // c1 appears in two divisions
    const divA = mkDivision('da', 'Div A', 'sparring', [
      mkPlacement(1, mkCompetitor('c1', 'Alice', 'Nguyen', 'X')),
    ]);
    const divB = mkDivision('db', 'Div B', 'patterns', [
      mkPlacement(2, mkCompetitor('c1', 'Alice', 'Nguyen', 'X')),
    ]);
    const data = buildCompetitorsCSV([divA, divB]);
    const aliceRows = data.filter((row) => row[0] === 'Alice Nguyen');
    expect(aliceRows).toHaveLength(2);
    expect(aliceRows.map((r) => r[4]).sort()).toEqual(['1st Place', '2nd Place']);
  });
});

// --- Excel builder sanity ----------------------------------------------------

describe('buildBeltBreakdown', () => {
  it('returns one row per belt level (Black + Colored) with the right counts', () => {
    const breakdown = buildBeltBreakdown(sampleDivisions);
    expect(breakdown).toHaveLength(2);
    const byName = Object.fromEntries(breakdown.map((b) => [b.name, b]));
    expect(byName['Black Belt']?.divisions).toBe(1);
    expect(byName['Black Belt']?.gold).toBe(1);
    expect(byName['Colored Belt']?.divisions).toBe(1);
    expect(byName['Colored Belt']?.gold).toBe(1);
  });

  it('returns zeroed rows for both belt levels when input is empty', () => {
    const breakdown = buildBeltBreakdown([]);
    expect(breakdown).toHaveLength(2);
    for (const row of breakdown) {
      expect(row.divisions).toBe(0);
      expect(row.gold).toBe(0);
    }
  });
});

describe('buildAgeBreakdown', () => {
  it('groups divisions by the leading age range in the division name', () => {
    const breakdown = buildAgeBreakdown(sampleDivisions);
    expect(breakdown.map((b) => b.name)).toEqual(['10-11', '12-14']);
    expect(breakdown[0].divisions).toBe(1);
    expect(breakdown[1].divisions).toBe(1);
  });

  it('marks divisions with no leading age range as Unknown', () => {
    const div = mkDivision('x', 'Open Weight', 'sparring', []);
    const breakdown = buildAgeBreakdown([div]);
    expect(breakdown.find((b) => b.name === 'Unknown')).toBeDefined();
  });
});

describe('buildResultsWorkbook', () => {
  it('produces a workbook with the six expected sheets', () => {
    const wb = buildResultsWorkbook(sampleSchools, sampleDivisions);
    // 6 sheets now: standings, divisions, belts, ages, roster, matches.
    // Closes M9 from the UI audit — added Competitor Roster + Match Results.
    expect(wb.SheetNames).toEqual([
      'School Standings',
      'By Division',
      'By Belt Level',
      'By Age Group',
      'Competitor Roster',
      'Match Results',
    ]);
  });

  it('populates the School Standings sheet with header + at least one data row', () => {
    const wb = buildResultsWorkbook(sampleSchools, sampleDivisions);
    const sheet = wb.Sheets['School Standings'];
    expect(sheet).toBeDefined();
    // A1 is the header
    expect(sheet['A1']?.v).toBe('Rank');
    // First data row: rank 1, Dragon Taekwondo
    expect(sheet['A2']?.v).toBe(1);
    expect(sheet['B2']?.v).toBe('Dragon Taekwondo');
  });

  it('populates the By Division sheet with placement rows', () => {
    const wb = buildResultsWorkbook(sampleSchools, sampleDivisions);
    const sheet = wb.Sheets['By Division'];
    expect(sheet).toBeDefined();
    expect(sheet['A1']?.v).toBe('Division');
    // First placement row
    expect(sheet['A2']?.v).toBe('10-11 BB Male Sparring');
    expect(sheet['C2']?.v).toBe('1st Place');
    expect(sheet['D2']?.v).toBe('Alice Nguyen');
  });
});
