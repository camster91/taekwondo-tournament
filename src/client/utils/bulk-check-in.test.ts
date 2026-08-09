import { describe, expect, it, vi } from 'vitest';
import { reconcileBulkCheckInResult, runBulkCheckInRequests } from './bulk-check-in.js';

describe('bulk check-in requests', () => {
  it('waits for every request and identifies only failed registrations', async () => {
    let releaseSlow!: () => void;
    const slow = new Promise<Response>((resolve) => { releaseSlow = () => resolve(new Response('{}', { status: 200 })); });
    const send = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":"conflict"}', { status: 409 }))
      .mockReturnValueOnce(slow)
      .mockRejectedValueOnce(new TypeError('network'));

    const pending = runBulkCheckInRequests(['a', 'b', 'c'], send);
    expect(send).toHaveBeenCalledTimes(3);
    let settled = false;
    void pending.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    releaseSlow();

    await expect(pending).resolves.toEqual({
      succeededIds: ['b'],
      rejected: [{ id: 'a', error: 'conflict' }],
      deliveryUncertainIds: ['c'],
    });
  });

  it('removes server-confirmed check-ins from rejected and uncertain review', () => {
    expect(reconcileBulkCheckInResult({
      succeededIds: [],
      rejected: [{ id: 'rejected-now-checked', error: 'conflict' }, { id: 'still-rejected', error: 'invalid' }],
      deliveryUncertainIds: ['committed', 'unresolved'],
    }, [
      { id: 'rejected-now-checked', checkedIn: true },
      { id: 'still-rejected', checkedIn: false },
      { id: 'committed', checkedIn: true },
      { id: 'unresolved', checkedIn: false },
    ])).toEqual({
      rejected: [{ id: 'still-rejected', error: 'invalid' }],
      deliveryUncertainIds: ['unresolved'],
    });
  });
});
