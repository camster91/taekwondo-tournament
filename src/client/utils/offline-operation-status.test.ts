import { describe, expect, it } from 'vitest';
import { buildOfflineOperationStatuses } from './offline-operation-status.js';

describe('offline operation status presentation', () => {
  it('does not describe a rejected-only queue as zero pending', () => {
    expect(buildOfflineOperationStatuses('result', 0, 1, false)).toEqual([
      { state: 'rejected', message: '1 result needs director review' },
    ]);
  });

  it('keeps retrying and rejected work visible as separate states', () => {
    expect(buildOfflineOperationStatuses('check-in', 2, 1, true)).toEqual([
      { state: 'rejected', message: '1 check-in needs staff review' },
      { state: 'retrying', message: '2 check-ins pending sync' },
    ]);
  });
});
