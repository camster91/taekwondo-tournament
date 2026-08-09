import { describe, expect, it, vi } from 'vitest';
import { runWithOfflineOperationLock } from './offline-operation-lock.js';

describe('offline operation cross-tab lock', () => {
  it('runs only when the browser grants the named exclusive lock', async () => {
    const task = vi.fn(async () => 'sent');
    const request = vi.fn(async (_name, options, callback) => callback({ name: 'bowin-offline-operation-sync' }));

    await expect(runWithOfflineOperationLock({ request }, task)).resolves.toBe('sent');
    expect(request).toHaveBeenCalledWith(
      'bowin-offline-operation-sync',
      { mode: 'exclusive', ifAvailable: true },
      expect.any(Function),
    );
    expect(task).toHaveBeenCalledOnce();
  });

  it('does not send when another tab already holds the lock', async () => {
    const task = vi.fn(async () => 'sent');
    const request = vi.fn(async (_name, _options, callback) => callback(null));

    await expect(runWithOfflineOperationLock({ request }, task)).resolves.toBeNull();
    expect(task).not.toHaveBeenCalled();
  });
});
