// Pure Excel multi-sheet builder extracted from Results.tsx so it can be unit
// tested. The browser-only XLSX.writeFile() call stays in Results.tsx (it
// triggers a download via the FileSaver API); this module returns a workbook
// object the caller can write. The xlsx library itself is loaded via dynamic
// import inside the builder so Vite splits it out of the route chunks and the
// browser only downloads it when an export is actually requested.

import type * as XLSX from 'xlsx';
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

export async function buildResultsWorkbook(
  schoolStats: SchoolStats[],
  filteredDivisions: DivisionLike[],
): Promise<XLSX.WorkBook> {
  const XLSX = await import('xlsx');
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

  // ─── Competitor Roster ──────────────────────────────────────────────
  // Every registered competitor with their placement per division.
  // Closes M9 (missing roster sheet) from the UI audit — a director
  // printing "the full results for Division X" wants both the
  // top-3 placements AND the full list of who was there.
  const rosterData: (string | number)[][] = [
    ['Competitor', 'Gender', 'Age', 'Belt', 'School', 'Division', 'Event', 'Place'],
  ];
  filteredDivisions.forEach((division) => {
    const placements = new Map<string, string | number>();
    division.bracket?.placements?.forEach((p) => {
      // Key by competitor.id (not registration.competitorId which
      // doesn't exist — the registration nested object has a
      // competitor sub-object whose id matches the competitorIds
      // collected in the seenCompetitorIds set below).
      placements.set(p.registration.competitor.id, getPlaceName(p.place));
    });
    // We need the registrations list — currently we only have placements.
    // Use bracket.matches to find all competitors who were in this
    // division's bracket (both seeded and advanced through matches).
    const seenCompetitorIds = new Set<string>();
    division.bracket?.matches?.forEach((m) => {
      [m.competitor1, m.competitor2].forEach((c) => {
        if (c?.competitor && !seenCompetitorIds.has(c.competitor.id)) {
          seenCompetitorIds.add(c.competitor.id);
          const age = c.competitor.age ?? '';
          const belt = c.competitor.belt ?? '';
          const gender = c.competitor.gender ?? '';
          const comp = c.competitor;
          const dob = comp.dateOfBirth ? new Date(comp.dateOfBirth) : null;
          const ageText = dob
            ? Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000))
            : age;
          rosterData.push([
            `${comp.firstName} ${comp.lastName}`,
            gender,
            ageText,
            belt,
            comp.schoolDojang || 'Independent',
            division.name,
            division.eventType,
            placements.get(comp.id) ?? '—',
          ]);
        }
      });
    });
  });
  const rosterSheet = XLSX.utils.aoa_to_sheet(rosterData);
  rosterSheet['!cols'] = [
    { wch: 25 }, { wch: 8 }, { wch: 6 }, { wch: 18 },
    { wch: 22 }, { wch: 35 }, { wch: 12 }, { wch: 12 },
  ];
  XLSX.utils.book_append_sheet(wb, rosterSheet, 'Competitor Roster');

  // ─── Match Results ──────────────────────────────────────────────────
  // One row per completed match: round, match#, competitors, score,
  // winner. Closes M9 (missing match-results sheet) — directors
  // use this to print a "what happened" recap that mirrors the
  // PDF results export but in spreadsheet form.
  const matchData: (string | number)[][] = [
    ['Division', 'Round', 'Match #', 'Competitor 1', 'School', 'Score', 'Competitor 2', 'School', 'Score', 'Winner'],
  ];
  filteredDivisions.forEach((division) => {
    division.bracket?.matches
      ?.slice()
      .sort((a, b) => {
        if (a.roundNumber !== b.roundNumber) return a.roundNumber - b.roundNumber;
        return a.matchNumber - b.matchNumber;
      })
      .forEach((m) => {
        if (m.status !== 'completed') return;
        const c1Name = m.competitor1?.competitor
          ? `${m.competitor1.competitor.firstName} ${m.competitor1.competitor.lastName}`
          : '—';
        const c1School = m.competitor1?.competitor?.schoolDojang || '';
        const c2Name = m.competitor2?.competitor
          ? `${m.competitor2.competitor.firstName} ${m.competitor2.competitor.lastName}`
          : '—';
        const c2School = m.competitor2?.competitor?.schoolDojang || '';
        const s1 = m.score1 ?? '';
        const s2 = m.score2 ?? '';
        let winner = '—';
        if (m.winnerId === m.competitor1Id) winner = c1Name;
        else if (m.winnerId === m.competitor2Id) winner = c2Name;
        matchData.push([
          division.name,
          `Round ${m.roundNumber}`,
          m.matchNumber,
          c1Name, c1School, s1, c2Name, c2School, s2, winner,
        ]);
      });
  });
  const matchSheet = XLSX.utils.aoa_to_sheet(matchData);
  matchSheet['!cols'] = [
    { wch: 35 }, { wch: 10 }, { wch: 8 },
    { wch: 22 }, { wch: 20 }, { wch: 6 },
    { wch: 22 }, { wch: 20 }, { wch: 6 },
    { wch: 22 },
  ];
  XLSX.utils.book_append_sheet(wb, matchSheet, 'Match Results');

  return wb;
}
