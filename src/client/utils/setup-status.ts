export interface SetupStatus {
  needsSetup: boolean;
  demoLoginEnabled: boolean;
}

export function parseSetupStatus(value: unknown): SetupStatus {
  if (!value || typeof value !== 'object') {
    throw new Error('Setup status is unavailable');
  }

  const payload = value as Record<string, unknown>;
  if (
    typeof payload.needsSetup !== 'boolean'
    || (payload.demoLoginEnabled !== undefined && typeof payload.demoLoginEnabled !== 'boolean')
  ) {
    throw new Error('Setup status is unavailable');
  }

  return {
    needsSetup: payload.needsSetup,
    demoLoginEnabled: payload.demoLoginEnabled === true,
  };
}
