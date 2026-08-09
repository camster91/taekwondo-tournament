import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { RecommendationValidationInput } from './recommendation-contract.js';
import { applyApprovedRecommendation, createRecommendation } from './recommendation-contract.js';
import {
  optimizeTournamentSchedule,
  type ScheduleOptimizationResult,
  type ScheduleOptimizerInput,
} from './schedule-optimizer.js';
import {
  assertCanonicalLocksPreserved,
  canonicalScheduleVersion,
  type CanonicalScheduleSnapshot,
} from './canonical-schedule.js';
import { generateSchedule, type TournamentSchedule } from './schedule-generator.js';
import { readStoredScheduleConfig } from './schedule-correction.js';
import { materializeCanonicalTournamentSchedule, readCanonicalSchedule } from './canonical-schedule.js';
import { mergeCanonicalScheduleSettings } from './canonical-schedule.js';

export const SCHEDULE_OPTIMIZATION_TYPE = 'schedule_optimization_v1';

export interface ScheduleEvidenceCoverage {
  capturedAt: string;
  athleteIdentityCoverage: { known: number; total: number };
  conflictGroupCoverage: { known: number; total: number; coachDataAvailable: boolean };
  durationCoverage: { known: number; total: number };
  liveDelaySources: Array<{ ring: number; delayMinutes: number; observedAt: string; source: string }>;
  incidentSources: Array<{ incidentId: string; ring: number; observedAt: string; label: string }>;
}

export interface ScheduleOptimizationRecommendationInput {
  tournamentId: string;
  optimizerInput: ScheduleOptimizerInput;
  evidence: ScheduleEvidenceCoverage;
}

export interface ScheduleOperationalConditions {
  restWindowMinutes: number;
  liveDelaySources: ScheduleEvidenceCoverage['liveDelaySources'];
  incidentSources: ScheduleEvidenceCoverage['incidentSources'];
}

export interface ScheduleOperationalConditionsInput {
  restWindowMinutes: number;
  ringDelays: Array<{ ring: number; delayMinutes: number }>;
  incidentBlocks: Array<{ incidentId: string; ring: number }>;
}

interface ScheduleInputSource {
  tournamentId: string;
  ringCount: number;
  capturedAt: string;
  schedule: Array<{
    divisionId: string; divisionName: string; ring: number; startTime: string; estimatedDurationMinutes: number;
  }>;
  divisions: Array<{
    id: string;
    assignments: Array<{ registrationId: string; schoolDojang: string | null }>;
  }>;
  canonicalSchedule: CanonicalScheduleSnapshot | null;
  operationalConditions: ScheduleOperationalConditions;
}

