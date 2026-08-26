import { describe, expect, it, vi } from 'vitest';
import { recordPublicDisplayHeartbeat } from './public-display-heartbeat.js';

describe('public display heartbeat', () => {
  it('updates one heartbeat per tournament without storing viewer identity', async () => {
    const upsert = vi.fn().mockResolvedValue({ lastSeenAt: new Date('2026-08-09T14:00:00.000Z') });

    const result = await recordPublicDisplayHeartbeat(
      { publicDisplayHeartbeat: { upsert } } as never,
      't1',
      new Date('2026-08-09T14:00:00.000Z'),
    );

    expect(upsert).toHaveBeenCalledWith({
      where: { tournamentId: 't1' },
      create: { tournamentId: 't1', lastSeenAt: new Date('2026-08-09T14:00:00.000Z') },
      update: { lastSeenAt: new Date('2026-08-09T14:00:00.000Z') },
      select: { lastSeenAt: true },
    });
    expect(result).toEqual({ lastSeenAt: '2026-08-09T14:00:00.000Z' });
  });
});
