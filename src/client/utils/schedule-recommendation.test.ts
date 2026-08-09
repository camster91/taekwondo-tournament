import { describe, expect, it } from 'vitest';
import { buildScheduleRecommendationReview, formatScheduleMinute, isScheduleConditionBufferDirty } from './schedule-recommendation';

describe('schedule recommendation review', () => {
  it('builds truthful safety deltas and moved-row labels', () => {
    const review = buildScheduleRecommendationReview({
      inputSnapshot: {
        optimizerInput: {
          divisions: [
            { divisionId: 'locked', divisionName: 'Locked Patterns', locked: true, currentRing: 1, currentStartMinutes: 540 },
            { divisionId: 'moved', divisionName: 'Junior Sparring', locked: false, currentRing: 2, currentStartMinutes: 600 },
          ],
          restWindowMinutes: 10,
          blockedRings: [3],
        },
        evidence: {
          capturedAt: '2026-08-09T14:48:00.000Z',
          athleteIdentityCoverage: { known: 8, total: 10 },
          conflictGroupCoverage: { known: 7, total: 10, coachDataAvailable: false },
          durationCoverage: { known: 2, total: 2 },
          liveDelaySources: [{ ring: 2, delayMinutes: 18, source: 'director-confirmed', observedAt: '2026-08-09T14:45:00.000Z' }],
          incidentSources: [{ incidentId: 'incident-1', ring: 3, label: 'equipment (minor)', observedAt: '2026-08-09T14:46:00.000Z' }],
        },
      },
      proposedDiff: {
        moved: [{ divisionId: 'moved', divisionName: 'Junior Sparring', before: { ring: 2, startMinutes: 600 }, after: { ring: 1, startMinutes: 618 }, reason: 'Responds to Ring 2 delay.' }],
        before: { metrics: { athleteConflicts: 2, conflictGroupConflicts: 1, ringOverlaps: 0, unavailableRingAssignments: 0, delayViolations: 1, ringLoadSpreadMinutes: 30, movedDivisions: 0, totalPenalty: 1 } },
        after: { metrics: { athleteConflicts: 0, conflictGroupConflicts: 1, ringOverlaps: 0, unavailableRingAssignments: 0, delayViolations: 0, ringLoadSpreadMinutes: 12, movedDivisions: 1, totalPenalty: 0 } },
      },
    } as never);

    expect(review.moved).toEqual([{ divisionId: 'moved', divisionName: 'Junior Sparring', before: 'Ring 2 at 10:00', after: 'Ring 1 at 10:18', reason: 'Responds to Ring 2 delay.' }]);
    expect(review.locked).toEqual([{ divisionId: 'locked', divisionName: 'Locked Patterns', position: 'Ring 1 at 09:00' }]);
    expect(review.metrics).toContainEqual({ label: 'Athlete/rest-window conflicts', before: 2, after: 0, change: '2 fewer' });
    expect(review.metrics).toContainEqual({ label: 'Known school/coach conflicts', before: 1, after: 1, change: 'unchanged' });
    expect(review.coverage).toEqual([
      { label: 'Athlete identities', known: 8, total: 10 },
      { label: 'Division durations', known: 2, total: 2 },
      { label: 'Known school/coach groups', known: 7, total: 10 },
    ]);
  });

  it('formats schedule minutes without locale ambiguity', () => {
    expect(formatScheduleMinute(0)).toBe('00:00');
    expect(formatScheduleMinute(9 * 60 + 5)).toBe('09:05');
    expect(() => formatScheduleMinute(-1)).toThrow('invalid');
  });

  it('does not call an unhydrated condition buffer dirty', () => {
    expect(isScheduleConditionBufferDirty(
      { restWindowMinutes: 10, ringDelays: {}, incidentRings: {} },
      undefined,
    )).toBe(false);
  });
});