interface ScheduleMove {
  divisionId: string;
  divisionName: string;
  before: { ring: number; startMinutes: number };
  after: { ring: number; startMinutes: number };
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const validInstant = (value: unknown) => typeof value === 'string' && ISO_INSTANT.test(value) && !Number.isNaN(Date.parse(value));

export function readScheduleOperationalConditions(raw: string | null, ringCount: number, now = new Date()): ScheduleOperationalConditions {
  let settings: Record<string, unknown> = {};
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      settings = parsed as Record<string, unknown>;
    } catch {
      throw new Error('Tournament settings require repair before schedule optimization');
    }
  }
  const stored = settings.scheduleOperations;
  if (stored === undefined) return { restWindowMinutes: 10, liveDelaySources: [], incidentSources: [] };
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) throw new Error('Schedule operation conditions are invalid');
  const value = stored as Record<string, unknown>;
  if (!Number.isInteger(value.restWindowMinutes) || (value.restWindowMinutes as number) < 0 || (value.restWindowMinutes as number) > 240) {
    throw new Error('Schedule operation rest window is invalid');
  }
  if (!Array.isArray(value.liveDelaySources) || !Array.isArray(value.incidentSources)) {
    throw new Error('Schedule operation conditions require provenance arrays');
  }
  const liveDelaySources = value.liveDelaySources.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('Live delay provenance is invalid');
    const entry = item as Record<string, unknown>;
    if (!Number.isInteger(entry.ring) || (entry.ring as number) < 1 || (entry.ring as number) > ringCount
      || !Number.isInteger(entry.delayMinutes) || (entry.delayMinutes as number) < 0 || (entry.delayMinutes as number) > 240
      || !validInstant(entry.observedAt) || !['director-confirmed', 'system-pace'].includes(String(entry.source))) {
      throw new Error('Live delay provenance is invalid');
    }
    const age = now.getTime() - Date.parse(entry.observedAt as string);
    if (age < -5 * 60_000 || age > 30 * 60_000) throw new Error('Live delay provenance expired');
    return { ring: entry.ring as number, delayMinutes: entry.delayMinutes as number, observedAt: entry.observedAt as string, source: String(entry.source) };
  });
  const incidentSources = value.incidentSources.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('Incident provenance is invalid');
    const entry = item as Record<string, unknown>;
    if (typeof entry.incidentId !== 'string' || !entry.incidentId.trim()
      || !Number.isInteger(entry.ring) || (entry.ring as number) < 1 || (entry.ring as number) > ringCount
      || !validInstant(entry.observedAt) || typeof entry.label !== 'string' || !entry.label.trim()) {
      throw new Error('Incident provenance is invalid');
    }
    const age = now.getTime() - Date.parse(entry.observedAt as string);
    if (age < -5 * 60_000 || age > 4 * 60 * 60_000) throw new Error('Incident provenance expired');
    return { incidentId: entry.incidentId, ring: entry.ring as number, observedAt: entry.observedAt as string, label: entry.label.trim() };
  });
  if (new Set(liveDelaySources.map((entry) => entry.ring)).size !== liveDelaySources.length) throw new Error('Live delay provenance contains duplicate rings');
  if (new Set(incidentSources.map((entry) => entry.incidentId)).size !== incidentSources.length) throw new Error('Incident provenance contains duplicate incidents');
  return { restWindowMinutes: value.restWindowMinutes as number, liveDelaySources, incidentSources };
}

const timeToMinutes = (value: string) => {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) throw new Error('Schedule contains an invalid start time');
  return Number(match[1]) * 60 + Number(match[2]);
};

export function buildScheduleOptimizationInput(source: ScheduleInputSource): ScheduleOptimizationRecommendationInput {
  if (!validInstant(source.capturedAt)) throw new Error('Schedule optimization capture time is invalid');
  const divisions = new Map(source.divisions.map((division) => [division.id, division]));
  if (divisions.size !== source.divisions.length || source.schedule.length !== source.divisions.length
    || source.schedule.some((row) => !divisions.has(row.divisionId))) {
    throw new Error('Schedule optimization division coverage is incomplete');
  }
  const canonicalById = new Map(source.canonicalSchedule?.rows.map((row) => [row.divisionId, row]) ?? []);
  if (source.canonicalSchedule && canonicalById.size !== source.schedule.length) throw new Error('Canonical schedule coverage is incomplete');
  let assignmentCount = 0;
  let schoolKnownCount = 0;
  const optimizerDivisions = source.schedule.map((row) => {
    const division = divisions.get(row.divisionId)!;
    const schools = new Set<string>();
    for (const assignment of division.assignments) {
      assignmentCount += 1;
      const school = assignment.schoolDojang?.trim().toLocaleLowerCase();
      if (school) { schools.add(`school:${school}`); schoolKnownCount += 1; }
    }
    const canonical = canonicalById.get(row.divisionId);
    return {
      divisionId: row.divisionId,
      divisionName: row.divisionName,
      durationMinutes: row.estimatedDurationMinutes,
      currentRing: row.ring,
      currentStartMinutes: timeToMinutes(row.startTime),
      eligibleRings: Array.from({ length: source.ringCount }, (_, index) => index + 1),
      registrationIds: division.assignments.map((assignment) => assignment.registrationId).sort(),
      conflictGroupIds: [...schools].sort(),
      locked: canonical?.locked ?? false,
    };
  });
  const liveDelaySources = source.operationalConditions.liveDelaySources;
  const incidentSources = source.operationalConditions.incidentSources;
  return {
    tournamentId: source.tournamentId,
    optimizerInput: {
      tournamentId: source.tournamentId,
      ringCount: source.ringCount,
      restWindowMinutes: source.operationalConditions.restWindowMinutes,
      ringDelayMinutes: Object.fromEntries(liveDelaySources.map((entry) => [entry.ring, entry.delayMinutes])),
      blockedRings: [...new Set(incidentSources.map((entry) => entry.ring))].sort((a, b) => a - b),
      divisions: optimizerDivisions,
    },
    evidence: {
      capturedAt: source.capturedAt,
      athleteIdentityCoverage: { known: assignmentCount, total: assignmentCount },
      conflictGroupCoverage: { known: schoolKnownCount, total: assignmentCount, coachDataAvailable: false },
      durationCoverage: { known: optimizerDivisions.length, total: optimizerDivisions.length },
      liveDelaySources,
      incidentSources,
    },
  };
}

