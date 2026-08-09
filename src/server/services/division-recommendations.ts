import { createHash } from 'node:crypto';
import {
  previewCategorization,
  type CategorizationConfig,
  type RegistrationWithCompetitor,
} from './categorization-engine.js';
import type { Prisma, PrismaClient } from '@prisma/client';
import { getSportProfile } from '../../shared/constants/sport-profiles.js';
import { parseTournamentRules } from '../../shared/constants/tournament-rules.js';
import { createRecommendation, type RecommendationValidationInput } from './recommendation-contract.js';

export const DIVISION_RECOMMENDATION_TYPE = 'division_categorization_v1';

export interface DivisionRecommendationInput {
  tournamentId: string;
  registrations: RegistrationWithCompetitor[];
  config: CategorizationConfig;
}

export type DivisionRecommendation = ReturnType<typeof buildDivisionRecommendation>;

interface PreservedPinnedRegistration {
  registrationId: string;
  competitorName: string;
  divisionId: string;
}

interface ExcludedRegistration {
  registrationId: string;
  competitorName: string;
  reasons: string[];
}

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
};

const version = (value: unknown) => createHash('sha256')
  .update(JSON.stringify(canonicalize(value)))
  .digest('hex');

const nameOf = (registration: RegistrationWithCompetitor) =>
  `${registration.competitor.firstName} ${registration.competitor.lastName}`.trim();

function exclusionReasons(registration: RegistrationWithCompetitor): string[] {
  const reasons: string[] = [];
  if (registration.ageAtTournament == null) reasons.push('missing tournament age');
  if (
    registration.sparring &&
    registration.weightAtRegistration == null &&
    registration.competitor.weightLbs == null
  ) reasons.push('missing weight');
  return reasons;
}

export function buildDivisionRecommendation(input: DivisionRecommendationInput) {
  const registrations = [...input.registrations].sort((left, right) => left.id.localeCompare(right.id));
  const preview = previewCategorization(registrations, input.config);
  const preservedPinned: PreservedPinnedRegistration[] = registrations
    .filter((registration) => Boolean(registration.manualDivisionId))
    .map((registration) => ({
      registrationId: registration.id,
      competitorName: nameOf(registration),
      divisionId: registration.manualDivisionId!,
    }));
  const excluded: ExcludedRegistration[] = registrations
    .filter((registration) => !registration.manualDivisionId)
    .map((registration) => ({
      registrationId: registration.id,
      competitorName: nameOf(registration),
      reasons: exclusionReasons(registration),
    }))
    .filter((registration) => registration.reasons.length > 0);
  const divisions = preview.divisions.map((division) => ({
    ...division,
    registrations: division.competitors.map((competitor) => ({
      registrationId: competitor.registrationId,
      competitorName: competitor.name,
      school: competitor.school,
    })),
  })).map(({ competitors: _competitors, ...division }) => division);
  const inputSnapshot = {
    tournamentId: input.tournamentId,
    config: input.config,
    registrations,
  };
  const proposedDiff = { divisions, preservedPinned, excluded };
  const warnings = [
    ...preview.warnings,
    ...excluded.flatMap((entry) => entry.reasons.map((reason) => `${entry.competitorName}: ${reason}.`)),
  ];

  return {
    tournamentId: input.tournamentId,
    recommendationType: DIVISION_RECOMMENDATION_TYPE,
    inputSnapshot,
    inputVersion: version(inputSnapshot),
    resultVersion: version(proposedDiff),
    explanation: `Proposes ${divisions.length} deterministic division${divisions.length === 1 ? '' : 's'} from complete, unpinned registrations.`,
    constraintsConsidered: [
      'Manual division pins are immutable',
      'Tournament age is never inferred',
      'Sparring weight is never inferred',
      'Tournament categorization rules and configured division size are applied deterministically',
    ],
    confidence: excluded.length === 0 ? 1 : Math.max(0, 1 - excluded.length / Math.max(1, registrations.length)),
    warnings,
    proposedDiff,
  };
}

