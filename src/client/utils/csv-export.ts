// Pure CSV export builders extracted from Results.tsx so they can be unit tested
// without React or the browser. The browser-side download trigger stays in
// Results.tsx — these functions only produce the string[][] payload that gets
// fed into the Blob/anchor click.

export interface PlacementLike {
  place: number;
  registrationId: string;
  registration: {
    competitor: {
      id: string;
      firstName: string;
      lastName: string;
      schoolDojang: string | null;
    };
  };
}

export interface DivisionLike {
  id: string;
  name: string;
  eventType: string;
  bracket: {
    id: string;
    status: string;
    placements: PlacementLike[];
    matches: {
      id: string;
      status: string;
      roundNumber: number;
      matchNumber: number;
      score1?: number | null;
      score2?: number | null;
      winnerId?: string | null;
      competitor1Id?: string | null;
      competitor2Id?: string | null;
      competitor1?: {
        competitor: {
          id: string;
          firstName: string;
          lastName: string;
          gender?: string | null;
          age?: number | null;
          belt?: string | null;
          schoolDojang?: string | null;
          dateOfBirth?: string | null;
        };
      } | null;
      competitor2?: {
        competitor: {
          id: string;
          firstName: string;
          lastName: string;
          gender?: string | null;
          age?: number | null;
          belt?: string | null;
          schoolDojang?: string | null;
          dateOfBirth?: string | null;
        };
      } | null;
    }[];
  } | null;
}

export interface SchoolStats {
  name: string;
  gold: number;
  silver: number;
  bronze: number;
  total: number;
  competitors: number;
}

export function getPlaceName(place: number): string {
  if (place === 1) return '1st Place';
  if (place === 2) return '2nd Place';
  if (place === 3) return '3rd Place';
  // English ordinal suffix: 11/12/13 take "th", everything else follows
  // the last-digit rule. 21st/22nd/23rd are the realistic upper bound
  // for any tournament placement, but we handle 100+ too just in case.
  const mod100 = place % 100;
  const mod10 = place % 10;
  let suffix: string;
  if (mod100 >= 11 && mod100 <= 13) suffix = 'th';
  else if (mod10 === 1) suffix = 'st';
  else if (mod10 === 2) suffix = 'nd';
  else if (mod10 === 3) suffix = 'rd';
  else suffix = 'th';
  return `${place}${suffix} Place`;
}

// Quote-escape a single CSV cell per RFC 4180: wrap in double quotes and
// escape any inner double quotes by doubling them.
export function escapeCSVCell(cell: string | number | null | undefined): string {
  const s = cell == null ? '' : String(cell);
  return `"${s.replace(/"/g, '""')}"`;
}

// Join a 2D array into a single CSV string with CRLF line endings.
export function rowsToCSV(rows: (string | number | null | undefined)[][]): string {
  return rows.map((row) => row.map(escapeCSVCell).join(',')).join('\n');
}

export function buildSchoolsCSV(schoolStats: SchoolStats[]): string[][] {
  const data: string[][] = [
    ['Rank', 'School', 'Gold', 'Silver', 'Bronze', 'Total'],
  ];
  schoolStats.forEach((school, index) => {
    data.push([
      String(index + 1),
      school.name,
      String(school.gold),
      String(school.silver),
      String(school.bronze),
      String(school.gold + school.silver + school.bronze),
    ]);
  });
  return data;
}

export function buildResultsCSV(filteredDivisions: DivisionLike[]): string[][] {
  const data: string[][] = [
    ['Division', 'Event Type', 'Place', 'Competitor', 'School'],
  ];
  filteredDivisions.forEach((division) => {
    division.bracket?.placements
      ?.slice()
      .sort((a, b) => a.place - b.place)
      .forEach((placement) => {
        data.push([
          division.name,
          division.eventType,
          getPlaceName(placement.place),
          `${placement.registration.competitor.firstName} ${placement.registration.competitor.lastName}`,
          placement.registration.competitor.schoolDojang || 'Independent',
        ]);
      });
  });
  return data;
}

export function buildCompetitorsCSV(filteredDivisions: DivisionLike[]): string[][] {
  const data: string[][] = [
    ['Competitor', 'School', 'Division', 'Event Type', 'Place'],
  ];

  const competitorMap = new Map<
    string,
    { competitor: PlacementLike['registration']['competitor']; placements: { division: string; eventType: string; place: number }[] }
  >();

  filteredDivisions.forEach((division) => {
    division.bracket?.placements?.forEach((placement) => {
      const key = placement.registration.competitor.id;
      if (!competitorMap.has(key)) {
        competitorMap.set(key, {
          competitor: placement.registration.competitor,
          placements: [],
        });
      }
      competitorMap.get(key)!.placements.push({
        division: division.name,
        eventType: division.eventType,
        place: placement.place,
      });
    });
  });

  competitorMap.forEach(({ competitor, placements }) => {
    placements.forEach((p) => {
      data.push([
        `${competitor.firstName} ${competitor.lastName}`,
        competitor.schoolDojang || 'Independent',
        p.division,
        p.eventType,
        getPlaceName(p.place),
      ]);
    });
  });

  return data;
}

// Browser-only: builds a Blob URL and triggers a click on a hidden anchor.
// Kept here (not split out) because it relies on `document` and is the only
// piece of CSV code that needs the DOM. Pure data builders above have no
// browser deps and are testable.
export function downloadCSV(data: string[][], filename: string): void {
  const csvContent = data.map((row) => row.map(escapeCSVCell).join(',')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}