type ScheduleOptimizationDatabase = PrismaClient | Prisma.TransactionClient;
type ScheduleGenerator = (db: PrismaClient, tournamentId: string, config: ReturnType<typeof readStoredScheduleConfig>) => Promise<TournamentSchedule>;

export async function loadScheduleOptimizationInput(
  db: ScheduleOptimizationDatabase,
  tournamentId: string,
  now = new Date(),
  generate: ScheduleGenerator = generateSchedule,
): Promise<ScheduleOptimizationRecommendationInput> {
  const tournament = await db.tournament.findUnique({ where: { id: tournamentId }, select: { settings: true } });
  if (!tournament) throw new Error('Tournament not found');
  const generated = await generate(db as PrismaClient, tournamentId, readStoredScheduleConfig(tournament.settings));
  const schedule = materializeCanonicalTournamentSchedule(generated, tournament.settings);
  const divisions = await db.division.findMany({
    where: { tournamentId, deletedAt: null },
    select: {
      id: true,
      assignments: {
        select: {
          registrationId: true,
          registration: { select: { competitor: { select: { schoolDojang: true } } } },
        },
      },
    },
    orderBy: { id: 'asc' },
  });
  const operationalConditions = readScheduleOperationalConditions(tournament.settings, schedule.config.ringCount, now);
  if (operationalConditions.incidentSources.length > 0) {
    const incidents = await db.incident.findMany({
      where: {
        id: { in: operationalConditions.incidentSources.map((entry) => entry.incidentId) },
        tournamentId,
        deletedAt: null,
        actionTaken: null,
      },
      select: { id: true, type: true, severity: true, updatedAt: true },
    });
    const incidentById = new Map(incidents.map((incident) => [incident.id, incident]));
    for (const source of operationalConditions.incidentSources) {
      const incident = incidentById.get(source.incidentId);
      if (!incident || incident.updatedAt.getTime() > Date.parse(source.observedAt)) {
        throw new Error('Schedule incident provenance is stale, resolved, or belongs to another tournament');
      }
      source.label = `${incident.type} (${incident.severity})`;
    }
  }
  return buildScheduleOptimizationInput({
    tournamentId,
    ringCount: schedule.config.ringCount,
    capturedAt: now.toISOString(),
    schedule: schedule.schedule,
    divisions: divisions.map((division) => ({
      id: division.id,
      assignments: division.assignments.map((assignment) => ({
        registrationId: assignment.registrationId,
        schoolDojang: assignment.registration.competitor.schoolDojang,
      })),
    })),
    canonicalSchedule: readCanonicalSchedule(tournament.settings),
    operationalConditions,
  });
}

export interface ScheduleOptimizationProposedDiff extends ScheduleOptimizationResult {
  beforeCanonical: CanonicalScheduleSnapshot;
  afterCanonical: CanonicalScheduleSnapshot;
  moved: ScheduleMove[];
  inputVersion: string;
  resultVersion: string;
}

export interface ScheduleOptimizationRecommendation {
  recommendationType: typeof SCHEDULE_OPTIMIZATION_TYPE;
  inputSnapshot: ScheduleOptimizationRecommendationInput;
  explanation: string;
  constraintsConsidered: string[];
  confidence: number;
  warnings: string[];
  proposedDiff: ScheduleOptimizationProposedDiff;
}

