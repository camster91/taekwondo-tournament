export interface ManagedRegistration {
  confirmationCode: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  belt: string;
  weight: number | null;
  school: string | null;
  specialNeeds: string | null;
  competeWithOlder: boolean;
  patterns: boolean;
  sparring: boolean;
  tournamentId: string;
  tournamentName: string;
  tournamentDate: string;
  tournamentStatus: string;
  checkedIn: boolean;
}

export type ManagedRegistrationUpdate = Pick<ManagedRegistration,
  'firstName' | 'gender' | 'belt' | 'school' | 'weight' | 'specialNeeds'
  | 'competeWithOlder' | 'patterns' | 'sparring'>;

const TOURNAMENT_STATUSES = new Set(['draft', 'registration', 'brackets', 'in_progress', 'active', 'completed']);

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function nullableText(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isoDate(value: unknown): value is string {
  return text(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

export function parseManagedRegistrationResponse(value: unknown): { registration: ManagedRegistration } {
  const registration = value && typeof value === 'object'
    ? (value as Record<string, unknown>).registration
    : null;
  if (!registration || typeof registration !== 'object') throw new Error('Registration status could not be verified');
  const item = registration as Record<string, unknown>;
  const valid = typeof item.confirmationCode === 'string' && /^[0-9a-f]{8}$/i.test(item.confirmationCode)
    && text(item.firstName) && text(item.lastName)
    && isoDate(item.dateOfBirth)
    && (item.gender === 'M' || item.gender === 'F') && text(item.belt)
    && (item.weight === null || (typeof item.weight === 'number' && Number.isFinite(item.weight)))
    && nullableText(item.school) && nullableText(item.specialNeeds)
    && typeof item.competeWithOlder === 'boolean'
    && typeof item.patterns === 'boolean' && typeof item.sparring === 'boolean'
    && typeof item.tournamentId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.tournamentId)
    && text(item.tournamentName)
    && isoDate(item.tournamentDate) && typeof item.tournamentStatus === 'string' && TOURNAMENT_STATUSES.has(item.tournamentStatus)
    && typeof item.checkedIn === 'boolean';
  if (!valid) throw new Error('Registration status could not be verified');
  return { registration: item as unknown as ManagedRegistration };
}

export function normalizeManagedRegistrationUpdate(value: Partial<ManagedRegistration>): ManagedRegistrationUpdate {
  return {
    firstName: value.firstName?.trim() ?? '',
    gender: value.gender ?? '',
    belt: value.belt?.trim() ?? '',
    school: value.school?.trim() || null,
    weight: typeof value.weight === 'number' ? value.weight : null,
    specialNeeds: value.specialNeeds?.trim() || null,
    competeWithOlder: value.competeWithOlder ?? false,
    patterns: value.patterns ?? false,
    sparring: value.sparring ?? false,
  };
}

export function managedRegistrationMatchesUpdate(
  registration: ManagedRegistration,
  expected: ManagedRegistrationUpdate,
): boolean {
  const actual = normalizeManagedRegistrationUpdate(registration);
  return (Object.keys(expected) as Array<keyof ManagedRegistrationUpdate>)
    .every((key) => actual[key] === expected[key]);
}
