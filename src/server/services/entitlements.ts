export const PLAN_NAMES = ['free', 'pilot', 'starter', 'pro'] as const;
export type PlanName = (typeof PLAN_NAMES)[number];

export type PlanEntitlements = {
  maxTournaments: number;
  maxCompetitorsPerTournament: number;
  maxMembers: number;
  maxRings: number;
  publicRegistration: boolean;
  eventOperations: boolean;
};

const PLANS: Record<PlanName, PlanEntitlements> = {
  free: {
    maxTournaments: 1,
    maxCompetitorsPerTournament: 30,
    maxMembers: 1,
    maxRings: 1,
    publicRegistration: false,
    eventOperations: false,
  },
  pilot: {
    maxTournaments: 5,
    maxCompetitorsPerTournament: 9999, // No limit for pilot customers
    maxMembers: 10,
    maxRings: 6,
    publicRegistration: true,
    eventOperations: true,
  },
  starter: {
    maxTournaments: 10,
    maxCompetitorsPerTournament: 100,
    maxMembers: 15,
    maxRings: 8,
    publicRegistration: true,
    eventOperations: true,
  },
  pro: {
    maxTournaments: 100,
    maxCompetitorsPerTournament: 9999, // Effectively unlimited
    maxMembers: 100,
    maxRings: 32,
    publicRegistration: true,
    eventOperations: true,
  },
};

export function normalizePlan(value: unknown): PlanName {
  return typeof value === 'string' && (PLAN_NAMES as readonly string[]).includes(value)
    ? value as PlanName
    : 'free';
}

export function getPlanEntitlements(plan: unknown): PlanEntitlements {
  return PLANS[normalizePlan(plan)];
}

export function canCreateTournament(plan: unknown, existingTournamentCount: number): boolean {
  return existingTournamentCount < getPlanEntitlements(plan).maxTournaments;
}

export function canOpenPublicRegistration(plan: unknown): boolean {
  return getPlanEntitlements(plan).publicRegistration;
}

export function canAddRegistration(plan: unknown, existingCompetitorCount: number): boolean {
  return existingCompetitorCount < getPlanEntitlements(plan).maxCompetitorsPerTournament;
}

export function canAddBulkRegistrations(plan: unknown, existingCompetitorCount: number, addingCount: number): boolean {
  return existingCompetitorCount + addingCount <= getPlanEntitlements(plan).maxCompetitorsPerTournament;
}
