import { createHash } from 'node:crypto';
import {
  autoCategorize,
  previewCategorization,
  type CategorizationConfig,
  type RegistrationWithCompetitor,
} from './categorization-engine.js';
import type { Prisma, PrismaClient } from '@prisma/client';
import { getSportProfile } from '../../shared/constants/sport-profiles.js';
import { parseTournamentRules } from '../../shared/constants/tournament-rules.js';
import {
  applyApprovedRecommendation,
  createRecommendation,
  type RecommendationValidationInput,
} from './recommendation-contract.js';

export const DIVISION_RECOMMENDATION_TYPE = 'division_categorization_v1';

export interface DivisionRecommendationInput {
  tournamentId: string;
  registrations: RegistrationWithCompetitor[];
  config: CategorizationConfig;
  existingDivisions?: Array<{
    id: string;
    name: string;
    assignments: Array<{ id?: string; registrationId: string; seedPosition?: number | null; manualOverride?: boolean }>;
    bracketId: string | null;
    [key: string]: unknown;
  }>;
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
    existingDivisions: [...(input.existingDivisions ?? [])].sort((left, right) => left.id.localeCompare(right.id)),
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

type RecommendationDatabase = Pick<PrismaClient, 'tournament' | 'registration' | 'weightClass' | 'division' | '$queryRawUnsafe'>;

async function lockDivisionRecommendationInputs(db: RecommendationDatabase, tournamentId: string): Promise<void> {
  // These row locks live for the surrounding transaction. They coordinate
  // with FK key-share locks and ordinary row updates from bracket, pin,
  // registration, and tournament-settings writers.
  await db.$queryRawUnsafe('SELECT id FROM "Tournament" WHERE id = $1 FOR UPDATE', tournamentId);
  await db.$queryRawUnsafe('SELECT id FROM "Registration" WHERE "tournamentId" = $1 ORDER BY id FOR UPDATE', tournamentId);
  await db.$queryRawUnsafe('SELECT c.id FROM "Competitor" c JOIN "Registration" r ON r."competitorId" = c.id WHERE r."tournamentId" = $1 ORDER BY c.id FOR UPDATE OF c', tournamentId);
  await db.$queryRawUnsafe('SELECT id FROM "WeightClass" WHERE "tournamentId" = $1 ORDER BY id FOR UPDATE', tournamentId);
  await db.$queryRawUnsafe('SELECT id FROM "Division" WHERE "tournamentId" = $1 ORDER BY id FOR UPDATE', tournamentId);
  await db.$queryRawUnsafe('SELECT a.id FROM "DivisionAssignment" a JOIN "Division" d ON d.id = a."divisionId" WHERE d."tournamentId" = $1 ORDER BY a.id FOR UPDATE OF a', tournamentId);
}

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
      assignments: {
        where: { manualOverride: true },
        select: { divisionId: true, manualOverride: true },
        orderBy: { divisionId: 'asc' },
      },
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
  const existingDivisions = await db.division.findMany({
    where: { tournamentId },
    select: {
      id: true, name: true, beltLevel: true, gender: true, eventType: true,
      ageMin: true, ageMax: true, beltColors: true, danMin: true, danMax: true,
      weightClass: true, divisionNumber: true, isSpecialNeeds: true,
      displayOrder: true, deletedAt: true,
      assignments: {
        select: { id: true, registrationId: true, seedPosition: true, manualOverride: true },
        orderBy: { id: 'asc' },
      },
      bracket: { select: { id: true } },
    },
    orderBy: { id: 'asc' },
  });
  const existingDivisionById = new Map(existingDivisions.map((division) => [division.id, division]));
  const preservedDivisionIds = new Set<string>();
  for (const registration of registrations) {
    if (!registration.manualDivisionId) continue;
    const division = existingDivisionById.get(registration.manualDivisionId);
    if (!division) {
      throw new Error(`Registration ${registration.id} references a manual division outside this tournament`);
    }
    if (!division.assignments.some((assignment) => assignment.registrationId === registration.id)) {
      throw new Error(`Registration ${registration.id} has no assignment in its manual division`);
    }
    preservedDivisionIds.add(division.id);
  }
  for (const division of existingDivisions) {
    if (division.assignments.some((assignment) => assignment.manualOverride)) preservedDivisionIds.add(division.id);
  }
  const preservedDivisionByRegistration = new Map<string, string>();
  for (const division of existingDivisions) {
    if (!preservedDivisionIds.has(division.id)) continue;
    for (const assignment of division.assignments) {
      const prior = preservedDivisionByRegistration.get(assignment.registrationId);
      if (prior && prior !== division.id) {
        throw new Error(`Registration ${assignment.registrationId} belongs to conflicting preserved divisions`);
      }
      preservedDivisionByRegistration.set(assignment.registrationId, division.id);
    }
  }
  const rules = parseTournamentRules(tournament.settings);
  const sportProfile = getSportProfile(tournament.sportProfileSlug || 'taekwondo');
  return {
    tournamentId,
    registrations: registrations.map(({ assignments, ...registration }) => {
      const pinCandidates = new Set([
        registration.manualDivisionId,
        ...assignments.map((assignment) => assignment.divisionId),
        preservedDivisionByRegistration.get(registration.id),
      ].filter((divisionId): divisionId is string => Boolean(divisionId)));
      if (pinCandidates.size > 1) {
        throw new Error(`Registration ${registration.id} has conflicting manual division assignments`);
      }
      return {
        ...registration,
        manualDivisionId: [...pinCandidates][0] ?? null,
      };
    }),
    existingDivisions: existingDivisions.map(({ bracket, ...division }) => ({
      ...division,
      deletedAt: division.deletedAt?.toISOString() ?? null,
      bracketId: bracket?.id ?? null,
    })),
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
  await lockDivisionRecommendationInputs(db, recommendation.tournamentId);
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

const divisionAuditSnapshot = (tx: Prisma.TransactionClient, tournamentId: string) =>
  tx.division.findMany({
    where: { tournamentId },
    include: {
      assignments: { orderBy: { registrationId: 'asc' } },
      bracket: { include: { matches: { orderBy: { matchNumber: 'asc' } } } },
    },
    orderBy: { id: 'asc' },
  });

export function assertDivisionRecommendationCanApply(
  divisions: Array<{ name: string; bracket: { id: string } | null }>,
): void {
  if (divisions.some((division) => division.bracket)) {
    throw new Error('Remove or correct existing brackets before applying a division recommendation');
  }
}

export async function applyDivisionRecommendation(
  prisma: PrismaClient,
  recommendationId: string,
  appliedBy: string,
) {
  return applyApprovedRecommendation(prisma, recommendationId, appliedBy, async (tx, recommendation) => {
    const input = recommendation.inputSnapshot
      ? JSON.parse(recommendation.inputSnapshot) as DivisionRecommendationInput
      : null;
    if (!input || recommendation.recommendationType !== DIVISION_RECOMMENDATION_TYPE) {
      throw new Error('Recommendation is not a division categorization proposal');
    }
    const beforeState = await divisionAuditSnapshot(tx, recommendation.tournamentId);
    assertDivisionRecommendationCanApply(beforeState);
    const backup = {
      tournamentId: recommendation.tournamentId,
      timestamp: new Date(),
      divisions: beforeState.map((division) => ({
        id: division.id,
        name: division.name,
        beltLevel: division.beltLevel,
        gender: division.gender,
        eventType: division.eventType,
        ageMin: division.ageMin,
        ageMax: division.ageMax,
        beltColors: division.beltColors,
        danMin: division.danMin,
        danMax: division.danMax,
        weightClass: division.weightClass,
        divisionNumber: division.divisionNumber,
        isSpecialNeeds: division.isSpecialNeeds,
        displayOrder: division.displayOrder,
        assignments: division.assignments.map((assignment) => ({
          registrationId: assignment.registrationId,
          seedPosition: assignment.seedPosition,
          manualOverride: assignment.manualOverride,
        })),
      })),
    };
    await tx.backupState.upsert({
      where: { tournamentId: recommendation.tournamentId },
      create: { tournamentId: recommendation.tournamentId, payload: JSON.stringify(backup) },
      update: { payload: JSON.stringify(backup), updatedAt: new Date() },
    });
    const appliedResult = await autoCategorize(tx, recommendation.tournamentId, input.registrations, input.config);
    const afterState = await divisionAuditSnapshot(tx, recommendation.tournamentId);
    return {
      appliedResult,
      beforeState,
      afterState,
      // BackupState is a single mutable latest-recovery artifact, not an
      // immutable audit-linked undo. Do not claim this audit is reversible.
      undoReference: null,
    };
  }, validateDivisionRecommendation);
}
