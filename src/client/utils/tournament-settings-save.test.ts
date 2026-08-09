import { describe, expect, it, vi } from 'vitest';
import { saveTournamentSettingsRequest } from './tournament-settings-save.js';

describe('saveTournamentSettingsRequest', () => {
  it('rejects the whole UI operation when weight classes are not acknowledged', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 't1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'conflict' }), { status: 409 }));
    await expect(saveTournamentSettingsRequest(request, 't1', { weightClasses: [{ name: 'Heavy' }] }, {}))
      .rejects.toThrow('conflict');
  });

  it('returns only after every dependent write succeeds', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 't1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await expect(saveTournamentSettingsRequest(request, 't1', { weightClasses: [{ name: 'Heavy' }] }, {}))
      .resolves.toMatchObject({ id: 't1' });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('sends an empty desired list so clearing the final class cannot leave stale rows', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 't1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await saveTournamentSettingsRequest(request, 't1', { weightClasses: [] }, {});
    expect(request).toHaveBeenNthCalledWith(2, '/api/tournaments/t1/weight-classes', expect.objectContaining({
      body: JSON.stringify({ weightClasses: [] }),
    }));
  });
});
