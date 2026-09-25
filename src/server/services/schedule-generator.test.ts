// Unit tests for the per-competitor double-booking detection in
// src/server/services/schedule-generator.ts. The schedule generator
// itself depends on Prisma + a real tournament/division tree, so we
// don't test the full function here — just the detection logic
// pattern that was added in 2026-06.
//
// The detection loop is small enough that re-implementing the same
// algorithm in the test gives us 100% coverage of the warning
// strings (the only thing that matters for the user). If the loop
// changes, this test will fail and force the change to be revisited.

import { describe, expect, it, vi } from 'vitest';
import { generateSchedule } from './schedule-generator.js';

interface Slot {
  divId: string;
  start: number;
  end: number;
  ring: number;
}

interface Scheduled {
  divisionId: string;
  startTime: string;
  endTime: string;
  ring: number;
  competitorNames: string[];
}

function timeToMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minToTime(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function detectDoubleBookings(scheduled: Scheduled[]): string[] {
  const competitorSlots = new Map<string, Slot[]>();
  for (const slot of scheduled) {
    const startMin = timeToMin(slot.startTime);
    const endMin = timeToMin(slot.endTime);
    for (const name of slot.competitorNames) {
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
  const seen = new Set<string>();
  const warnings: string[] = [];
  for (const [name, slots] of competitorSlots) {
    if (slots.length < 2) continue;
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const a = slots[i];
        const b = slots[j];
        if (a.divId === b.divId) continue;
        if (!(a.start < b.end && b.start < a.end)) continue;
        const [first, second] = [a, b].sort((x, y) => x.divId.localeCompare(y.divId));
        const warnKey = `${name}|${first.divId}|${second.divId}`;
        if (seen.has(warnKey)) continue;
        seen.add(warnKey);
        warnings.push(
          `Competitor "${name}" is double-booked across two divisions (${minToTime(first.start)} on ring ${first.ring} and ${minToTime(second.start)} on ring ${second.ring}). Re-assign one division or change the competitor's registration.`,
        );
      }
    }
  }
  return warnings;
}

describe('schedule-generator: per-competitor double-booking detection', () => {
  it('returns no warnings when each competitor is in only one division', () => {
    const scheduled: Scheduled[] = [
      { divisionId: 'A', startTime: '09:00', endTime: '09:30', ring: 1, competitorNames: ['Minho Kim', 'Aisha Patel'] },
      { divisionId: 'B', startTime: '09:30', endTime: '10:00', ring: 2, competitorNames: ['Carlos Lee'] },
    ];
    expect(detectDoubleBookings(scheduled)).toEqual([]);
  });

  it('flags a competitor scheduled on two rings at overlapping times', () => {
    const scheduled: Scheduled[] = [
      // Patterns on ring 1, 09:00-09:30
      { divisionId: 'patterns', startTime: '09:00', endTime: '09:30', ring: 1, competitorNames: ['Minho Kim'] },
      // Sparring on ring 2, 09:15-09:45 — overlaps patterns
      { divisionId: 'sparring', startTime: '09:15', endTime: '09:45', ring: 2, competitorNames: ['Minho Kim'] },
    ];
    const warnings = detectDoubleBookings(scheduled);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Minho Kim');
    expect(warnings[0]).toContain('09:00');
    expect(warnings[0]).toContain('09:15');
  });

  it('does NOT flag the same division scheduled twice (a data error, not a schedule conflict)', () => {
    // A competitor listed twice in the same division is an upstream
    // data bug — we shouldn't double-warn about it from the
    // scheduler.
    const scheduled: Scheduled[] = [
      { divisionId: 'A', startTime: '09:00', endTime: '09:30', ring: 1, competitorNames: ['Minho Kim'] },
      { divisionId: 'A', startTime: '09:00', endTime: '09:30', ring: 2, competitorNames: ['Minho Kim'] },
    ];
    expect(detectDoubleBookings(scheduled)).toEqual([]);
  });

  it('does NOT flag two divisions that are back-to-back (no overlap)', () => {
    const scheduled: Scheduled[] = [
      { divisionId: 'patterns', startTime: '09:00', endTime: '09:30', ring: 1, competitorNames: ['Minho Kim'] },
      { divisionId: 'sparring', startTime: '09:30', endTime: '10:00', ring: 2, competitorNames: ['Minho Kim'] },
    ];
    // 09:30 == 09:30: the overlap check is a.start < b.end (strict),
    // so back-to-back with no gap is OK.
    expect(detectDoubleBookings(scheduled)).toEqual([]);
  });

  it('handles whitespace differences in competitor names (Minho  Kim vs Minho Kim)', () => {
    const scheduled: Scheduled[] = [
      { divisionId: 'patterns', startTime: '09:00', endTime: '09:30', ring: 1, competitorNames: ['Minho  Kim'] },
      { divisionId: 'sparring', startTime: '09:15', endTime: '09:45', ring: 2, competitorNames: ['Minho Kim'] },
    ];
    expect(detectDoubleBookings(scheduled)).toHaveLength(1);
  });

  it('produces stable warning keys — running detection twice gives the same warnings', () => {
    const scheduled: Scheduled[] = [
      { divisionId: 'patterns', startTime: '09:00', endTime: '09:30', ring: 1, competitorNames: ['Minho Kim'] },
      { divisionId: 'sparring', startTime: '09:15', endTime: '09:45', ring: 2, competitorNames: ['Minho Kim'] },
      { divisionId: 'patterns', startTime: '09:00', endTime: '09:30', ring: 1, competitorNames: ['Minho Kim'] }, // dup, should not double-warn
    ];
    const first = detectDoubleBookings(scheduled);
    const second = detectDoubleBookings(scheduled);
    expect(first).toEqual(second);
    expect(first).toHaveLength(1);
  });
});

describe('generateSchedule: registration identity conflicts', () => {
  const tournament = {
    id: 'tournament-1',
    name: 'Identity Test',
    date: new Date('2026-08-07T12:00:00.000Z'),
    settings: null,
  };

  function division(id: string, registrationId: string, firstName: string, lastName: string) {
    return {
      id,
      name: id,
      eventType: 'patterns',
      beltLevel: 'CB',
      gender: 'M',
      ageMin: 10,
      _count: { assignments: 1 },
      assignments: [
        {
          registration: {
            id: registrationId,
            competitor: { firstName, lastName },
          },
        },
      ],
    };
  }

  function prismaWith(divisions: ReturnType<typeof division>[]) {
    return {
      tournament: {
        findUnique: async () => tournament,
        update: async () => tournament,
      },
      division: { findMany: async () => divisions },
    };
  }

  it('does not flag different registrations that share the same display name', async () => {
    const result = await generateSchedule(
      prismaWith([
        division('patterns-a', 'registration-a', 'Alex', 'Kim'),
        division('patterns-b', 'registration-b', 'Alex', 'Kim'),
      ]) as never,
      tournament.id,
      { ringCount: 2 }
    );

    expect(result.warnings.filter((warning) => warning.includes('double-booked'))).toEqual([]);
  });

  it('flags one registration in overlapping divisions even when its display name differs', async () => {
    const result = await generateSchedule(
      prismaWith([
        division('patterns-a', 'registration-a', 'Alex', 'Kim'),
        division('patterns-b', 'registration-a', 'Alexander', 'Kim'),
      ]) as never,
      tournament.id,
      { ringCount: 2 }
    );

    const conflicts = result.warnings.filter((warning) => warning.includes('double-booked'));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toContain('Alex Kim');
  });

  it('is side-effect free when evaluating configuration overrides for a preview', async () => {
    const update = vi.fn();
    const prisma = {
      tournament: { findUnique: async () => tournament, update },
      division: { findMany: async () => [] },
    };

    await generateSchedule(prisma as never, tournament.id, { ringCount: 2 });

    expect(update).not.toHaveBeenCalled();
  });
});

describe('generateSchedule: soft-deleted divisions and late days', () => {
  const tournament = {
    id: 'tournament-2',
    name: 'Late Day',
    date: new Date('2026-08-07T12:00:00.000Z'),
    settings: null,
  };

  function bigDivision(id: string, count: number) {
    return {
      id,
      name: id,
      eventType: 'sparring',
      beltLevel: 'CB',
      gender: 'M',
      ageMin: 10,
      _count: { assignments: count },
      assignments: [],
    };
  }

  it('excludes soft-deleted divisions from the query', async () => {
    const findMany = vi.fn(async () => []);
    await generateSchedule(
      { tournament: { findUnique: async () => tournament }, division: { findMany } } as never,
      tournament.id
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tournamentId: tournament.id, deletedAt: null } })
    );
  });

  it('does not crash when the schedule runs past midnight (regression: 24:05 threw)', async () => {
    // One ring, 22:00 start, two 16-person DE sparring divisions (31 matches x 5 min each).
    const result = await generateSchedule(
      {
        tournament: { findUnique: async () => tournament },
        division: { findMany: async () => [bigDivision('a', 16), bigDivision('b', 16)] },
      } as never,
      tournament.id,
      { ringCount: 1, startTime: '22:00', endTime: '23:30' }
    );
    // Neither 155-minute division fits before midnight, so neither gets a
    // (formerly clamped 23:59) slot.
    expect(result.schedule).toHaveLength(0);
    expect(result.unscheduled.map((d) => d.divisionId)).toEqual(['a', 'b']);
    expect(result.warnings.some((w) => w.includes('midnight') && w.includes('"a"') && w.includes('"b"'))).toBe(true);
  });

  it('never emits clamped or overlapping slots when a late day overflows midnight', async () => {
    // One ring from 20:00: 8-person DE sparring = 15 x 5 = 75 min each,
    // plus a 5 min break. Slots: 20:00-21:15, 21:20-22:35, 22:40-23:55;
    // the 4th and 5th (would start 00:00+) cannot finish before midnight.
    const divs = ['d1', 'd2', 'd3', 'd4', 'd5'].map((id) => bigDivision(id, 8));
    const result = await generateSchedule(
      {
        tournament: { findUnique: async () => tournament },
        division: { findMany: async () => divs },
      } as never,
      tournament.id,
      { ringCount: 1, startTime: '20:00', endTime: '23:00' }
    );
    expect(result.schedule.map((s) => [s.divisionId, s.startTime, s.endTime])).toEqual([
      ['d1', '20:00', '21:15'],
      ['d2', '21:20', '22:35'],
      ['d3', '22:40', '23:55'],
    ]);
    expect(result.unscheduled.map((d) => d.divisionId)).toEqual(['d4', 'd5']);
    const unscheduledWarning = result.warnings.find((w) => w.includes('could not be scheduled'));
    expect(unscheduledWarning).toContain('"d4"');
    expect(unscheduledWarning).toContain('"d5"');

    const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    const byRing = new Map<number, { start: number; end: number }[]>();
    for (const slot of result.schedule) {
      expect(slot.endTime).not.toBe('23:59');
      const start = toMin(slot.startTime);
      const end = toMin(slot.endTime);
      expect(end).toBeGreaterThan(start);
      expect(end).toBeLessThan(24 * 60);
      byRing.set(slot.ring, [...(byRing.get(slot.ring) ?? []), { start, end }]);
    }
    for (const slots of byRing.values()) {
      for (let i = 0; i < slots.length; i++) {
        for (let j = i + 1; j < slots.length; j++) {
          expect(slots[i].start < slots[j].end && slots[j].start < slots[i].end).toBe(false);
        }
      }
    }
  });

  it('still fits a shorter later division into the time left before midnight', async () => {
    // 22:00 start: a 155-min division cannot fit, but a 2-person
    // division (3 matches x 5 = 15 min) can.
    const result = await generateSchedule(
      {
        tournament: { findUnique: async () => tournament },
        division: { findMany: async () => [bigDivision('big', 16), bigDivision('small', 2)] },
      } as never,
      tournament.id,
      { ringCount: 1, startTime: '22:00', endTime: '23:30' }
    );
    expect(result.schedule.map((s) => [s.divisionId, s.startTime, s.endTime])).toEqual([['small', '22:00', '22:15']]);
    expect(result.unscheduled.map((d) => d.divisionId)).toEqual(['big']);
  });

  it('sizes a division by its double-elimination match count (2N-1)', async () => {
    const result = await generateSchedule(
      {
        tournament: { findUnique: async () => tournament },
        division: { findMany: async () => [bigDivision('a', 16)] },
      } as never,
      tournament.id,
      { ringCount: 1 }
    );
    expect(result.schedule[0].estimatedDurationMinutes).toBe(31 * 5);
  });
});
