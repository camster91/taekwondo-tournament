import { PrismaClient } from '@prisma/client';

interface ScheduleConfig {
  startTime: string; // HH:MM format
  endTime: string;
  ringCount: number;
  matchDurationMinutes: {
    patterns: number;
    sparring: number;
  };
  breakBetweenDivisions: number; // minutes
}

interface ScheduledDivision {
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
}

interface TournamentSchedule {
  tournamentId: string;
  tournamentName: string;
  date: string;
  config: ScheduleConfig;
  schedule: ScheduledDivision[];
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

// Helper to parse time string to minutes since midnight
function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

// Helper to convert minutes since midnight to time string
function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

// Estimate duration for a division based on bracket structure
function estimateDivisionDuration(
  competitorCount: number,
  eventType: string,
  config: ScheduleConfig
): number {
  // For double elimination, total matches ≈ 2 * (n - 1) where n is competitors
  // But many are BYEs in first round, so we use: ceil(log2(n)) rounds
  // Simplified: assume ~n matches for small brackets
  const matchDuration =
    eventType === 'patterns'
      ? config.matchDurationMinutes.patterns
      : config.matchDurationMinutes.sparring;

  // For 8 competitors: roughly 14 matches in double elimination
  // But with BYEs, closer to 10-12 actual matches
  const estimatedMatches = Math.min(competitorCount * 1.5, competitorCount * 2 - 1);
  const totalTime = Math.ceil(estimatedMatches * matchDuration);

  // Minimum 10 minutes, maximum 90 minutes per division
  return Math.max(10, Math.min(90, totalTime));
}

export async function generateSchedule(
  prisma: PrismaClient,
  tournamentId: string,
  configOverrides?: Partial<ScheduleConfig>
): Promise<TournamentSchedule> {
  const config = { ...DEFAULT_CONFIG, ...configOverrides };
  const warnings: string[] = [];

  // Get tournament and divisions
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
  });

  if (!tournament) {
    throw new Error('Tournament not found');
  }

  // Persist the schedule config to tournament.settings so the
  // DirectorDashboard can read the configured ring count even before
  // any matches have been assigned a ringNumber. Closes #34 — the
  // dashboard used to derive the rings array purely from m.ringNumber
  // on matches, so a brand-new tournament (or one with no matches yet
  // routed to a ring) showed "No rings assigned yet" despite rings
  // being configured in Schedule.
  if (configOverrides && Object.keys(configOverrides).length > 0) {
    let current: Record<string, any> = {};
    if (tournament.settings) {
      try { current = JSON.parse(tournament.settings); } catch { current = {}; }
    }
    current.rings = { count: config.ringCount, startTime: config.startTime, endTime: config.endTime };
    await prisma.tournament.update({
      where: { id: tournamentId },
      data: { settings: JSON.stringify(current) },
    });
  }

  const divisions = await prisma.division.findMany({
    where: { tournamentId },
    include: {
      _count: {
        select: { assignments: true },
      },
      assignments: {
        select: {
          registration: {
            select: {
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

  // Schedule patterns first (typically shorter)
  const scheduled: ScheduledDivision[] = [];

  // Function to schedule a division on the least busy ring
  const scheduleDivision = (div: typeof divisions[0]) => {
    const duration = estimateDivisionDuration(
      div._count.assignments,
      div.eventType,
      config
    );

    // Find ring with earliest available time
    const ringIndex = ringSchedules.indexOf(Math.min(...ringSchedules));
    const startTimeMinutes = ringSchedules[ringIndex];
    const endTimeDivision = startTimeMinutes + duration;

    if (endTimeDivision > endTimeMinutes) {
      warnings.push(
        `Division "${div.name}" may run past end time (scheduled to end at ${minutesToTime(endTimeDivision)})`
      );
    }

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
  scheduled.sort((a, b) => {
    const timeCompare =
      timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
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
  const competitorSlots = new Map<string, { divId: string; start: number; end: number; ring: number }[]>();
  for (const slot of scheduled) {
    const startMin = timeToMinutes(slot.startTime);
    const endMin = timeToMinutes(slot.endTime);
    for (const name of slot.competitorNames) {
      // Normalise to handle whitespace differences ("Minho Kim" vs "Minho  Kim")
      const key = name.replace(/\s+/g, ' ').trim();
      if (!competitorSlots.has(key)) competitorSlots.set(key, []);
      competitorSlots.get(key)!.push({
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
  for (const [name, slots] of competitorSlots) {
    if (slots.length < 2) continue;
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const a = slots[i];
        const b = slots[j];
        if (a.divId === b.divId) continue;
        const overlaps = a.start < b.end && b.start < a.end;
        if (!overlaps) continue;
        // Sort the two for a stable warning key (alphabetical)
        const [first, second] = [a, b].sort((x, y) => x.divId.localeCompare(y.divId));
        const warnKey = `${name}|${first.divId}|${second.divId}`;
        if (seenWarnings.has(warnKey)) continue;
        seenWarnings.add(warnKey);
        warnings.push(
          `Competitor "${name}" is double-booked across two divisions (${minutesToTime(first.start)} on ring ${first.ring} and ${minutesToTime(second.start)} on ring ${second.ring}). Re-assign one division or change the competitor's registration.`,
        );
      }
    }
  }

  // Check for late end time
  const latestEnd = Math.max(
    ...scheduled.map((s) => timeToMinutes(s.endTime))
  );
  if (latestEnd > endTimeMinutes) {
    warnings.push(
      `Schedule extends past end time. Latest event ends at ${minutesToTime(latestEnd)}`
    );
  }

  return {
    tournamentId,
    tournamentName: tournament.name,
    date: tournament.date.toISOString(),
    config,
    schedule: scheduled,
    warnings,
  };
}
