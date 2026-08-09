import { describe, expect, it } from 'vitest';
import { parseSetupStatus } from './setup-status.js';

describe('setup status payload', () => {
  it.each([true, false])('accepts needsSetup=%s', (needsSetup) => {
    expect(parseSetupStatus({ needsSetup })).toEqual({ needsSetup });
  });

  it.each([null, {}, { needsSetup: 'false' }, { needsSetup: 0 }])('rejects malformed payload %#', (payload) => {
    expect(() => parseSetupStatus(payload)).toThrow('Setup status is unavailable');
  });
});
