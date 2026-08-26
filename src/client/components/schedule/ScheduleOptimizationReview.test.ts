import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import ScheduleOptimizationReview from './ScheduleOptimizationReview';

const recommendation = {
  id: 'recommendation-1', recommendationType: 'schedule_optimization_v1', status: 'proposed', confidence: 0.8,
  explanation: 'Move one division without increasing known safety conflicts.', constraintsConsidered: ['Manual locks are immutable'], warnings: ['Coach identity is unavailable.'],
  inputSnapshot: {
    optimizerInput: { restWindowMinutes: 10, blockedRings: [3], divisions: [
      { divisionId: 'locked', divisionName: 'Locked Patterns', locked: true, currentRing: 1, currentStartMinutes: 540 },
      { divisionId: 'moved', divisionName: 'Junior Sparring', locked: false, currentRing: 2, currentStartMinutes: 600 },
    ] },
    evidence: {
      capturedAt: '2026-08-09T14:48:00.000Z', athleteIdentityCoverage: { known: 8, total: 10 },
      conflictGroupCoverage: { known: 7, total: 10, coachDataAvailable: false }, durationCoverage: { known: 2, total: 2 },
      liveDelaySources: [{ ring: 2, delayMinutes: 18, source: 'director-confirmed', observedAt: '2026-08-09T14:45:00.000Z' }],
      incidentSources: [{ incidentId: 'incident-1', ring: 3, label: 'equipment (minor)', observedAt: '2026-08-09T14:46:00.000Z' }],
    },
  },
  proposedDiff: {
    moved: [{ divisionId: 'moved', divisionName: 'Junior Sparring', before: { ring: 2, startMinutes: 600 }, after: { ring: 1, startMinutes: 618 }, reason: 'Responds to the confirmed Ring 2 delay.' }],
    before: { metrics: { athleteConflicts: 2, conflictGroupConflicts: 1, ringOverlaps: 0, unavailableRingAssignments: 0, delayViolations: 1, ringLoadSpreadMinutes: 30, movedDivisions: 0, totalPenalty: 1 } },
    after: { metrics: { athleteConflicts: 0, conflictGroupConflicts: 1, ringOverlaps: 0, unavailableRingAssignments: 0, delayViolations: 0, ringLoadSpreadMinutes: 12, movedDivisions: 1, totalPenalty: 0 } },
  },
} as const;

describe('ScheduleOptimizationReview', () => {
  it('renders reviewable evidence, semantic tables, locks, and explicit lifecycle actions', () => {
    const html = renderToStaticMarkup(createElement(ScheduleOptimizationReview, { recommendation, busy: false, onApprove: () => {}, onReject: () => {}, onApply: () => {} }));
    expect(html).toContain('Evidence coverage');
    expect(html).toContain('Known school/coach groups: 7/10');
    expect(html).toContain('Deterministic means reproducible, not automatically correct');
    expect(html).toContain('<table');
    expect(html).toContain('Junior Sparring');
    expect(html).toContain('Ring 2 at 10:00');
    expect(html).toContain('Responds to the confirmed Ring 2 delay');
    expect(html).toContain('Locked Patterns');
    expect(html).toContain('Ring 2: 18 min delay');
    expect(html).toContain('equipment (minor)');
    expect(html).toContain('Approve proposal');
    expect(html).toContain('Reject proposal');
  });
});
