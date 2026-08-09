export interface ScheduleOptimizerDivision {
  divisionId: string;
  divisionName: string;
  durationMinutes: number;
  currentRing: number;
  currentStartMinutes: number;
  eligibleRings: number[];
  registrationIds: string[];
  /** Server-resolved school or coach identifiers that must not overlap. */
  conflictGroupIds: string[];
  locked: boolean;
}

export interface ScheduleOptimizerInput {
  tournamentId: string;
  ringCount: number;
  restWindowMinutes: number;
  ringDelayMinutes: Record<number, number>;
  blockedRings: number[];
  divisions: ScheduleOptimizerDivision[];
}

export interface OptimizedScheduleRow {
  divisionId: string;
  divisionName: string;
  ring: number;
  startMinutes: number;
  endMinutes: number;
  locked: boolean;
}

export interface ScheduleScore {
  athleteConflicts: number;
  conflictGroupConflicts: number;
  ringOverlaps: number;
  unavailableRingAssignments: number;
  delayViolations: number;
  ringLoadSpreadMinutes: number;
  movedDivisions: number;
  totalPenalty: number;
}

export interface ScheduleOptimizationResult {
  before: { schedule: OptimizedScheduleRow[]; metrics: ScheduleScore };
  after: { schedule: OptimizedScheduleRow[]; metrics: ScheduleScore };
  improved: boolean;
  constraints: string[];
}

const nonNegativeInteger = (value: number, label: string) => {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
};

function validateOptimizerInput(input: ScheduleOptimizerInput): void {
  if (!input.tournamentId.trim()) throw new Error('tournamentId is required');
  if (!Number.isInteger(input.ringCount) || input.ringCount < 1 || input.ringCount > 100) {
    throw new Error('ringCount must be an integer from 1 to 100');
  }
  nonNegativeInteger(input.restWindowMinutes, 'restWindowMinutes');
  const blocked = new Set<number>();
  for (const ring of input.blockedRings) {
    if (!Number.isInteger(ring) || ring < 1 || ring > input.ringCount) throw new Error('blocked ring is outside configured ring coverage');
    if (blocked.has(ring)) throw new Error('duplicate blocked ring');
    blocked.add(ring);
  }
  for (const [rawRing, delay] of Object.entries(input.ringDelayMinutes)) {
    const ring = Number(rawRing);
    if (!Number.isInteger(ring) || ring < 1 || ring > input.ringCount) throw new Error('delayed ring is outside configured ring coverage');
    nonNegativeInteger(delay, `Ring ${ring} delay`);
  }
  const divisionIds = new Set<string>();
  for (const division of input.divisions) {
    if (!division.divisionId.trim() || divisionIds.has(division.divisionId)) throw new Error('duplicate division or missing division identity');
    divisionIds.add(division.divisionId);
    nonNegativeInteger(division.currentStartMinutes, `${division.divisionName} current start`);
    if (!Number.isInteger(division.durationMinutes) || division.durationMinutes < 1) throw new Error(`${division.divisionName} duration must be a positive integer`);
    if (!Number.isInteger(division.currentRing) || division.currentRing < 1 || division.currentRing > input.ringCount) {
      throw new Error(`${division.divisionName} current ring is outside configured ring coverage`);
    }
    if (division.eligibleRings.length === 0) throw new Error(`${division.divisionName} requires at least one eligible ring`);
    if (new Set(division.eligibleRings).size !== division.eligibleRings.length) throw new Error(`${division.divisionName} has a duplicate eligible ring`);
    if (division.eligibleRings.some((ring) => !Number.isInteger(ring) || ring < 1 || ring > input.ringCount)) {
      throw new Error(`${division.divisionName} has an eligible ring outside configured ring coverage`);
    }
    if (division.locked && !division.eligibleRings.includes(division.currentRing)) {
      throw new Error(`${division.divisionName} locked current ring is not eligible`);
    }
    if (new Set(division.registrationIds).size !== division.registrationIds.length) throw new Error(`${division.divisionName} has duplicate registrations`);
    if (new Set(division.conflictGroupIds).size !== division.conflictGroupIds.length) throw new Error(`${division.divisionName} has duplicate conflict groups`);
  }
}

export function isSafeScheduleImprovement(before: ScheduleScore, after: ScheduleScore): boolean {
  const noHardRegression = after.athleteConflicts <= before.athleteConflicts
    && after.ringOverlaps <= before.ringOverlaps
    && after.unavailableRingAssignments <= before.unavailableRingAssignments
    && after.conflictGroupConflicts <= before.conflictGroupConflicts
    && after.delayViolations <= before.delayViolations;
  return noHardRegression && after.totalPenalty < before.totalPenalty;
}

const byStartRingId = (a: OptimizedScheduleRow, b: OptimizedScheduleRow) =>
  a.startMinutes - b.startMinutes || a.ring - b.ring || a.divisionId.localeCompare(b.divisionId);

function currentSchedule(input: ScheduleOptimizerInput): OptimizedScheduleRow[] {
  return input.divisions.map((division) => ({
    divisionId: division.divisionId,
    divisionName: division.divisionName,
    ring: division.currentRing,
    startMinutes: division.currentStartMinutes,
    endMinutes: division.currentStartMinutes + division.durationMinutes,
    locked: division.locked,
  })).sort(byStartRingId);
}

function conflictsWithRest(a: OptimizedScheduleRow, b: OptimizedScheduleRow, rest: number): boolean {
  return a.startMinutes < b.endMinutes + rest && b.startMinutes < a.endMinutes + rest;
}

