import { describe, expect, it, vi } from 'vitest';
import { mergeGeneralSettings, mergeRulesSettings, mergeSetupSettings, saveTournamentSettingsAtomic, stripReservedOperationSettings, stripReservedOperationSettingsFromRaw } from './tournament-settings.js';

describe('saveTournamentSettingsAtomic', () => {
  it('keeps rule and setup namespaces from overwriting one another', () => {
    const current = JSON.stringify({ rings: { count: 2 }, version: 1, events: { patterns: { format: 'single_elim' } }, canonicalSchedule: { version: 1 }, scheduleOperations: { restWindowMinutes: 10 } });
    expect(mergeSetupSettings(current, { rings: { count: 4 }, version: 99, events: { patterns: { format: 'stale' } }, canonicalSchedule: { injected: true }, scheduleOperations: { injected: true } })).toEqual({
      rings: { count: 4 }, version: 1, events: { patterns: { format: 'single_elim' } }, canonicalSchedule: { version: 1 }, scheduleOperations: { restWindowMinutes: 10 },
    });
    expect(mergeRulesSettings(current, { rings: { count: 99 }, version: 2, events: { patterns: { format: 'double_elim' } }, canonicalSchedule: { injected: true } })).toEqual({
      rings: { count: 2 }, version: 2, events: { patterns: { format: 'double_elim' } }, canonicalSchedule: { version: 1 }, scheduleOperations: { restWindowMinutes: 10 },
    });
    expect(mergeGeneralSettings(current, { display: { mode: 'ring' }, canonicalSchedule: { injected: true }, scheduleOperations: { injected: true } })).toEqual({
      rings: { count: 2 }, version: 1, events: { patterns: { format: 'single_elim' } }, display: { mode: 'ring' }, canonicalSchedule: { version: 1 }, scheduleOperations: { restWindowMinutes: 10 },
    });
    expect(stripReservedOperationSettings({ display: {}, canonicalSchedule: { injected: true }, scheduleOperations: { injected: true } })).toEqual({ display: {} });
    expect(stripReservedOperationSettingsFromRaw(JSON.stringify({ display: {}, canonicalSchedule: { oldDivisionIds: true }, scheduleOperations: { stale: true } }))).toBe(JSON.stringify({ display: {} }));
    expect(stripReservedOperationSettingsFromRaw(JSON.stringify({ canonicalSchedule: {}, scheduleOperations: {} }))).toBeNull();
  });
  it('commits settings and replacement classes through one transaction', async () => {
    const tx = {
      tournament: { findUniqueOrThrow: vi.fn().mockResolvedValue({ settings: JSON.stringify({ version: 1, events: { patterns: {} } }) }), update: vi.fn().mockResolvedValue({ id: 't1' }) },
      weightClass: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }), createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = { $transaction: vi.fn((work) => work(tx)) };
    await expect(saveTournamentSettingsAtomic(prisma as never, 't1', { rings: 4 }, [{ name: 'Heavy' }])).resolves.toEqual({ id: 't1' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.tournament.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { settings: JSON.stringify({ rings: 4, version: 1, events: { patterns: {} } }) } });
    expect(tx.weightClass.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ tournamentId: 't1', name: 'Heavy', displayOrder: 0 })] });
  });

  it('does not commit the settings change when replacement classes fail', async () => {
    let storedSettings = 'before';
    const prisma = {
      $transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => {
        let transactionSettings = storedSettings;
        const tx = {
          tournament: { findUniqueOrThrow: vi.fn().mockResolvedValue({ settings: storedSettings }), update: vi.fn(async ({ data }: { data: { settings: string } }) => { transactionSettings = data.settings; return { id: 't1' }; }) },
          weightClass: {
            deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
            createMany: vi.fn().mockRejectedValue(new Error('replacement failed')),
          },
        };
        const result = await work(tx);
        storedSettings = transactionSettings;
        return result;
      }),
    };
    await expect(saveTournamentSettingsAtomic(prisma as never, 't1', { rings: 8 }, [{ name: 'Heavy' }])).rejects.toThrow('replacement failed');
    expect(storedSettings).toBe('before');
  });
});
