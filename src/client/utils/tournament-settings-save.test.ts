import { describe, expect, it, vi } from 'vitest';
import { saveTournamentSettingsRequest } from './tournament-settings-save.js';

describe('saveTournamentSettingsRequest', () => {
  it('rejects when the atomic settings operation is not acknowledged', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: 'conflict' }), { status: 409 }));
    await expect(saveTournamentSettingsRequest(request, 't1', { weightClasses: [{ name: 'Heavy' }] }, {}))
      .rejects.toThrow('conflict');
  });

  it('uses one atomic request for settings and weight classes', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ id: 't1' }), { status: 200 }));
    await expect(saveTournamentSettingsRequest(request, 't1', { weightClasses: [{ name: 'Heavy' }] }, {}))
      .resolves.toMatchObject({ id: 't1' });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('/api/tournaments/t1/settings', expect.objectContaining({
      body: JSON.stringify({ settings: { weightClasses: [{ name: 'Heavy' }] }, weightClasses: [{ name: 'Heavy' }] }),
    }));
  });

  it('sends an empty desired list so clearing the final class cannot leave stale rows', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ id: 't1' }), { status: 200 }));
    await saveTournamentSettingsRequest(request, 't1', { weightClasses: [] }, {});
    expect(request).toHaveBeenCalledWith('/api/tournaments/t1/settings', expect.objectContaining({
      body: JSON.stringify({ settings: { weightClasses: [] }, weightClasses: [] }),
    }));
  });
});
