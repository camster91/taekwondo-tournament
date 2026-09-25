import { PrismaClient } from '@prisma/client';

export interface ScheduleConfig {
  startTime: string; // HH:MM format
  endTime: string;
  ringCount: number;
  matchDurationMinutes: {
    patterns: number;
    sparring: number;
  };
  breakBetweenDivisions: number; // minutes
}

export interface ScheduledDivision {
  divisionId: string;
  divisionName: string;
  eventType: string;
  beltLevel: string;
  gender: string;
  competitorCount: number;
  competitorNames: string[];
  ring: number;
  startTime: string;
  endTime: string;
  estimatedDurationMinutes: number;
  locked?: boolean;
}

/**
 * A division the generator could not place because it cannot start and
 * finish before midnight on any ring. It is deliberately given no ring or
 * times: clamping to 23:59 used to produce identical, overlapping slots.
 */
export interface UnscheduledDivision {
  divisionId: string;
  divisionName: string;
  eventType: string;
  beltLevel: string;
  gender: string;
  competitorCount: number;
  estimatedDurationMinutes: number;
  reason: 'past_midnight';
}

export interface TournamentSchedule {
  tournamentId: string;
  tournamentName: string;
  date: string;
  config: ScheduleConfig;
  schedule: ScheduledDivision[];
  /** Divisions that did not fit before midnight (see warnings). */
  unscheduled: UnscheduledDivision[];
  warnings: string[];
}

const DEFAULT_CONFIG: ScheduleConfig = {
  startTime: '09:00',
  endTime: '17:00',
  ringCount: 4,
  matchDurationMinutes: {
    patterns: 3,
    sparring: 5,
  },
  breakBetweenDivisions: 5,
};

export { DEFAULT_CONFIG };

// ─── Time helpers ──────────────────────────────────────────────────────
//
// Pure, exported so the route can validate config before calling
// generateSchedule, and so unit tests can exercise them directly.

const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/**
 * Parse "HH:MM" to minutes since midnight. Throws on malformed input
 * — earlier versions returned NaN which silently propagated through
 * the schedule (NaN comparisons are always false → no warnings ever
 * fired, no ring assignment was attempted). The route catches and
 * surfaces this as a 400.
 */