export function validateDivisionRecommendationSnapshot(
  currentInput: DivisionRecommendationInput,
  proposal: DivisionRecommendation,
) {
  const current = buildDivisionRecommendation(currentInput);
  const errors: string[] = [];
  if (current.inputVersion !== proposal.inputVersion) {
    errors.push('Tournament inputs changed since this recommendation was created');
  }
  if (
    current.resultVersion !== proposal.resultVersion ||
    version(proposal.proposedDiff) !== proposal.resultVersion
  ) {
    errors.push('Proposed division output was changed after deterministic generation');
  }
  return {
    valid: errors.length === 0,
    validator: 'division-categorization-v1',
    inputVersion: current.inputVersion,
    errors,
  };
}

type RecommendationDatabase = Pick<PrismaClient, 'tournament' | 'registration' | 'weightClass'>;

export async function loadDivisionRecommendationInput(
  db: RecommendationDatabase,
  tournamentId: string,
): Promise<DivisionRecommendationInput> {
  const tournament = await db.tournament.findUnique({
    where: { id: tournamentId },
    select: { id: true, settings: true, sportProfileSlug: true },
  });
  if (!tournament) throw new Error('Tournament not found');
  const registrations = await db.registration.findMany({
    where: { tournamentId },
    select: {
      id: true, competitorId: true, patterns: true, sparring: true,
      ageAtTournament: true, weightAtRegistration: true, manualDivisionId: true,
      competeWithOlder: true,
      competitor: { select: {
        firstName: true, lastName: true, belt: true, gender: true,
        schoolDojang: true, weightLbs: true, danRank: true,
      } },
    },
    orderBy: { id: 'asc' },
  });
  // Weight-class order is domain precedence when configured ranges overlap.
  // Never rely on PostgreSQL's unspecified row order for validation hashes.
  const customWeightClasses = await db.weightClass.findMany({
    where: { tournamentId },
    orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
  });
  const rules = parseTournamentRules(tournament.settings);
  const sportProfile = getSportProfile(tournament.sportProfileSlug || 'taekwondo');
  return {
    tournamentId,
    registrations,
    config: {
      divisionThreshold: rules.divisions.maxDivisionSize,
      enableSmartSplitting: rules.divisions.splitBy !== 'age',
      enableSmartMerging: rules.divisions.minDivisionSize > 1,
      enableAgeBoundaryFlex: rules.divisions.ageFlexMonths > 0,
      ageBoundaryTolerance: rules.divisions.ageFlexMonths,
      useBlackBeltAgeGroups: rules.ageBands.preset === 'blackBelt',
      customAgeGroups: rules.ageBands.customBands,
      eventTypeLabels: sportProfile ? {
        patterns: sportProfile.eventTypes[0]?.name ?? 'Patterns',
        sparring: sportProfile.eventTypes[1]?.name ?? 'Sparring',
      } : undefined,
      customWeightClasses: customWeightClasses.length > 0 ? customWeightClasses : undefined,
      rules,
    },
  };
}

export async function validateDivisionRecommendation(
  db: RecommendationDatabase,
  recommendation: RecommendationValidationInput,
) {
  if (recommendation.recommendationType !== DIVISION_RECOMMENDATION_TYPE) {
    return { valid: false, validator: 'division-categorization-v1', inputVersion: 'invalid-type', errors: ['Unsupported recommendation type'] };
  }
  const storedInput = recommendation.inputSnapshot as DivisionRecommendationInput;
  const original = buildDivisionRecommendation(storedInput);
  const currentInput = await loadDivisionRecommendationInput(db, recommendation.tournamentId);
  return validateDivisionRecommendationSnapshot(currentInput, {
    ...original,
    proposedDiff: recommendation.proposedDiff as DivisionRecommendation['proposedDiff'],
  });
}

export async function createDivisionRecommendation(
  prisma: PrismaClient,
  tournamentId: string,
  createdBy: string,
) {
  const recommendation = buildDivisionRecommendation(await loadDivisionRecommendationInput(prisma, tournamentId));
  return createRecommendation(prisma, {
    tournamentId,
    recommendationType: recommendation.recommendationType,
    inputSnapshot: recommendation.inputSnapshot,
    explanation: recommendation.explanation,
    constraintsConsidered: recommendation.constraintsConsidered,
    confidence: recommendation.confidence,
    warnings: recommendation.warnings,
    proposedDiff: recommendation.proposedDiff,
    createdBy,
  }, validateDivisionRecommendation);
}