export function scoreTournamentSchedule(
  schedule: OptimizedScheduleRow[],
  input: ScheduleOptimizerInput,
): ScheduleScore {
  const source = new Map(input.divisions.map((division) => [division.divisionId, division]));
  let athleteConflicts = 0;
  let conflictGroupConflicts = 0;
  let ringOverlaps = 0;
  for (let i = 0; i < schedule.length; i += 1) {
    for (let j = i + 1; j < schedule.length; j += 1) {
      const a = schedule[i];
      const b = schedule[j];
      const aSource = source.get(a.divisionId)!;
      const bSource = source.get(b.divisionId)!;
      if (a.ring === b.ring && a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes) ringOverlaps += 1;
      if (!conflictsWithRest(a, b, input.restWindowMinutes)) continue;
      if (aSource.registrationIds.some((id) => bSource.registrationIds.includes(id))) athleteConflicts += 1;
      if (aSource.conflictGroupIds.some((id) => bSource.conflictGroupIds.includes(id))) conflictGroupConflicts += 1;
    }
  }

  let unavailableRingAssignments = 0;
  let delayViolations = 0;
  let movedDivisions = 0;
  const ringEnds = Array.from({ length: input.ringCount }, () => 0);
  for (const row of schedule) {
    const division = source.get(row.divisionId)!;
    if (input.blockedRings.includes(row.ring) || !division.eligibleRings.includes(row.ring)) unavailableRingAssignments += 1;
    const earliest = division.currentStartMinutes + (input.ringDelayMinutes[row.ring] ?? 0);
    if (!division.locked && row.startMinutes < earliest) delayViolations += 1;
    if (row.ring !== division.currentRing || row.startMinutes !== division.currentStartMinutes) movedDivisions += 1;
    if (row.ring >= 1 && row.ring <= ringEnds.length) ringEnds[row.ring - 1] = Math.max(ringEnds[row.ring - 1], row.endMinutes);
  }
  const activeEnds = ringEnds.filter((value) => value > 0);
  const ringLoadSpreadMinutes = activeEnds.length < 2 ? 0 : Math.max(...activeEnds) - Math.min(...activeEnds);
  const totalPenalty = athleteConflicts * 10_000
    + conflictGroupConflicts * 2_000
    + ringOverlaps * 20_000
    + unavailableRingAssignments * 50_000
    + delayViolations * 5_000
    + ringLoadSpreadMinutes
    + movedDivisions * 5;
  return {
    athleteConflicts,
    conflictGroupConflicts,
    ringOverlaps,
    unavailableRingAssignments,
    delayViolations,
    ringLoadSpreadMinutes,
    movedDivisions,
    totalPenalty,
  };
}

function constraintsFor(input: ScheduleOptimizerInput): string[] {
  return [
    ...input.blockedRings.slice().sort((a, b) => a - b)
      .map((ring) => `Ring ${ring} is unavailable because of an unresolved incident`),
    ...Object.entries(input.ringDelayMinutes)
      .filter(([, delay]) => delay > 0)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([ring, delay]) => `Ring ${ring} is currently ${delay} minutes behind`),
    ...(input.divisions.some((division) => division.locked)
      ? ['Manual schedule locks are immutable']
      : []),
  ];
}

export function optimizeTournamentSchedule(input: ScheduleOptimizerInput): ScheduleOptimizationResult {
  validateOptimizerInput(input);
  const beforeSchedule = currentSchedule(input);
  const beforeMetrics = scoreTournamentSchedule(beforeSchedule, input);
  if (input.divisions.every((division) => division.locked)) {
    return {
      before: { schedule: beforeSchedule, metrics: beforeMetrics },
      after: { schedule: beforeSchedule, metrics: beforeMetrics },
      improved: false,
      constraints: constraintsFor(input),
    };
  }

  const placed: OptimizedScheduleRow[] = beforeSchedule.filter((row) => row.locked);
  const movable = input.divisions.filter((division) => !division.locked)
    .sort((a, b) => a.currentStartMinutes - b.currentStartMinutes || a.divisionId.localeCompare(b.divisionId));
  for (const division of movable) {
    const allowedRings = division.eligibleRings
      .filter((ring) => ring >= 1 && ring <= input.ringCount && !input.blockedRings.includes(ring))
      .sort((a, b) => a - b);
    if (allowedRings.length === 0) throw new Error(`Division ${division.divisionName} has no available eligible ring`);
    const candidateStarts = new Set<number>([
      division.currentStartMinutes,
      ...placed.map((row) => row.endMinutes + input.restWindowMinutes),
    ]);
    let best: OptimizedScheduleRow | undefined;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const ring of allowedRings) {
      const earliest = division.currentStartMinutes + (input.ringDelayMinutes[ring] ?? 0);
      candidateStarts.add(earliest);
      for (const start of [...candidateStarts].sort((a, b) => a - b)) {
        if (start < earliest) continue;
        const candidate: OptimizedScheduleRow = {
          divisionId: division.divisionId,
          divisionName: division.divisionName,
          ring,
          startMinutes: start,
          endMinutes: start + division.durationMinutes,
          locked: false,
        };
        const score = scoreTournamentSchedule([...placed, candidate], input).totalPenalty;
        if (score < bestScore || (score === bestScore && (!best || byStartRingId(candidate, best) < 0))) {
          best = candidate;
          bestScore = score;
        }
      }
    }
    placed.push(best!);
  }
  const proposed = placed.sort(byStartRingId);
  const proposedMetrics = scoreTournamentSchedule(proposed, input);
  const improved = isSafeScheduleImprovement(beforeMetrics, proposedMetrics);
  return {
    before: { schedule: beforeSchedule, metrics: beforeMetrics },
    after: improved ? { schedule: proposed, metrics: proposedMetrics } : { schedule: beforeSchedule, metrics: beforeMetrics },
    improved,
    constraints: constraintsFor(input),
  };
}
