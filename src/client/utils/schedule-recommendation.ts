export interface ScheduleRecommendationMetricSet {
  athleteConflicts: number;
  conflictGroupConflicts: number;
  ringOverlaps: number;
  unavailableRingAssignments: number;
  delayViolations: number;
  ringLoadSpreadMinutes: number;
  movedDivisions: number;
  totalPenalty: number;
}

export interface ScheduleRecommendationRecord {
  id: string;
  recommendationType: string;
  explanation: string;
  constraintsConsidered: string[];
  confidence: number;
  warnings: string[];
  status: 'proposed' | 'approved' | 'rejected' | 'applied';
  createdAt?: string;
  approvedAt?: string | null;
  operationAudit?: { id: string; undoneAt: string | null; canUndo: boolean } | null;
  inputSnapshot: {
    optimizerInput: {
      restWindowMinutes: number;
      blockedRings: number[];
      divisions: Array<{ divisionId: string; divisionName: string; locked: boolean; currentRing: number; currentStartMinutes: number }>;
    };
    evidence: {
      capturedAt: string;
      athleteIdentityCoverage: { known: number; total: number };
      conflictGroupCoverage: { known: number; total: number; coachDataAvailable: boolean };
      durationCoverage: { known: number; total: number };
      liveDelaySources: Array<{ ring: number; delayMinutes: number; source: string; observedAt: string }>;
      incidentSources: Array<{ incidentId: string; ring: number; label: string; observedAt: string }>;
    };
  };
  proposedDiff: {
    moved: Array<{
      divisionId: string;
      divisionName: string;
      before: { ring: number; startMinutes: number };
      after: { ring: number; startMinutes: number };
      reason: string;
    }>;
    before: { metrics: ScheduleRecommendationMetricSet };
    after: { metrics: ScheduleRecommendationMetricSet };
  };
}

export function formatScheduleMinute(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value >= 24 * 60) throw new Error('Schedule minute is invalid');
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export interface ScheduleConditionBuffer {
  restWindowMinutes: number;
  ringDelays: Record<number, string>;
  incidentRings: Record<string, string>;
}

export interface StoredScheduleConditions {
  restWindowMinutes: number;
  liveDelaySources: Array<{ ring: number; delayMinutes: number }>;
  incidentSources: Array<{ incidentId: string; ring: number }>;
}

export function isScheduleConditionBufferDirty(
  buffer: ScheduleConditionBuffer,
  stored: StoredScheduleConditions | undefined,
): boolean {
  if (!stored) return false;
  const storedDelays = Object.fromEntries(stored.liveDelaySources.map((entry) => [entry.ring, String(entry.delayMinutes)]));
  const storedIncidents = Object.fromEntries(stored.incidentSources.map((entry) => [entry.incidentId, String(entry.ring)]));
  return buffer.restWindowMinutes !== stored.restWindowMinutes
    || JSON.stringify(buffer.ringDelays) !== JSON.stringify(storedDelays)
    || JSON.stringify(buffer.incidentRings) !== JSON.stringify(storedIncidents);
}

const delta = (before: number, after: number, unit = '') => {
  if (before === after) return 'unchanged';
  const amount = Math.abs(after - before);
  return `${amount}${unit ? ` ${unit}` : ''} ${after < before ? 'fewer' : 'more'}`;
};

export function buildScheduleRecommendationReview(recommendation: ScheduleRecommendationRecord) {
  const before = recommendation.proposedDiff.before.metrics;
  const after = recommendation.proposedDiff.after.metrics;
  const evidence = recommendation.inputSnapshot.evidence;
  return {
    moved: recommendation.proposedDiff.moved.map((move) => ({
      divisionId: move.divisionId,
      divisionName: move.divisionName,
      before: `Ring ${move.before.ring} at ${formatScheduleMinute(move.before.startMinutes)}`,
      after: `Ring ${move.after.ring} at ${formatScheduleMinute(move.after.startMinutes)}`,
      reason: move.reason,
    })),
    locked: recommendation.inputSnapshot.optimizerInput.divisions
      .filter((division) => division.locked)
      .map(({ divisionId, divisionName, currentRing, currentStartMinutes }) => ({ divisionId, divisionName, position: `Ring ${currentRing} at ${formatScheduleMinute(currentStartMinutes)}` })),
    metrics: [
      { label: 'Athlete/rest-window conflicts', before: before.athleteConflicts, after: after.athleteConflicts, change: delta(before.athleteConflicts, after.athleteConflicts) },
      { label: 'Known school/coach conflicts', before: before.conflictGroupConflicts, after: after.conflictGroupConflicts, change: delta(before.conflictGroupConflicts, after.conflictGroupConflicts) },
      { label: 'Ring overlaps', before: before.ringOverlaps, after: after.ringOverlaps, change: delta(before.ringOverlaps, after.ringOverlaps) },
      { label: 'Blocked/ineligible ring assignments', before: before.unavailableRingAssignments, after: after.unavailableRingAssignments, change: delta(before.unavailableRingAssignments, after.unavailableRingAssignments) },
      { label: 'Live-delay violations', before: before.delayViolations, after: after.delayViolations, change: delta(before.delayViolations, after.delayViolations) },
      { label: 'Ring finish spread', before: before.ringLoadSpreadMinutes, after: after.ringLoadSpreadMinutes, change: delta(before.ringLoadSpreadMinutes, after.ringLoadSpreadMinutes, 'min') },
    ],
    coverage: [
      { label: 'Athlete identities', ...evidence.athleteIdentityCoverage },
      { label: 'Division durations', ...evidence.durationCoverage },
      { label: 'Known school/coach groups', known: evidence.conflictGroupCoverage.known, total: evidence.conflictGroupCoverage.total },
    ],
  };
}
