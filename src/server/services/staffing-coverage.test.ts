import { describe, expect, it } from 'vitest';
import { computeCoverage, fromMinutes, isValidTime, toMinutes, type CoverageAssignment } from './staffing-coverage.js';

const assignment = (overrides: Partial<CoverageAssignment>): CoverageAssignment => ({
  id: overrides.id ?? `a-${Math.random()}`,
  userId: 'u-1',
  duty: 'scorekeeper',
  ringNumber: 1,
  startTime: '08:00',
  endTime: '17:00',
  ...overrides,
});

describe('time helpers', () => {
  it('parses and formats HH:MM', () => {
    expect(toMinutes('08:30')).toBe(510);
    expect(fromMinutes(510)).toBe('08:30');
    expect(isValidTime('23:59')).toBe(true);
    expect(isValidTime('24:00')).toBe(false);
    expect(isValidTime('8:30')).toBe(false);
    expect(() => toMinutes('nope')).toThrow();
  });
});

describe('computeCoverage gaps', () => {
  const window = { windowStart: '08:00', windowEnd: '17:00' };

  it('reports every ring as a gap when nobody is assigned', () => {
    const report = computeCoverage({ ...window, ringCount: 2, assignments: [] });
    expect(report.gaps).toEqual([
      { ringNumber: 1, duty: 'scorekeeper', startTime: '08:00', endTime: '17:00' },
      { ringNumber: 2, duty: 'scorekeeper', startTime: '08:00', endTime: '17:00' },
    ]);
    expect(report.staffedRings).toBe(0);
  });

  it('treats a ring as staffed when shifts cover the window end to end', () => {
    const report = computeCoverage({
      ...window,
      ringCount: 1,
      assignments: [
        assignment({ userId: 'u-1', startTime: '08:00', endTime: '12:00' }),
        assignment({ userId: 'u-2', startTime: '12:00', endTime: '17:00' }),
      ],
    });
    expect(report.gaps).toEqual([]);
    expect(report.staffedRings).toBe(1);
  });

  it('reports the uncovered middle of a split shift and ignores time outside the window', () => {
    const report = computeCoverage({
      ...window,
      ringCount: 1,
      assignments: [
        assignment({ userId: 'u-1', startTime: '07:00', endTime: '11:00' }),
        assignment({ userId: 'u-2', startTime: '13:30', endTime: '18:00' }),
      ],
    });
    expect(report.gaps).toEqual([{ ringNumber: 1, duty: 'scorekeeper', startTime: '11:00', endTime: '13:30' }]);
  });

  it('does not count other duties, other rings or venue-wide assignments toward ring coverage', () => {
    const report = computeCoverage({
      ...window,
      ringCount: 1,
      assignments: [
        assignment({ duty: 'runner' }),
        assignment({ ringNumber: 2 }),
        assignment({ ringNumber: null, duty: 'check_in' }),
      ],
    });
    expect(report.gaps).toHaveLength(1);
    expect(report.staffedRings).toBe(0);
  });
});

describe('computeCoverage conflicts', () => {
  const window = { windowStart: '08:00', windowEnd: '17:00', ringCount: 2 };

  it('flags one person booked on two rings at the same time with the overlap', () => {
    const report = computeCoverage({
      ...window,
      assignments: [
        assignment({ id: 'a', userId: 'u-1', ringNumber: 1, startTime: '08:00', endTime: '12:00' }),
        assignment({ id: 'b', userId: 'u-1', ringNumber: 2, startTime: '11:00', endTime: '15:00' }),
      ],
    });
    expect(report.conflicts).toEqual([
      { userId: 'u-1', assignmentIds: ['a', 'b'], startTime: '11:00', endTime: '12:00' },
    ]);
  });

  it('allows back-to-back shifts and different people at the same time', () => {
    const report = computeCoverage({
      ...window,
      assignments: [
        assignment({ id: 'a', userId: 'u-1', startTime: '08:00', endTime: '12:00' }),
        assignment({ id: 'b', userId: 'u-1', ringNumber: 2, startTime: '12:00', endTime: '15:00' }),
        assignment({ id: 'c', userId: 'u-2', startTime: '08:00', endTime: '12:00' }),
      ],
    });
    expect(report.conflicts).toEqual([]);
  });
});
