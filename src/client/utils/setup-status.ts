export interface SetupStatus {
  needsSetup: boolean;
}

export function parseSetupStatus(value: unknown): SetupStatus {
  if (!value || typeof value !== 'object' || typeof (value as Record<string, unknown>).needsSetup !== 'boolean') {
    throw new Error('Setup status is unavailable');
  }
  return { needsSetup: (value as Record<string, boolean>).needsSetup };
}
