import { describe, it, expect } from 'vitest';
import { buildRingTimeGrid, type PrintableScheduledDivision } from './schedule-print';

const div = (id: string, ring: number, startTime: string, endTime = '23:00'): PrintableScheduledDivision => ({
  divisionId: id,
  divisionName: `Division ${id}`,
  eventType: 'patterns',
  beltLevel: 'CB',
  gender: 'F',
  competitorCount: 4,
  ring,
  startTime,
  endTime,
});

describe('buildRingTimeGrid', () => {
  it('makes one row per start time, in time order, with divisions under their ring', () => {
    const grid = buildRingTimeGrid([div('c', 2, '10:00'), div('a', 1, '09:00'), div('b', 2, '09:00'), div('d', 1, '9:30')]);
    expect(grid.rings).toEqual([1, 2]);
    expect(grid.rows.map((r) => r.startTime)).toEqual(['09:00', '9:30', '10:00']);
    expect(grid.rows[0].cells[1].map((d) => d.divisionId)).toEqual(['a']);
    expect(grid.rows[0].cells[2].map((d) => d.divisionId)).toEqual(['b']);
    expect(grid.rows[2].cells[1]).toBeUndefined();
  });

  it('shows every configured ring even when one is empty', () => {
    expect(buildRingTimeGrid([div('a', 2, '09:00')], 3).rings).toEqual([1, 2, 3]);
  });

  it('handles an empty schedule', () => {
    expect(buildRingTimeGrid([])).toEqual({ rings: [], rows: [] });
  });
});
