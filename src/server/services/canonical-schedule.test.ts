import { describe, expect, it } from 'vitest';
import {
  applyCanonicalSchedule,
  assertCanonicalLocksPreserved,
  canonicalScheduleVersion,
  mergeCanonicalScheduleSettings,
  materializeCanonicalTournamentSchedule,
  readCanonicalSchedule,
  type CanonicalScheduleSnapshot,
} from './canonical-schedule.js';

const snapshot = (overrides: Partial<CanonicalScheduleSnapshot> = {}): CanonicalScheduleSnapshot => ({
  version: 1,
  rows: [
    { divisionId: 'division-b', ring: 2, startMinutes: 600, durationMinutes: 20, locked: false },
    { divisionId: 'division-a', ring: 1, startMinutes: 540, durationMinutes: 30, locked: true },
  ],
  ...overrides,
});

const generated = [
  {
    divisionId: 'division-a', divisionName: 'A', eventType: 'patterns', beltLevel: 'CB', gender: 'F',
    competitorCount: 4, competitorNames: ['Amina'], ring: 1, startTime: '09:00', endTime: '09:30', estimatedDurationMinutes: 30,
  },
  {
    divisionId: 'division-b', divisionName: 'B', eventType: 'sparring', beltLevel: 'CB', gender: 'M',
    competitorCount: 3, competitorNames: ['Minho'], ring: 1, startTime: '09:30', endTime: '09:50', estimatedDurationMinutes: 20,
  },
];

describe('canonical schedule persistence', () => {
  it('round-trips a sorted versioned snapshot while preserving unrelated settings', () => {
    const raw = mergeCanonicalScheduleSettings(JSON.stringify({ theme: 'dark', schedule: { ringCount: 2 } }), snapshot());
    const settings = JSON.parse(raw);

    expect(settings.theme).toBe('dark');
    expect(settings.schedule).toEqual({ ringCount: 2 });
    expect(settings.canonicalSchedule.rows.map((row: { divisionId: string }) => row.divisionId)).toEqual(['division-a', 'division-b']);
    expect(readCanonicalSchedule(raw)).toEqual(snapshot({ rows: [snapshot().rows[1], snapshot().rows[0]] }));
  });

  it('produces the same version for semantically identical row order', () => {
    expect(canonicalScheduleVersion(snapshot())).toBe(canonicalScheduleVersion(snapshot({
      rows: [snapshot().rows[1], snapshot().rows[0]],
    })));
  });

  it('replays the exact persisted ring and time while preserving generated labels and competitors', () => {
    const result = applyCanonicalSchedule(generated, snapshot());

    expect(result[0]).toEqual(expect.objectContaining({
      divisionId: 'division-a', divisionName: 'A', competitorNames: ['Amina'],
      ring: 1, startTime: '09:00', endTime: '09:30', estimatedDurationMinutes: 30, locked: true,
    }));
    expect(result[1]).toEqual(expect.objectContaining({
      divisionId: 'division-b', divisionName: 'B', competitorNames: ['Minho'],
      ring: 2, startTime: '10:00', endTime: '10:20', estimatedDurationMinutes: 20, locked: false,
    }));
  });

  it('materializes the persisted snapshot as the tournament schedule source of truth', () => {
    const tournamentSchedule = {
      tournamentId: 'tournament-1', tournamentName: 'Open', date: '2027-01-01T00:00:00.000Z',
      config: { startTime: '09:00', endTime: '17:00', ringCount: 2, matchDurationMinutes: { patterns: 3, sparring: 5 }, breakBetweenDivisions: 5 },
      schedule: generated, warnings: ['Existing warning'],
    };
    const raw = mergeCanonicalScheduleSettings(null, snapshot());

    const result = materializeCanonicalTournamentSchedule(tournamentSchedule, raw);

    expect(result.schedule.find((row) => row.divisionId === 'division-b')).toMatchObject({ ring: 2, startTime: '10:00' });
    expect(result.warnings).toEqual(['Existing warning']);
    expect(result.canonicalScheduleVersion).toBe(canonicalScheduleVersion(snapshot()));
  });

  it('fails closed when coverage or duration does not match', () => {
    expect(() => applyCanonicalSchedule(generated, snapshot({ rows: [snapshot().rows[0]] }))).toThrow('coverage');
    expect(() => applyCanonicalSchedule(generated, snapshot({
      rows: [...snapshot().rows, { ...snapshot().rows[0], divisionId: 'division-c' }],
    }))).toThrow('coverage');
    expect(() => applyCanonicalSchedule(generated, snapshot({
      rows: snapshot().rows.map((row) => row.divisionId === 'division-b' ? { ...row, durationMinutes: 21 } : row),
    }))).toThrow('duration');
  });

  it('compares locks to the immediate canonical before-state, including previously optimized slots', () => {
    const before = snapshot({
      rows: snapshot().rows.map((row) => row.divisionId === 'division-a'
        ? { ...row, ring: 2, startMinutes: 660 }
        : row),
    });
    expect(() => assertCanonicalLocksPreserved(before, before)).not.toThrow();
    expect(() => assertCanonicalLocksPreserved(before, snapshot({
      rows: before.rows.map((row) => row.divisionId === 'division-a' ? { ...row, startMinutes: 670 } : row),
    }))).toThrow('locked');
  });

  it('rejects malformed stored JSON instead of silently treating it as an empty schedule', () => {
    expect(() => readCanonicalSchedule('{broken')).toThrow('repair');
    expect(() => readCanonicalSchedule(JSON.stringify({ canonicalSchedule: { version: 2, rows: [] } }))).toThrow('version');
  });
});