function canonicalInput(input: ScheduleOptimizationRecommendationInput) {
  return {
    tournamentId: input.tournamentId,
    optimizerInput: {
      ...input.optimizerInput,
      blockedRings: [...input.optimizerInput.blockedRings].sort((a, b) => a - b),
      ringDelayMinutes: Object.fromEntries(Object.entries(input.optimizerInput.ringDelayMinutes)
        .sort(([a], [b]) => Number(a) - Number(b))),
      divisions: input.optimizerInput.divisions.map((division) => ({
        ...division,
        eligibleRings: [...division.eligibleRings].sort((a, b) => a - b),
        registrationIds: [...division.registrationIds].sort(),
        conflictGroupIds: [...division.conflictGroupIds].sort(),
      })).sort((a, b) => a.divisionId.localeCompare(b.divisionId)),
    },
    evidence: {
      athleteIdentityCoverage: input.evidence.athleteIdentityCoverage,
      conflictGroupCoverage: input.evidence.conflictGroupCoverage,
      durationCoverage: input.evidence.durationCoverage,
      liveDelaySources: [...input.evidence.liveDelaySources].sort((a, b) => a.ring - b.ring || a.source.localeCompare(b.source)),
      incidentSources: [...input.evidence.incidentSources].sort((a, b) => a.incidentId.localeCompare(b.incidentId)),
    },
  };
}

export function scheduleOptimizationInputVersion(input: ScheduleOptimizationRecommendationInput): string {
  return createHash('sha256').update(JSON.stringify(canonicalInput(input))).digest('hex');
}

function toCanonical(
  rows: ScheduleOptimizationResult['before']['schedule'],
  input: ScheduleOptimizerInput,
): CanonicalScheduleSnapshot {
  const durationById = new Map(input.divisions.map((division) => [division.divisionId, division.durationMinutes]));
  return {
    version: 1,
    rows: rows.map((row) => ({
      divisionId: row.divisionId,
      ring: row.ring,
      startMinutes: row.startMinutes,
      durationMinutes: durationById.get(row.divisionId)!,
      locked: row.locked,
    })).sort((a, b) => a.divisionId.localeCompare(b.divisionId)),
  };
}

function buildDiff(input: ScheduleOptimizationRecommendationInput): ScheduleOptimizationProposedDiff {
  const result = optimizeTournamentSchedule(input.optimizerInput);
  if (!result.improved) throw new Error('No safer measurable improvement was found for the current schedule');
  const beforeCanonical = toCanonical(result.before.schedule, input.optimizerInput);
  const afterCanonical = toCanonical(result.after.schedule, input.optimizerInput);
  assertCanonicalLocksPreserved(beforeCanonical, afterCanonical);
  const beforeById = new Map(result.before.schedule.map((row) => [row.divisionId, row]));
  const moved = result.after.schedule.flatMap((row) => {
    const before = beforeById.get(row.divisionId)!;
    if (before.ring === row.ring && before.startMinutes === row.startMinutes) return [];
    return [{
      divisionId: row.divisionId,
      divisionName: row.divisionName,
      before: { ring: before.ring, startMinutes: before.startMinutes },
      after: { ring: row.ring, startMinutes: row.startMinutes },
    }];
  });
  const inputVersion = scheduleOptimizationInputVersion(input);
  const resultVersion = canonicalScheduleVersion(afterCanonical);
  return { ...result, beforeCanonical, afterCanonical, moved, inputVersion, resultVersion };
}

