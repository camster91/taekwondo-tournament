import { describe, expect, it, vi } from 'vitest';
import { buildTournamentAttention, loadTournamentAttention } from './tournament-attention.js';

const now = new Date('2026-08-09T14:00:00.000Z');

describe('tournament attention command centre', () => {
  it('returns structured actionable alerts for the tournament-day failure modes', () => {
    const alerts = buildTournamentAttention({
      tournament: { id: 't1', status: 'in_progress', publicSlug: 'live-event' },
      now,
      displayLastSeenAt: new Date(now.getTime() - 90_000),
      divisions: [
        {
          id: 'division-no-bracket', name: 'Patterns A', assignments: [
            { registrationId: 'r1', checkedIn: false }, { registrationId: 'r2', checkedIn: true },
          ], bracket: null,
        },
        {
          id: 'division-live', name: 'Sparring B', assignments: [
            { registrationId: 'r1', checkedIn: false }, { registrationId: 'r2', checkedIn: true },
          ],
          bracket: { id: 'b1', matches: [
            { id: 'm1', status: 'ready', competitor1Id: 'r1', competitor2Id: 'r2', ringNumber: 1, scheduledTime: new Date(now.getTime() - 60_000), updatedAt: now },
            { id: 'm2', status: 'ready', competitor1Id: 'r2', competitor2Id: 'r1', ringNumber: 1, scheduledTime: new Date(now.getTime() - 60_000), updatedAt: now },
          ] },
        },
        {
          id: 'division-blocked', name: 'Sparring C', assignments: [
            { registrationId: 'r3', checkedIn: true }, { registrationId: 'r4', checkedIn: true },
          ],
          bracket: { id: 'b2', matches: [
            { id: 'm3', status: 'pending', competitor1Id: null, competitor2Id: null, ringNumber: null, scheduledTime: null, updatedAt: now },
          ] },
        },
      ],
      incidents: [{ id: 'incident-1', severity: 'serious', actionTaken: null }],
    });

    expect(alerts.map((alert) => alert.kind)).toEqual(expect.arrayContaining([
      'missing_bracket', 'unchecked_soon', 'schedule_conflict', 'idle_ring',
      'unresolved_incident', 'stale_public_display', 'division_blocked',
    ]));
    for (const alert of alerts) {
      expect(alert.id).toBeTruthy();
      expect(['critical', 'warning', 'info']).toContain(alert.severity);
      expect(alert.recommendation).toBeTruthy();
      expect(alert.affectedLabels?.length).toBeGreaterThan(0);
      expect(alert.href).toMatch(/^\//);
      expect(alert.affected.tournamentId).toBe('t1');
    }
    expect(alerts.find((alert) => alert.kind === 'unresolved_incident')).toMatchObject({
      severity: 'critical', affected: { incidentIds: ['incident-1'] },
    });
  });

  it('does not call a pre-live or future scheduled ring idle', () => {
    const division = {
      id: 'd1', name: 'Patterns', assignments: [], bracket: { id: 'b1', matches: [{
        id: 'm1', status: 'ready', competitor1Id: 'r1', competitor2Id: 'r2', ringNumber: 1,
        scheduledTime: new Date(now.getTime() + 60 * 60_000), updatedAt: now,
      }] },
    };
    expect(buildTournamentAttention({ tournament: { id: 't1', status: 'brackets', publicSlug: null }, now, divisions: [division], incidents: [] })
      .some((alert) => alert.kind === 'idle_ring')).toBe(false);
    expect(buildTournamentAttention({ tournament: { id: 't1', status: 'in_progress', publicSlug: null }, now, divisions: [division], incidents: [] })
      .some((alert) => alert.kind === 'idle_ring')).toBe(false);
  });

  it('does not classify normal same-ring cadence as a schedule conflict', () => {
    const match = (id: string, offset: number) => ({
      id, status: 'ready', competitor1Id: `${id}-a`, competitor2Id: `${id}-b`, ringNumber: 1,
      scheduledTime: new Date(now.getTime() + offset), updatedAt: now,
    });
    const alerts = buildTournamentAttention({
      tournament: { id: 't1', status: 'in_progress', publicSlug: null }, now,
      divisions: [{ id: 'd1', name: 'Sparring', assignments: [], bracket: { id: 'b1', matches: [match('m1', 0), match('m2', 5 * 60_000)] } }],
      incidents: [],
    });
    expect(alerts.some((alert) => alert.kind === 'schedule_conflict')).toBe(false);
  });

  it('does not assume a published parent scoreboard means a venue display is expected', () => {
    const alerts = buildTournamentAttention({
      tournament: { id: 't1', status: 'in_progress', publicSlug: 'parent-link' }, now,
      divisions: [], incidents: [],
    });
    expect(alerts.some((alert) => alert.kind === 'stale_public_display')).toBe(false);
  });

  it('flags a match that has remained in progress beyond the expected window', () => {
    const alerts = buildTournamentAttention({
      tournament: { id: 't1', status: 'in_progress', publicSlug: null }, now,
      divisions: [{
        id: 'd1', name: 'Sparring', assignments: [], bracket: { id: 'b1', matches: [{
          id: 'm1', status: 'in_progress', competitor1Id: 'r1', competitor2Id: 'r2', ringNumber: 2,
          scheduledTime: new Date(now.getTime() - 15 * 60_000), updatedAt: new Date(now.getTime() - 11 * 60_000),
        }] },
      }], incidents: [],
    });
    expect(alerts).toContainEqual(expect.objectContaining({
      kind: 'ring_delay', affected: expect.objectContaining({ matchIds: ['m1'], ringNumbers: [2] }),
    }));
  });

  it('returns no alerts for an orderly completed tournament', () => {
    expect(buildTournamentAttention({
      tournament: { id: 't1', status: 'completed', publicSlug: null },
      now,
      divisions: [],
      incidents: [],
    })).toEqual([]);
  });

  it('loads only active tournament-day records and maps registrations into the alert contract', async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: 't1', status: 'in_progress', publicSlug: null,
      divisions: [{
        id: 'd1', name: 'Patterns', assignments: [
          { registration: { id: 'r1', checkedIn: false } },
          { registration: { id: 'r2', checkedIn: true } },
        ],
        bracket: null,
      }],
      incidents: [],
    });

    const alerts = await loadTournamentAttention({ tournament: { findUnique } } as never, 't1', now);

    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 't1', deletedAt: null },
    }));
    expect(alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'missing_bracket', affected: expect.objectContaining({ divisionIds: ['d1'] }) }),
    ]));
  });
});
