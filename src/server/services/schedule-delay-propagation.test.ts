import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  previewScheduleDelay,
  applyScheduleDelay,
  undoScheduleDelay,
  type ScheduleDelayInput,
} from './schedule-delay-propagation.js';
import { canonicalScheduleVersion, mergeCanonicalScheduleSettings, type CanonicalScheduleSnapshot } from './canonical-schedule.js';

// Mock Prisma client
const createMockPrisma = () => {
  const mockPrisma = {
    tournament: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    tournamentOperationAudit: {
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    recommendation: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: vi.fn(),
  } as unknown as PrismaClient;

  return mockPrisma;
};

// Helper to create a basic canonical schedule
const createBasicSchedule = (): CanonicalScheduleSnapshot => ({
  version: 1,
  rows: [
    { divisionId: 'div-1', ring: 1, startMinutes: 540, durationMinutes: 30, locked: false }, // 9:00-9:30
    { divisionId: 'div-2', ring: 1, startMinutes: 575, durationMinutes: 30, locked: false }, // 9:35-10:05
    { divisionId: 'div-3', ring: 1, startMinutes: 610, durationMinutes: 30, locked: false }, // 10:10-10:40
    { divisionId: 'div-4', ring: 2, startMinutes: 540, durationMinutes: 30, locked: false }, // 9:00-9:30
    { divisionId: 'div-5', ring: 2, startMinutes: 575, durationMinutes: 30, locked: false }, // 9:35-10:05
  ],
});

describe('schedule-delay-propagation', () => {
  let mockPrisma: PrismaClient;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    vi.clearAllMocks();
  });

  describe('previewScheduleDelay - ring delay', () => {
    it('should preview ring delay and shift all pending divisions in that ring', async () => {
      const schedule = createBasicSchedule();
      const settings = mergeCanonicalScheduleSettings(null, schedule);

      // Mock both preview and internal calculation calls
      const mockFindUnique = vi.fn()
        .mockResolvedValueOnce({
          id: 'tournament-1',
          settings,
          updatedAt: new Date('2024-01-01T00:00:00Z'),
        })
        .mockResolvedValueOnce({
          id: 'tournament-1',
          settings,
          updatedAt: new Date('2024-01-01T00:00:00Z'),
          divisions: [
            {
              id: 'div-1',
              name: 'Division 1',
              bracket: null,
              assignments: [{ registrationId: 'reg-1' }],
            },
            {
              id: 'div-2',
              name: 'Division 2',
              bracket: null,
              assignments: [{ registrationId: 'reg-2' }],
            },
            {
              id: 'div-3',
              name: 'Division 3',
              bracket: null,
              assignments: [{ registrationId: 'reg-3' }],
            },
            {
              id: 'div-4',
              name: 'Division 4',
              bracket: null,
              assignments: [{ registrationId: 'reg-4' }],
            },
            {
              id: 'div-5',
              name: 'Division 5',
              bracket: null,
              assignments: [{ registrationId: 'reg-5' }],
            },
          ],
        });

      (mockPrisma.tournament.findUnique as any) = mockFindUnique;

      const delayInput: ScheduleDelayInput = {
        tournamentId: 'tournament-1',
        delayType: 'ring',
        ringNumber: 1,
        delayMinutes: 15,
        reason: 'Equipment issue',
      };

      const preview = await previewScheduleDelay(mockPrisma, delayInput);

      expect(preview.impact.affectedDivisionIds).toHaveLength(3);
      expect(preview.impact.affectedDivisionIds).toContain('div-1');
      expect(preview.impact.affectedDivisionIds).toContain('div-2');
      expect(preview.impact.affectedDivisionIds).toContain('div-3');

      // Ring 2 divisions should not be affected
      expect(preview.impact.affectedDivisionIds).not.toContain('div-4');
      expect(preview.impact.affectedDivisionIds).not.toContain('div-5');

      // Check that times are shifted by 15 minutes (900 seconds)
      const div1After = preview.after.rows.find((r) => r.divisionId === 'div-1');
      expect(div1After?.startMinutes).toBe(540 + 15); // 9:15

      const div2After = preview.after.rows.find((r) => r.divisionId === 'div-2');
      expect(div2After?.startMinutes).toBe(575 + 15); // 9:50
    });

    it('should not affect divisions with completed matches', async () => {
      const schedule = createBasicSchedule();
      const settings = mergeCanonicalScheduleSettings(null, schedule);

      (mockPrisma.tournament.findUnique as any).mockResolvedValue({
        id: 'tournament-1',
        settings,
        updatedAt: new Date('2024-01-01T00:00:00Z'),
        divisions: [
          {
            id: 'div-1',
            name: 'Division 1',
            bracket: { matches: [{ id: 'match-1', status: 'completed' }] },
            assignments: [{ registrationId: 'reg-1' }],
          },
          {
            id: 'div-2',
            name: 'Division 2',
            bracket: null,
            assignments: [{ registrationId: 'reg-2' }],
          },
          {
            id: 'div-3',
            name: 'Division 3',
            bracket: null,
            assignments: [{ registrationId: 'reg-3' }],
          },
        ],
      });

      const delayInput: ScheduleDelayInput = {
        tournamentId: 'tournament-1',
        delayType: 'ring',
        ringNumber: 1,
        delayMinutes: 15,
        reason: 'Test',
      };

      const preview = await previewScheduleDelay(mockPrisma, delayInput);

      // div-1 has completed matches, so only div-2 and div-3 should be affected
      expect(preview.impact.affectedDivisionIds).toHaveLength(2);
      expect(preview.impact.affectedDivisionIds).not.toContain('div-1');
      expect(preview.impact.affectedDivisionIds).toContain('div-2');
      expect(preview.impact.affectedDivisionIds).toContain('div-3');
    });

    it('should detect end-of-day overruns', async () => {
      const schedule: CanonicalScheduleSnapshot = {
        version: 1,
        rows: [
          { divisionId: 'div-1', ring: 1, startMinutes: 1000, durationMinutes: 30, locked: false }, // 16:40-17:10
        ],
      };
      const settings = JSON.stringify({
        canonicalSchedule: schedule,
        schedule: { endTime: '17:00' },
      });

      (mockPrisma.tournament.findUnique as any).mockResolvedValue({
        id: 'tournament-1',
        settings,
        updatedAt: new Date('2024-01-01T00:00:00Z'),
        divisions: [
          {
            id: 'div-1',
            name: 'Division 1',
            bracket: null,
            assignments: [{ registrationId: 'reg-1' }],
          },
        ],
      });

      const delayInput: ScheduleDelayInput = {
        tournamentId: 'tournament-1',
        delayType: 'ring',
        ringNumber: 1,
        delayMinutes: 30,
        reason: 'Test',
      };

      const preview = await previewScheduleDelay(mockPrisma, delayInput);

      expect(preview.impact.endTimeOverruns).toHaveLength(1);
      expect(preview.impact.warnings).toContain(
        '1 division(s) extend past tournament end time after delay.'
      );
    });
  });

  describe('previewScheduleDelay - division delay', () => {
    it('should preview division-specific delay', async () => {
      const schedule = createBasicSchedule();
      const settings = mergeCanonicalScheduleSettings(null, schedule);

      (mockPrisma.tournament.findUnique as any).mockResolvedValue({
        id: 'tournament-1',
        settings,
        updatedAt: new Date('2024-01-01T00:00:00Z'),
        divisions: [
          {
            id: 'div-1',
            name: 'Division 1',
            bracket: null,
            assignments: [{ registrationId: 'reg-1' }],
          },
          {
            id: 'div-2',
            name: 'Division 2',
            bracket: null,
            assignments: [{ registrationId: 'reg-2' }],
          },
          {
            id: 'div-3',
            name: 'Division 3',
            bracket: null,
            assignments: [{ registrationId: 'reg-3' }],
          },
        ],
      });

      const delayInput: ScheduleDelayInput = {
        tournamentId: 'tournament-1',
        delayType: 'division',
        divisionId: 'div-2',
        delayMinutes: 20,
        reason: 'Longer matches than expected',
      };

      const preview = await previewScheduleDelay(mockPrisma, delayInput);

      // Only div-2 and div-3 (downstream in same ring) should be affected
      expect(preview.impact.affectedDivisionIds).toHaveLength(2);
      expect(preview.impact.affectedDivisionIds).toContain('div-2');
      expect(preview.impact.affectedDivisionIds).toContain('div-3');
      expect(preview.impact.affectedDivisionIds).not.toContain('div-1');
    });
  });

  describe('previewScheduleDelay - conflict detection', () => {
    it('should detect athlete double-booking conflicts', async () => {
      const schedule: CanonicalScheduleSnapshot = {
        version: 1,
        rows: [
          { divisionId: 'div-1', ring: 1, startMinutes: 540, durationMinutes: 30, locked: false }, // 9:00-9:30
          { divisionId: 'div-2', ring: 2, startMinutes: 550, durationMinutes: 30, locked: false }, // 9:10-9:40
        ],
      };
      const settings = mergeCanonicalScheduleSettings(null, schedule);

      (mockPrisma.tournament.findUnique as any).mockResolvedValue({
        id: 'tournament-1',
        settings,
        updatedAt: new Date('2024-01-01T00:00:00Z'),
        divisions: [
          {
            id: 'div-1',
            name: 'Division 1',
            bracket: null,
            assignments: [{ registrationId: 'reg-1' }], // Athlete reg-1 in div-1
          },
          {
            id: 'div-2',
            name: 'Division 2',
            bracket: null,
            assignments: [{ registrationId: 'reg-1' }], // Same athlete reg-1 in div-2
          },
        ],
      });

      const delayInput: ScheduleDelayInput = {
        tournamentId: 'tournament-1',
        delayType: 'ring',
        ringNumber: 1,
        delayMinutes: 15,
        reason: 'Test',
      };

      const preview = await previewScheduleDelay(mockPrisma, delayInput);

      // After delaying Ring 1 by 15 minutes, div-1 moves to 9:15-9:45, overlapping with div-2 (9:10-9:40)
      expect(preview.impact.conflicts.length).toBeGreaterThan(0);
      expect(preview.impact.conflicts[0].type).toBe('athlete_conflict');
    });
  });

  describe('previewScheduleDelay - multi-ring independence', () => {
    it('should only affect the target ring', async () => {
      const schedule = createBasicSchedule();
      const settings = mergeCanonicalScheduleSettings(null, schedule);

      (mockPrisma.tournament.findUnique as any).mockResolvedValue({
        id: 'tournament-1',
        settings,
        updatedAt: new Date('2024-01-01T00:00:00Z'),
        divisions: schedule.rows.map((row) => ({
          id: row.divisionId,
          name: `Division ${row.divisionId}`,
          bracket: null,
          assignments: [{ registrationId: `reg-${row.divisionId}` }],
        })),
      });

      const delayInput: ScheduleDelayInput = {
        tournamentId: 'tournament-1',
        delayType: 'ring',
        ringNumber: 2,
        delayMinutes: 25,
        reason: 'Ring 2 only delay',
      };

      const preview = await previewScheduleDelay(mockPrisma, delayInput);

      // Only ring 2 divisions should be affected
      expect(preview.impact.affectedDivisionIds).toContain('div-4');
      expect(preview.impact.affectedDivisionIds).toContain('div-5');
      expect(preview.impact.affectedDivisionIds).not.toContain('div-1');
      expect(preview.impact.affectedDivisionIds).not.toContain('div-2');
      expect(preview.impact.affectedDivisionIds).not.toContain('div-3');
    });
  });

  describe('previewScheduleDelay - locks and same-ring overlaps', () => {
    const mockTournament = (schedule: CanonicalScheduleSnapshot, divisions: Array<{ id: string; matches?: unknown[] }>) => {
      (mockPrisma.tournament.findUnique as any).mockResolvedValue({
        id: 'tournament-1',
        settings: mergeCanonicalScheduleSettings(null, schedule),
        updatedAt: new Date('2024-01-01T00:00:00Z'),
        divisions: divisions.map((division) => ({
          id: division.id,
          name: `Division ${division.id}`,
          bracket: division.matches ? { matches: division.matches } : null,
          assignments: [{ registrationId: `reg-${division.id}` }],
        })),
      });
    };
    const ringDelay = (delayMinutes: number): ScheduleDelayInput => ({
      tournamentId: 'tournament-1', delayType: 'ring', ringNumber: 1, delayMinutes, reason: 'Test',
    });
    const autoBye = { id: 'bye', status: 'completed', notes: 'BYE', competitor1Id: 'reg-x', competitor2Id: null };
    const realResult = { id: 'real', status: 'completed', notes: null, competitor1Id: 'reg-x', competitor2Id: 'reg-y' };

    it('does not treat auto-completed BYE matches as a started division', async () => {
      mockTournament(createBasicSchedule(), [
        { id: 'div-1', matches: [autoBye] },
        { id: 'div-2', matches: [autoBye] },
        { id: 'div-3' },
      ]);

      const preview = await previewScheduleDelay(mockPrisma, ringDelay(15));

      expect(preview.impact.affectedDivisionIds).toEqual(['div-1', 'div-2', 'div-3']);
    });

    it('rejects a delay that would run a division into a later division with real results', async () => {
      // div-1 9:00-9:30 pending, div-2 9:35-10:05 already running.
      mockTournament(
        { version: 1, rows: [
          { divisionId: 'div-1', ring: 1, startMinutes: 540, durationMinutes: 30, locked: false },
          { divisionId: 'div-2', ring: 1, startMinutes: 575, durationMinutes: 30, locked: false },
        ] },
        [{ id: 'div-1', matches: [autoBye] }, { id: 'div-2', matches: [realResult] }],
      );

      await expect(previewScheduleDelay(mockPrisma, ringDelay(15)))
        .rejects.toThrow(/Division div-2 on Ring 1 has recorded results or a match in progress/);
    });

    it('cascades a shifted division that lands inside a locked one to after it', async () => {
      // div-1 9:00-9:30 pending; div-2 9:30-10:00 locked (running);
      // div-3 10:00-11:00 pending. A 40-minute delay moves div-1 to
      // 9:40, inside div-2, so div-1 is pushed to 10:00; div-3 keeps
      // its 40-minute shift (10:40) and does not overlap div-1.
      mockTournament(
        { version: 1, rows: [
          { divisionId: 'div-1', ring: 1, startMinutes: 540, durationMinutes: 30, locked: false },
          { divisionId: 'div-2', ring: 1, startMinutes: 570, durationMinutes: 30, locked: false },
          { divisionId: 'div-3', ring: 1, startMinutes: 600, durationMinutes: 60, locked: false },
        ] },
        [{ id: 'div-1' }, { id: 'div-2', matches: [realResult] }, { id: 'div-3' }],
      );

      const preview = await previewScheduleDelay(mockPrisma, ringDelay(40));
      const start = (id: string) => preview.after.rows.find((row) => row.divisionId === id)?.startMinutes;

      expect(start('div-2')).toBe(570);
      expect(start('div-1')).toBe(600);
      expect(start('div-3')).toBe(640);
      // No two divisions on the ring overlap afterwards.
      const ring = [...preview.after.rows].sort((a, b) => a.startMinutes - b.startMinutes);
      for (let i = 1; i < ring.length; i++) {
        expect(ring[i].startMinutes).toBeGreaterThanOrEqual(ring[i - 1].startMinutes + ring[i - 1].durationMinutes);
      }
      // The before snapshot is untouched.
      expect(preview.before.rows.map((row) => row.startMinutes)).toEqual([540, 570, 600]);
      expect(preview.impact.divisionMoves.find((move) => move.divisionId === 'div-1')?.newStartTime).toBe('10:00');
    });
  });

  describe('applyScheduleDelay', () => {
    it('should apply delay with proper audit trail', async () => {
      const schedule = createBasicSchedule();
      const settings = mergeCanonicalScheduleSettings(null, schedule);
      const updatedAt = new Date('2024-01-01T00:00:00Z');

      const mockTransaction = vi.fn(async (callback: any) => {
        const tx = {
          ...mockPrisma,
          tournamentOperationAudit: {
            findUnique: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
          },
          tournament: {
            findUnique: vi.fn().mockResolvedValue({
              id: 'tournament-1',
              settings,
              updatedAt,
              divisions: [
                {
                  id: 'div-1',
                  name: 'Division 1',
                  bracket: null,
                  assignments: [{ registrationId: 'reg-1' }],
                },
              ],
            }),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
        };
        return callback(tx);
      });

      (mockPrisma.$transaction as any) = mockTransaction;

      const delayInput: ScheduleDelayInput = {
        tournamentId: 'tournament-1',
        delayType: 'ring',
        ringNumber: 1,
        delayMinutes: 15,
        reason: 'Test',
      };

      const result = await applyScheduleDelay(mockPrisma, {
        tournamentId: 'tournament-1',
        delayInput,
        expectedUpdatedAt: updatedAt.toISOString(),
        expectedInputVersion: canonicalScheduleVersion(schedule),
        operationKey: 'op-123',
        approvedBy: 'user-1',
      });

      expect(result.auditId).toBe('audit-1');
      expect(mockTransaction).toHaveBeenCalled();
    });

    it('should reject stale preview', async () => {
      const schedule = createBasicSchedule();
      const settings = mergeCanonicalScheduleSettings(null, schedule);
      const oldUpdatedAt = new Date('2024-01-01T00:00:00Z');
      const newUpdatedAt = new Date('2024-01-01T01:00:00Z');

      const mockTransaction = vi.fn(async (callback: any) => {
        const tx = {
          ...mockPrisma,
          tournamentOperationAudit: {
            findUnique: vi.fn().mockResolvedValue(null),
          },
          tournament: {
            findUnique: vi.fn().mockResolvedValue({
              id: 'tournament-1',
              settings,
              updatedAt: newUpdatedAt, // Different from expected
              divisions: [],
            }),
          },
        };
        return callback(tx);
      });

      (mockPrisma.$transaction as any) = mockTransaction;

      const delayInput: ScheduleDelayInput = {
        tournamentId: 'tournament-1',
        delayType: 'ring',
        ringNumber: 1,
        delayMinutes: 15,
        reason: 'Test',
      };

      await expect(
        applyScheduleDelay(mockPrisma, {
          tournamentId: 'tournament-1',
          delayInput,
          expectedUpdatedAt: oldUpdatedAt.toISOString(),
          expectedInputVersion: 'test-version',
          operationKey: 'op-123',
          approvedBy: 'user-1',
        })
      ).rejects.toThrow('changed since preview');
    });
  });

  describe('undoScheduleDelay', () => {
    it('should undo a delay propagation', async () => {
      const beforeSettings = 'before-settings';
      const afterSettings = 'after-settings';

      const mockTransaction = vi.fn(async (callback: any) => {
        const tx = {
          ...mockPrisma,
          tournamentOperationAudit: {
            findUnique: vi.fn().mockResolvedValue({
              id: 'audit-1',
              operationType: 'schedule_delay_propagation',
              reversible: true,
              tournamentId: 'tournament-1',
              beforeState: beforeSettings,
              afterState: afterSettings,
              undoneAt: null,
            }),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          tournament: {
            findUnique: vi.fn().mockResolvedValue({
              id: 'tournament-1',
              settings: afterSettings,
            }),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
        };
        return callback(tx);
      });

      (mockPrisma.$transaction as any) = mockTransaction;

      await undoScheduleDelay(
        mockPrisma,
        'audit-1',
        'user-1',
        new Date(),
        'tournament-1'
      );

      expect(mockTransaction).toHaveBeenCalled();
    });

    it('should reject undo if schedule changed after delay', async () => {
      const mockTransaction = vi.fn(async (callback: any) => {
        const tx = {
          ...mockPrisma,
          tournamentOperationAudit: {
            findUnique: vi.fn().mockResolvedValue({
              id: 'audit-1',
              operationType: 'schedule_delay_propagation',
              reversible: true,
              tournamentId: 'tournament-1',
              afterState: 'after-settings',
              undoneAt: null,
            }),
          },
          tournament: {
            findUnique: vi.fn().mockResolvedValue({
              id: 'tournament-1',
              settings: 'different-settings', // Changed!
            }),
          },
        };
        return callback(tx);
      });

      (mockPrisma.$transaction as any) = mockTransaction;

      await expect(
        undoScheduleDelay(mockPrisma, 'audit-1', 'user-1', new Date(), 'tournament-1')
      ).rejects.toThrow('Schedule changed after this delay');
    });
  });
});