export function buildScheduleOptimizationRecommendation(
  input: ScheduleOptimizationRecommendationInput,
): ScheduleOptimizationRecommendation {
  if (input.tournamentId !== input.optimizerInput.tournamentId) throw new Error('Schedule optimizer tournament identity does not match');
  const proposedDiff = buildDiff(input);
  const removedAthleteConflicts = proposedDiff.before.metrics.athleteConflicts - proposedDiff.after.metrics.athleteConflicts;
  const removedGroupConflicts = proposedDiff.before.metrics.conflictGroupConflicts - proposedDiff.after.metrics.conflictGroupConflicts;
  const known = input.evidence.athleteIdentityCoverage.known + input.evidence.durationCoverage.known;
  const total = input.evidence.athleteIdentityCoverage.total + input.evidence.durationCoverage.total;
  return {
    recommendationType: SCHEDULE_OPTIMIZATION_TYPE,
    inputSnapshot: input,
    explanation: `Deterministic proposal removes ${removedAthleteConflicts} known athlete/rest conflict${removedAthleteConflicts === 1 ? '' : 's'} and ${removedGroupConflicts} known school or coach-group conflict${removedGroupConflicts === 1 ? '' : 's'}, while moving ${proposedDiff.moved.length} division${proposedDiff.moved.length === 1 ? '' : 's'}.`,
    constraintsConsidered: [
      `${input.optimizerInput.restWindowMinutes}-minute athlete rest window`,
      'Manual schedule locks are immutable',
      'Eligible and incident-blocked rings are hard constraints',
      'Known school or coach-group conflicts cannot increase',
      'Live ring delay violations cannot increase',
    ],
    // Recommendation persistence requires this field. The UI must label it
    // input completeness, never AI confidence.
    confidence: total === 0 ? 0 : known / total,
    warnings: [
      ...(!input.evidence.conflictGroupCoverage.coachDataAvailable
        ? ['Coach identity is not available; conflict groups currently use known school data only.']
        : []),
      'Deterministic means reproducible, not automatically correct. A director must review and approve every move.',
    ],
    proposedDiff,
  };
}

export function validateScheduleOptimizationSnapshot(
  currentInput: ScheduleOptimizationRecommendationInput,
  storedDiff: ScheduleOptimizationProposedDiff,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  let current: ScheduleOptimizationProposedDiff;
  try {
    current = buildDiff(currentInput);
  } catch (error) {
    return { valid: false, errors: [error instanceof Error ? error.message : 'Schedule optimization cannot be reproduced'] };
  }
  if (current.inputVersion !== storedDiff.inputVersion) errors.push('Schedule optimization inputs changed');
  if (current.resultVersion !== storedDiff.resultVersion
    || JSON.stringify(current.afterCanonical) !== JSON.stringify(storedDiff.afterCanonical)
    || JSON.stringify(current.beforeCanonical) !== JSON.stringify(storedDiff.beforeCanonical)) {
    errors.push('Proposed schedule output changed');
  }
  return { valid: errors.length === 0, errors };
}

async function lockScheduleOptimizationInputs(db: ScheduleOptimizationDatabase, tournamentId: string): Promise<void> {
  if (!('$queryRawUnsafe' in db)) return;
  await db.$queryRawUnsafe('SELECT id FROM "Tournament" WHERE id = $1 FOR UPDATE', tournamentId);
  await db.$queryRawUnsafe('SELECT id FROM "Division" WHERE "tournamentId" = $1 AND "deletedAt" IS NULL ORDER BY id FOR UPDATE', tournamentId);
  await db.$queryRawUnsafe('SELECT a.id FROM "DivisionAssignment" a JOIN "Division" d ON d.id = a."divisionId" WHERE d."tournamentId" = $1 ORDER BY a.id FOR UPDATE OF a', tournamentId);
  await db.$queryRawUnsafe('SELECT r.id FROM "Registration" r WHERE r."tournamentId" = $1 ORDER BY r.id FOR UPDATE', tournamentId);
  await db.$queryRawUnsafe('SELECT c.id FROM "Competitor" c JOIN "Registration" r ON r."competitorId" = c.id WHERE r."tournamentId" = $1 ORDER BY c.id FOR UPDATE OF c', tournamentId);
  // Incident rows are authoritative optimizer inputs. Lock every current row for
  // the tournament so a concurrent resolution/edit cannot invalidate live-ring
  // evidence between validation and canonical schedule persistence.
  await db.$queryRawUnsafe('SELECT i.id FROM "Incident" i WHERE i."tournamentId" = $1 ORDER BY i.id FOR UPDATE OF i', tournamentId);
}

