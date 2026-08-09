export interface RegistrationLegalConfig {
  consentVersion: string;
  privacyNoticeUrl: string;
  tournamentTermsUrl: string;
}

export interface RegistrationResult {
  success: true;
  message: string;
  registration: {
    id: string;
    confirmationCode: string;
    managementToken: string;
    competitorName: string;
    tournamentName: string;
    tournamentDate: string;
    events: { patterns: boolean; sparring: boolean };
    ageGroup: string;
  };
}

export class RegistrationConfirmationError extends Error {
  constructor() {
    super('Registration confirmation could not be verified');
    this.name = 'RegistrationConfirmationError';
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSafeLegalUrl(value: unknown): value is string {
  if (!isNonEmptyString(value) || value !== value.trim()) return false;
  if (value.startsWith('/')) return !value.startsWith('//');
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function parseRegistrationLegalConfig(value: unknown): RegistrationLegalConfig {
  if (!value || typeof value !== 'object') throw new Error('Required registration terms are unavailable');
  const config = value as Record<string, unknown>;
  if (!isNonEmptyString(config.consentVersion)
    || !isSafeLegalUrl(config.privacyNoticeUrl)
    || !isSafeLegalUrl(config.tournamentTermsUrl)) {
    throw new Error('Required registration terms are unavailable');
  }
  return {
    consentVersion: config.consentVersion,
    privacyNoticeUrl: config.privacyNoticeUrl,
    tournamentTermsUrl: config.tournamentTermsUrl,
  };
}

export function parseRegistrationResult(value: unknown): RegistrationResult {
  if (!value || typeof value !== 'object') throw new RegistrationConfirmationError();
  const result = value as Record<string, unknown>;
  const registration = result.registration as Record<string, unknown> | null;
  const events = registration?.events as Record<string, unknown> | null;
  const valid = result.success === true
    && isNonEmptyString(result.message)
    && registration
    && isNonEmptyString(registration.id)
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(registration.id)
    && isNonEmptyString(registration.confirmationCode)
    && registration.confirmationCode === registration.id.slice(0, 8)
    && isNonEmptyString(registration.managementToken)
    && /^[A-Za-z0-9_-]{43}$/.test(registration.managementToken)
    && isNonEmptyString(registration.competitorName)
    && isNonEmptyString(registration.tournamentName)
    && isNonEmptyString(registration.tournamentDate)
    && !Number.isNaN(Date.parse(registration.tournamentDate))
    && new Date(registration.tournamentDate).toISOString() === registration.tournamentDate
    && isNonEmptyString(registration.ageGroup)
    && events
    && typeof events.patterns === 'boolean'
    && typeof events.sparring === 'boolean';
  if (!valid) throw new RegistrationConfirmationError();
  return result as unknown as RegistrationResult;
}
