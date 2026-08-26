import { describe, expect, it } from 'vitest';
import { parseSetupStatus } from './setup-status.js';

describe('setup status payload', () => {
  it.each([true, false])('accepts demoLoginEnabled=%s', (demoLoginEnabled) => {
    expect(parseSetupStatus({ needsSetup: false, demoLoginEnabled })).toEqual({
      needsSetup: false,
      demoLoginEnabled,
    });
  });

  it('fails closed for older payloads that do not advertise demo availability', () => {
    expect(parseSetupStatus({ needsSetup: false })).toEqual({
      needsSetup: false,
      demoLoginEnabled: false,
    });
  });

  it.each([
    null,
    {},
    { needsSetup: 'false' },
    { needsSetup: 0 },
    { needsSetup: false, demoLoginEnabled: 'true' },
  ])('rejects malformed payload %#', (payload) => {
    expect(() => parseSetupStatus(payload)).toThrow('Setup status is unavailable');
  });
});