export async function validateScheduleOptimizationRecommendation(
  db: ScheduleOptimizationDatabase,
  recommendation: RecommendationValidationInput,
) {
  if (recommendation.recommendationType !== SCHEDULE_OPTIMIZATION_TYPE) {
    return { valid: false, validator: 'schedule-optimization-v1', inputVersion: 'invalid-type', errors: ['Unsupported recommendation type'] };
  }
  await lockScheduleOptimizationInputs(db, recommendation.tournamentId);
  const current = await loadScheduleOptimizationInput(db, recommendation.tournamentId);
  const validation = validateScheduleOptimizationSnapshot(
    current,
    recommendation.proposedDiff as ScheduleOptimizationProposedDiff,
  );
  return {
    ...validation,
    validator: 'schedule-optimization-v1',
    inputVersion: scheduleOptimizationInputVersion(current),
  };
}

export async function createScheduleOptimizationRecommendation(
  prisma: PrismaClient,
  tournamentId: string,
  createdBy: string,
  now = new Date(),
  generate: ScheduleGenerator = generateSchedule,
) {
  const proposal = buildScheduleOptimizationRecommendation(
    await loadScheduleOptimizationInput(prisma, tournamentId, now, generate),
  );
  return createRecommendation(prisma, {
    tournamentId,
    recommendationType: proposal.recommendationType,
    inputSnapshot: proposal.inputSnapshot,
    explanation: proposal.explanation,
    constraintsConsidered: proposal.constraintsConsidered,
    confidence: proposal.confidence,
    warnings: proposal.warnings,
    proposedDiff: proposal.proposedDiff,
    createdBy,
  }, validateScheduleOptimizationRecommendation);
}

export async function applyScheduleOptimizationRecommendation(
  prisma: PrismaClient,
  recommendationId: string,
  appliedBy: string,
) {
  return applyApprovedRecommendation(prisma, recommendationId, appliedBy, async (tx, recommendation) => {
    if (recommendation.recommendationType !== SCHEDULE_OPTIMIZATION_TYPE) {
      throw new Error('Recommendation is not a schedule optimization proposal');
    }
    const proposed = JSON.parse(recommendation.proposedDiff) as ScheduleOptimizationProposedDiff;
    const tournament = await tx.tournament.findUnique({ where: { id: recommendation.tournamentId }, select: { settings: true } });
    if (!tournament) throw new Error('Tournament not found');
    const afterState = mergeCanonicalScheduleSettings(tournament.settings, proposed.afterCanonical);
    const updated = await tx.tournament.updateMany({
      where: { id: recommendation.tournamentId, settings: tournament.settings },
      data: { settings: afterState },
    });
    if (updated.count !== 1) throw new Error('Schedule optimization inputs changed before application');
    return {
      appliedResult: {
        moved: proposed.moved,
        beforeMetrics: proposed.before.metrics,
        afterMetrics: proposed.after.metrics,
        canonicalScheduleVersion: proposed.resultVersion,
      },
      beforeState: tournament.settings,
      afterState,
      undoReference: `schedule-recommendation:${recommendation.id}`,
    };
  }, validateScheduleOptimizationRecommendation);
}

export async function undoScheduleOptimizationRecommendation(
  prisma: PrismaClient,
  tournamentId: string,
  recommendationId: string,
  undoneBy: string,
  now = new Date(),
): Promise<void> {
  if (!undoneBy.trim()) throw new Error('Undo identity is required');
  await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtext($1))', recommendationId);
    const recommendation = await tx.recommendation.findFirst({
      where: { id: recommendationId, tournamentId, recommendationType: SCHEDULE_OPTIMIZATION_TYPE },
      select: { id: true, tournamentId: true, recommendationType: true, status: true, operationAuditId: true, undoReference: true },
    });
    if (!recommendation || recommendation.status !== 'applied' || !recommendation.operationAuditId
      || recommendation.undoReference !== `schedule-recommendation:${recommendation.id}`) {
      throw new Error('Schedule optimization cannot be undone');
    }
    const audit = await tx.tournamentOperationAudit.findFirst({
      where: { id: recommendation.operationAuditId, tournamentId },
    });
    if (!audit || !audit.reversible) throw new Error('Schedule optimization cannot be undone');
    if (audit.undoneAt) return;
    const beforeState = audit.beforeState === null ? null : JSON.parse(audit.beforeState) as string | null;
    const afterState = audit.afterState === null ? null : JSON.parse(audit.afterState) as string | null;
    if ((beforeState !== null && typeof beforeState !== 'string') || (afterState !== null && typeof afterState !== 'string')) {
      throw new Error('Schedule optimization audit is invalid');
    }
    const tournament = await tx.tournament.findUnique({ where: { id: tournamentId }, select: { settings: true } });
    if (!tournament || tournament.settings !== afterState) throw new Error('Schedule changed after this optimization; undo is unsafe');
    const restored = await tx.tournament.updateMany({
      where: { id: tournamentId, settings: afterState },
      data: { settings: beforeState },
    });
    if (restored.count !== 1) throw new Error('Schedule changed after this optimization; undo is unsafe');
    const marked = await tx.tournamentOperationAudit.updateMany({
      where: { id: audit.id, undoneAt: null },
      data: { undoneAt: now, undoneBy },
    });
    if (marked.count !== 1) throw new Error('Schedule optimization cannot be undone');
  }, { isolationLevel: 'Serializable' });
}