export function timeToMinutes(time: string): number {
  const match = HHMM_RE.exec(time);
  if (!match) {
    throw new Error(`Invalid time format: "${time}". Expected HH:MM (00:00 to 23:59).`);
  }
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

/**
 * Convert minutes since midnight to "HH:MM". Throws on negative or
 * non-finite input so the caller gets a clear error rather than a
 * silent "NaN:NaN" string in the schedule.
 */
export function minutesToTime(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new Error(`Invalid minute value: ${minutes}. Expected a non-negative finite number.`);
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

/**
 * Validate a ScheduleConfig. Throws on any issue. The route calls
 * this before passing the config to generateSchedule so malformed
 * inputs get a 400 instead of silently breaking the schedule.
 */
export function validateScheduleConfig(config: ScheduleConfig): void {
  // Ring count: positive integer.
  if (!Number.isInteger(config.ringCount) || config.ringCount < 1) {
    throw new Error(`ringCount must be a positive integer (got ${config.ringCount}).`);
  }
  if (config.ringCount > 100) {
    // Hard cap to prevent OOM on hostile input — the schedule uses
    // ringCount as a fixed array size.
    throw new Error(`ringCount must be <= 100 (got ${config.ringCount}).`);
  }
  // Times: valid HH:MM.
  const startMin = timeToMinutes(config.startTime);
  const endMin = timeToMinutes(config.endTime);
  if (endMin <= startMin) {
    throw new Error(`endTime (${config.endTime}) must be after startTime (${config.startTime}).`);
  }
  // Match durations: positive numbers.
  for (const [key, value] of Object.entries(config.matchDurationMinutes)) {
    if (typeof value !== 'number' || value <= 0) {
      throw new Error(`matchDurationMinutes.${key} must be a positive number (got ${value}).`);
    }
  }
  // Break: non-negative.
  if (typeof config.breakBetweenDivisions !== 'number' || config.breakBetweenDivisions < 0) {
    throw new Error(`breakBetweenDivisions must be a non-negative number (got ${config.breakBetweenDivisions}).`);
  }
}

/**
 * Number of matches a bracket format needs for `n` competitors.
 *
 *   double_elim: 2n-2 matches, +1 when the losers-bracket champion
 *                forces the bracket reset -> schedule the worst case 2n-1.
 *   single_elim: n-1.
 *   round_robin: n(n-1)/2.
 *
 * Byes are not matches, so these are exact regardless of padding.
 */
export function estimateMatchCount(
  competitorCount: number,
  format: 'double_elim' | 'single_elim' | 'round_robin' = 'double_elim'
): number {
  const n = Math.max(0, Math.floor(competitorCount));
  if (n < 2) return 0;
  if (format === 'single_elim') return n - 1;
  if (format === 'round_robin') return (n * (n - 1)) / 2;
  return 2 * n - 1;
}

// Estimate duration for a division based on bracket structure
export function estimateDivisionDuration(
  competitorCount: number,
  eventType: string,
  config: ScheduleConfig,
  format: 'double_elim' | 'single_elim' | 'round_robin' = 'double_elim'
): number {
  const matchDuration =
    eventType === 'patterns'
      ? config.matchDurationMinutes.patterns
      : config.matchDurationMinutes.sparring;

  // Previously `min(1.5n, 2n-1)` (12 matches for 8 competitors) and
  // capped at 90 minutes - a 16-person double-elim sparring division
  // (31 matches) was scheduled as if it took 90 minutes instead of 155,
  // so every following division on that ring was booked too early.
  const totalTime = Math.ceil(estimateMatchCount(competitorCount, format) * matchDuration);

  // Minimum 10 minutes per division (setup / call-up time).
  return Math.max(10, totalTime);
}

/**
 * Detect double-booking of a single competitor across two scheduled
 * divisions. Pure — the route assembles the per-competitor slot
 * list and the candidate slot, this returns whether they overlap.
 *
 * Convention: back-to-back (slot B starts exactly when slot A ends)
 * is NOT an overlap. A kid finishing patterns at 10:00 can start
 * sparring at 10:00 — that's the design intent.
 */
export function slotsOverlap(
  a: { start: number; end: number },
  b: { start: number; end: number }
): boolean {
  return a.start < b.end && b.start < a.end;
}

export async function generateSchedule(
  prisma: PrismaClient,
  tournamentId: string,
  configOverrides?: Partial<ScheduleConfig>
): Promise<TournamentSchedule> {
  // Validate the resolved config so a malformed override can't reach
  // the scheduling loop. The route layer also validates; this is
  // belt-and-braces for any future caller.
  const config: ScheduleConfig = { ...DEFAULT_CONFIG, ...configOverrides };
  validateScheduleConfig(config);
  const warnings: string[] = [];

  // Get tournament and divisions
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
  });

  if (!tournament) {
    throw new Error('Tournament not found');
  }

  // Schedule generation is deliberately side-effect free. Preview, GET,
  // and apply all share this deterministic calculation; persistence and
  // audit history live in the schedule-correction service.
  const divisions = await prisma.division.findMany({
    // Soft-deleted divisions are not run, so they must not take ring time.
    where: { tournamentId, deletedAt: null },
    include: {
      _count: {
        select: { assignments: true },
      },
      bracket: { select: { format: true } },
      assignments: {
        select: {
          registration: {
            select: {
              id: true,
              competitor: {
                select: { firstName: true, lastName: true },
              },
            },
          },
        },
      },
    },
    orderBy: [
      { eventType: 'asc' }, // Patterns first, then sparring
      { beltLevel: 'asc' }, // BB then CB
      { gender: 'asc' },
      { ageMin: 'asc' },
    ],
  });

  if (divisions.length === 0) {
    return {
      tournamentId,
      tournamentName: tournament.name,
      date: tournament.date.toISOString(),
      config,
      schedule: [],
      unscheduled: [],
      warnings: ['No divisions found. Generate divisions first.'],
    };
  }

  // Initialize ring schedules (track current time for each ring)
  const ringSchedules: number[] = Array(config.ringCount).fill(
    timeToMinutes(config.startTime)
  );
  const endTimeMinutes = timeToMinutes(config.endTime);

  // Group divisions by event type and category for better scheduling
  const patternsDiv = divisions.filter((d) => d.eventType === 'patterns');
  const sparringDiv = divisions.filter((d) => d.eventType === 'sparring');

  const competitorsByDivision = new Map(
    divisions.map((division) => [
      division.id,
      division.assignments.map((assignment) => {
        const competitor = assignment.registration.competitor;
        return {
          registrationId: assignment.registration.id,
          name: `${competitor.firstName} ${competitor.lastName}`.trim(),
        };
      }),
    ])
  );

  // Schedule patterns first (typically shorter)
  const scheduled: ScheduledDivision[] = [];
  // Exact start/end minutes per scheduled division. Times are tracked
  // as minutes internally and only formatted for display, so a day that
  // runs past midnight can't crash the generator by round-tripping a
  // "24:05" string through timeToMinutes.
  const minutesByDivision = new Map<string, { start: number; end: number }>();
  // Emitted slots must start and end within the same day (end <= 23:59).
  // Divisions that cannot are reported in `unscheduled` instead of being
  // clamped to 23:59, which made distinct divisions look identical and
  // overlap on the same ring.
  const LAST_MINUTE_OF_DAY = 24 * 60 - 1;
  const unscheduled: UnscheduledDivision[] = [];

  // Function to schedule a division on the least busy ring
  const scheduleDivision = (div: typeof divisions[0]) => {
    const bracketFormat = div.bracket?.format;
    const duration = estimateDivisionDuration(
      div._count.assignments,
      div.eventType,
      config,
      bracketFormat === 'single_elim' || bracketFormat === 'round_robin' ? bracketFormat : 'double_elim'
    );

    // Find ring with earliest available time
    const ringIndex = ringSchedules.indexOf(Math.min(...ringSchedules));
    const startTimeMinutes = ringSchedules[ringIndex];
    const endTimeDivision = startTimeMinutes + duration;

    if (endTimeDivision > LAST_MINUTE_OF_DAY) {
      // Leave the ring's clock untouched so a later, shorter division can
      // still use the remaining time before midnight.
      unscheduled.push({
        divisionId: div.id,
        divisionName: div.name,
        eventType: div.eventType,
        beltLevel: div.beltLevel,
        gender: div.gender,
        competitorCount: div._count.assignments,
        estimatedDurationMinutes: duration,
        reason: 'past_midnight',
      });
      return;
    }

    if (endTimeDivision > endTimeMinutes) {
      warnings.push(
        `Division "${div.name}" may run past end time (scheduled to end at ${minutesToTime(endTimeDivision)})`
      );
    }

    minutesByDivision.set(div.id, { start: startTimeMinutes, end: endTimeDivision });
    scheduled.push({
      divisionId: div.id,
      divisionName: div.name,
      eventType: div.eventType,
      beltLevel: div.beltLevel,
      gender: div.gender,
      competitorCount: div._count.assignments,
      competitorNames: div.assignments
        .map((a) => {
          const c = a.registration.competitor;
          return `${c.firstName} ${c.lastName}`.trim();
        })
        .filter((n) => n.length > 0)
        .sort((a, b) => a.localeCompare(b)),
      ring: ringIndex + 1, // 1-indexed
      startTime: minutesToTime(startTimeMinutes),
      endTime: minutesToTime(endTimeDivision),
      estimatedDurationMinutes: duration,
    });

    // Update ring schedule with break
    ringSchedules[ringIndex] = endTimeDivision + config.breakBetweenDivisions;
  };

  // Schedule patterns divisions
  patternsDiv.forEach(scheduleDivision);

  // Add a buffer between patterns and sparring
  const maxPatternsEnd = Math.max(...ringSchedules);
  for (let i = 0; i < ringSchedules.length; i++) {
    ringSchedules[i] = Math.max(ringSchedules[i], maxPatternsEnd);
  }

  // Schedule sparring divisions
  sparringDiv.forEach(scheduleDivision);

  // Sort schedule by start time then ring
  const minutesOf = (slot: ScheduledDivision) => minutesByDivision.get(slot.divisionId)!;
  scheduled.sort((a, b) => {
    const timeCompare = minutesOf(a).start - minutesOf(b).start;
    if (timeCompare !== 0) return timeCompare;
    return a.ring - b.ring;
  });

  // Per-competitor double-booking check. The schedule generator only
  // tracks per-ring time, so a kid registered in two divisions (e.g.
  // black-belt patterns + black-belt sparring) can be scheduled on
  // different rings at overlapping times. This pass scans the final
  // schedule and flags every such conflict as a warning so the
  // director can manually re-arrange.
  //
  // Note: this is detection, not auto-resolution. Auto-shifting the
  // later division to a free ring would change the schedule the
  // director approved; better to surface the conflict and let a
  // human decide. A future iteration could mark conflicting
  // divisions with a "needs review" badge in the UI.
  const competitorSlots = new Map<string, {
    name: string;
    slots: { divId: string; start: number; end: number; ring: number }[];
  }>();
  for (const slot of scheduled) {
    const { start: startMin, end: endMin } = minutesOf(slot);
    for (const competitor of competitorsByDivision.get(slot.divisionId) ?? []) {
      if (!competitorSlots.has(competitor.registrationId)) {
        competitorSlots.set(competitor.registrationId, {
          name: competitor.name,
          slots: [],
        });
      }
      competitorSlots.get(competitor.registrationId)!.slots.push({
        divId: slot.divisionId,
        start: startMin,
        end: endMin,
        ring: slot.ring,
      });
    }
  }
  // Two slots overlap if they share time and the competitor is in
  // different divisions (a competitor doing the same division twice
  // is a data error, not a scheduling conflict).
  const seenWarnings = new Set<string>();
  for (const [registrationId, competitor] of competitorSlots) {
    const { name, slots } = competitor;
    if (slots.length < 2) continue;
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const a = slots[i];
        const b = slots[j];
        if (a.divId === b.divId) continue;
        if (!slotsOverlap(a, b)) continue;
        // Sort the two for a stable warning key (alphabetical)
        const [first, second] = [a, b].sort((x, y) => x.divId.localeCompare(y.divId));
        const warnKey = `${registrationId}|${first.divId}|${second.divId}`;
        if (seenWarnings.has(warnKey)) continue;
        seenWarnings.add(warnKey);
        warnings.push(
          `Competitor "${name}" is double-booked across two divisions (${minutesToTime(first.start)} on ring ${first.ring} and ${minutesToTime(second.start)} on ring ${second.ring}). Re-assign one division or change the competitor's registration.`,
        );
      }
    }
  }

  // Check for late end time
  const latestEnd = scheduled.length > 0 ? Math.max(...scheduled.map((slot) => minutesOf(slot).end)) : 0;
  if (latestEnd > endTimeMinutes) {
    warnings.push(`Schedule extends past end time. Latest event ends at ${minutesToTime(latestEnd)}`);
  }

  if (unscheduled.length > 0) {
    warnings.push(
      `${unscheduled.length} division${unscheduled.length === 1 ? '' : 's'} could not be scheduled because `
      + `${unscheduled.length === 1 ? 'it' : 'they'} cannot finish before midnight: `
      + `${unscheduled.map((d) => `"${d.divisionName}" (${d.estimatedDurationMinutes} min)`).join(', ')}. `
      + 'Add rings, start earlier, or split the day.'
    );
  }

  return {
    tournamentId,
    tournamentName: tournament.name,
    date: tournament.date.toISOString(),
    config,
    schedule: scheduled,
    unscheduled,
    warnings,
  };
}
