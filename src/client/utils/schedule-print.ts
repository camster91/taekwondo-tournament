/**
 * Ring-by-time grid for the printable schedule: one row per start time,
 * one column per ring. Pure so it can be unit tested.
 */

export interface PrintableScheduledDivision {
  divisionId: string;
  divisionName: string;
  eventType: string;
  beltLevel: string;
  gender: string;
  competitorCount: number;
  ring: number;
  startTime: string; // HH:MM
  endTime: string; // HH:MM
}

export interface RingTimeRow<T extends PrintableScheduledDivision> {
  startTime: string;
  /** Divisions starting at this time, keyed by ring number. */
  cells: Record<number, T[]>;
}

export interface RingTimeGrid<T extends PrintableScheduledDivision> {
  rings: number[];
  rows: Array<RingTimeRow<T>>;
}

function minutes(time: string): number {
  const [h, m] = time.split(':').map((part) => Number.parseInt(part, 10));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

export function buildRingTimeGrid<T extends PrintableScheduledDivision>(
  divisions: T[],
  ringCount = 0,
): RingTimeGrid<T> {
  const ringSet = new Set<number>(divisions.map((d) => d.ring));
  // Show every configured ring, even one with nothing on it, so the
  // sheet matches the floor.
  for (let ring = 1; ring <= ringCount; ring++) ringSet.add(ring);
  const rings = [...ringSet].sort((a, b) => a - b);

  const byTime = new Map<string, RingTimeRow<T>>();
  const sorted = [...divisions].sort(
    (a, b) => minutes(a.startTime) - minutes(b.startTime) || a.ring - b.ring || a.divisionName.localeCompare(b.divisionName),
  );
  for (const division of sorted) {
    let row = byTime.get(division.startTime);
    if (!row) {
      row = { startTime: division.startTime, cells: {} };
      byTime.set(division.startTime, row);
    }
    (row.cells[division.ring] ??= []).push(division);
  }
  return { rings, rows: [...byTime.values()] };
}