export async function saveScheduleOperationalConditions(
  prisma: PrismaClient,
  tournamentId: string,
  input: ScheduleOperationalConditionsInput,
  now = new Date(),
) {
  return prisma.$transaction(async (tx) => {
    const tournament = await tx.tournament.findUniqueOrThrow({ where: { id: tournamentId }, select: { settings: true } });
    const ringCount = readStoredScheduleConfig(tournament.settings).ringCount;
    if (!Number.isInteger(input.restWindowMinutes) || input.restWindowMinutes < 0 || input.restWindowMinutes > 240) {
      throw new Error('Rest window must be between 0 and 240 minutes');
    }
    if (new Set(input.ringDelays.map((entry) => entry.ring)).size !== input.ringDelays.length) throw new Error('Ring delays contain duplicate rings');
    if (new Set(input.incidentBlocks.map((entry) => entry.incidentId)).size !== input.incidentBlocks.length) throw new Error('Incident blocks contain duplicate incidents');
    for (const entry of input.ringDelays) {
      if (!Number.isInteger(entry.ring) || entry.ring < 1 || entry.ring > ringCount
        || !Number.isInteger(entry.delayMinutes) || entry.delayMinutes < 0 || entry.delayMinutes > 240
        || 'source' in entry) {
        throw new Error('Ring delay is invalid');
      }
    }
    for (const entry of input.incidentBlocks) {
      if (!entry.incidentId.trim() || !Number.isInteger(entry.ring) || entry.ring < 1 || entry.ring > ringCount) {
        throw new Error('Incident block is invalid');
      }
    }
    const incidents = input.incidentBlocks.length === 0 ? [] : await tx.incident.findMany({
      where: {
        id: { in: input.incidentBlocks.map((entry) => entry.incidentId) },
        tournamentId,
        deletedAt: null,
        actionTaken: null,
      },
      select: { id: true, type: true, severity: true },
    });
    if (incidents.length !== input.incidentBlocks.length) {
      throw new Error('Every blocked-ring incident must be unresolved and belong to this tournament');
    }
    const incidentById = new Map(incidents.map((incident) => [incident.id, incident]));
    let settings: Record<string, unknown> = {};
    if (tournament.settings) {
      try {
        const parsed = JSON.parse(tournament.settings);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
        settings = parsed as Record<string, unknown>;
      } catch {
        throw new Error('Tournament settings require repair before saving live conditions');
      }
    }
    const observedAt = now.toISOString();
    const scheduleOperations: ScheduleOperationalConditions = {
      restWindowMinutes: input.restWindowMinutes,
      liveDelaySources: input.ringDelays.map((entry) => ({ ...entry, source: 'director-confirmed' as const, observedAt })),
      incidentSources: input.incidentBlocks.map((entry) => {
        const incident = incidentById.get(entry.incidentId)!;
        return { ...entry, observedAt, label: `${incident.type} (${incident.severity})` };
      }),
    };
    const updatedSettings = JSON.stringify({ ...settings, scheduleOperations });
    return tx.tournament.update({ where: { id: tournamentId }, data: { settings: updatedSettings } });
  }, { isolationLevel: 'Serializable' });
}
