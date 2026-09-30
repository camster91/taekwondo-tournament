/**
 * Day-of staffing coverage (#192). Pure functions: given the schedule window,
 * ring count and active assignments, report what is unstaffed and who is
 * double-booked. The route layer loads the data and writes nothing here.
 */

import { STAFF_DUTIES, STAFF_DUTY_LABELS, type StaffDuty } from '../../shared/constants/staff-duties.js';

export { STAFF_DUTIES, STAFF_DUTY_LABELS, type StaffDuty };

/**
 * Coverage every ring needs for the whole schedule window. Kept to the one
 * duty the product cannot run a ring without; other duties are recorded but
 * not required.
 */
export const REQUIRED_RING_DUTIES: readonly StaffDuty[] = ['scorekeeper'];

export interface CoverageAssignment {
  id: string;
  userId: string;
  duty: string;
  ringNumber: number | null;
  startTime: string;
  endTime: string;
}

export interface CoverageGap {
  ringNumber: number;
  duty: StaffDuty;
  startTime: string;
  endTime: string;
}

export interface CoverageConflict {
  userId: string;
  assignmentIds: [string, string];
  startTime: string;
  endTime: string;
}

export interface CoverageReport {
  gaps: CoverageGap[];
  conflicts: CoverageConflict[];
  staffedRings: number;
  ringCount: number;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTime(value: string): boolean {
  return TIME_PATTERN.test(value);
}

export function toMinutes(value: string): number {
  const match = TIME_PATTERN.exec(value);
  if (!match) throw new Error(`Invalid time "${value}"`);
  return Number(match[1]) * 60 + Number(match[2]);
}

export function fromMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Uncovered sub-ranges of [start, end) after removing the covered intervals. */
function uncovered(start: number, end: number, covered: Array<[number, number]>): Array<[number, number]> {
  const sorted = covered
    .map(([s, e]) => [Math.max(s, start), Math.min(e, end)] as [number, number])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  const gaps: Array<[number, number]> = [];
  let cursor = start;
  for (const [s, e] of sorted) {
    if (s > cursor) gaps.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < end) gaps.push([cursor, end]);
  return gaps;
}

export function computeCoverage(input: {
  ringCount: number;
  windowStart: string;
  windowEnd: string;
  assignments: CoverageAssignment[];
}): CoverageReport {
  const windowStart = toMinutes(input.windowStart);
  const windowEnd = toMinutes(input.windowEnd);
  const gaps: CoverageGap[] = [];
  let staffedRings = 0;

  for (let ring = 1; ring <= input.ringCount; ring += 1) {
    let ringFullyStaffed = true;
    for (const duty of REQUIRED_RING_DUTIES) {
      const covered = input.assignments
        .filter((a) => a.ringNumber === ring && a.duty === duty)
        .map((a) => [toMinutes(a.startTime), toMinutes(a.endTime)] as [number, number]);
      for (const [s, e] of uncovered(windowStart, windowEnd, covered)) {
        ringFullyStaffed = false;
        gaps.push({ ringNumber: ring, duty, startTime: fromMinutes(s), endTime: fromMinutes(e) });
      }
    }
    if (ringFullyStaffed) staffedRings += 1;
  }

  // Double-booking: the same person in two overlapping assignments.
  const conflicts: CoverageConflict[] = [];
  const byUser = new Map<string, CoverageAssignment[]>();
  for (const assignment of input.assignments) {
    const list = byUser.get(assignment.userId) ?? [];
    list.push(assignment);
    byUser.set(assignment.userId, list);
  }
  for (const [userId, list] of byUser) {
    const sorted = [...list].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const a = sorted[i];
        const b = sorted[j];
        const overlapStart = Math.max(toMinutes(a.startTime), toMinutes(b.startTime));
        const overlapEnd = Math.min(toMinutes(a.endTime), toMinutes(b.endTime));
        if (overlapEnd <= overlapStart) continue;
        conflicts.push({
          userId,
          assignmentIds: [a.id, b.id],
          startTime: fromMinutes(overlapStart),
          endTime: fromMinutes(overlapEnd),
        });
      }
    }
  }

  return { gaps, conflicts, staffedRings, ringCount: input.ringCount };
}
