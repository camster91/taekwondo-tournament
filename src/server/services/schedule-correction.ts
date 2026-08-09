import type { PrismaClient } from '@prisma/client';
import { invalidateScheduleRecommendations } from './schedule-recommendation-invalidation.js';
import { createHash } from 'node:crypto';
import { DEFAULT_CONFIG, type ScheduleConfig, type TournamentSchedule } from './schedule-generator.js';

export interface ScheduleImpact {
  affectedDivisionIds: string[];
  affectedLabels: string[];
  ringChanges: number;
  timeChanges: number;
  addedWarnings: string[];
  removedWarnings: string[];
}

function parseSettings(raw: string | null, strict = false): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    if (strict) throw new Error('Tournament settings require repair before changing the schedule');
    return {};
  } catch {
    if (strict) throw new Error('Tournament settings require repair before changing the schedule');
    return {};
  }
}

export interface ScheduleInputDivision {
  id: string;
  name: string;
  eventType: string;
  beltLevel: string;
  gender: string;
  ageMin: number;
  ageMax: number;
  assignments: Array<{
    registrationId: string;
    registration?: { competitor: { firstName: string; lastName: string } };
  }>;
}

export function scheduleInputVersion(divisions: ScheduleInputDivision[]): string {
  const stable = divisions
    .map((division) => ({
      ...division,
      assignments: division.assignments.map(({ registrationId, registration }) => ({
        registrationId,
        firstName: registration?.competitor.firstName ?? '',
        lastName: registration?.competitor.lastName ?? '',
      })).sort((a, b) => a.registrationId.localeCompare(b.registrationId)),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

export function scheduleResultVersion(result: Pick<TournamentSchedule, 'schedule' | 'warnings'>): string {
  return createHash('sha256').update(JSON.stringify(result)).digest('hex');
}

export function readStoredScheduleConfig(raw: string | null): ScheduleConfig {
  const settings = parseSettings(raw);
  const saved = settings.schedule;
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
    const legacy = settings.rings;
    if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) return DEFAULT_CONFIG;
    const rings = legacy as { count?: unknown; startTime?: unknown; endTime?: unknown };
    return {
      ...DEFAULT_CONFIG,
      ringCount: typeof rings.count === 'number' ? rings.count : DEFAULT_CONFIG.ringCount,
      startTime: typeof rings.startTime === 'string' ? rings.startTime : DEFAULT_CONFIG.startTime,
      endTime: typeof rings.endTime === 'string' ? rings.endTime : DEFAULT_CONFIG.endTime,
    };
  }
  const value = saved as Partial<ScheduleConfig>;
  return {
    ...DEFAULT_CONFIG,
    ...value,
    matchDurationMinutes: {
      ...DEFAULT_CONFIG.matchDurationMinutes,
      ...(value.matchDurationMinutes ?? {}),
    },
  };
}

export function mergeScheduleSettings(raw: string | null, config: ScheduleConfig): string {
  const current = parseSettings(raw, true);
  // A configuration regeneration creates a new generated schedule. An older
  // optimized row snapshot cannot remain authoritative against that new
  // configuration, so invalidate it atomically with the confirmed change.
  const { canonicalSchedule: _staleCanonicalSchedule, ...preserved } = current;
  return JSON.stringify({
    ...preserved,
    schedule: config,
    rings: { count: config.ringCount, startTime: config.startTime, endTime: config.endTime },
  });
}

export function buildScheduleImpact(
  before: Pick<TournamentSchedule, 'schedule' | 'warnings'>,
  after: Pick<TournamentSchedule, 'schedule' | 'warnings'>,
): ScheduleImpact {
  const beforeById = new Map(before.schedule.map((row) => [row.divisionId, row]));
  const affected = after.schedule.filter((row) => {
    const previous = beforeById.get(row.divisionId);
    return !previous || previous.ring !== row.ring || previous.startTime !== row.startTime || previous.endTime !== row.endTime;
  });
  return {
    affectedDivisionIds: affected.map((row) => row.divisionId),
    affectedLabels: affected.map((row) => row.divisionName),
    ringChanges: affected.filter((row) => beforeById.get(row.divisionId)?.ring !== row.ring).length,
    timeChanges: affected.filter((row) => {
      const previous = beforeById.get(row.divisionId);
      return !previous || previous.startTime !== row.startTime || previous.endTime !== row.endTime;
    }).length,
    addedWarnings: after.warnings.filter((warning) => !before.warnings.includes(warning)),
    removedWarnings: before.warnings.filter((warning) => !after.warnings.includes(warning)),
  };
}

interface ApplyScheduleInput {
  tournamentId: string;
  config: ScheduleConfig;
  expectedUpdatedAt: string;
  approvedBy: string;
  impact: ScheduleImpact;
  expectedInputVersion: string;
  resultVersion: string;
  operationKey: string;
}

function operationEvidence(input: ApplyScheduleInput) {
  return {
    config: input.config,
    expectedUpdatedAt: input.expectedUpdatedAt,
    expectedInputVersion: input.expectedInputVersion,
    resultVersion: input.resultVersion,
  };
}

export async function applyScheduleCorrection(prisma: PrismaClient, input: ApplyScheduleInput): Promise<{ auditId: string; alreadyApplied?: boolean; impact?: ScheduleImpact }> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.tournamentOperationAudit.findUnique({ where: { operationKey: input.operationKey } });
    if (existing) {
      if (existing.tournamentId !== input.tournamentId || existing.operationType !== 'schedule_regeneration') {
        throw new Error('Schedule operation key is already in use');
      }
      const stored = parseSettings(existing.impactSummary);
      if (JSON.stringify(stored._operation) !== JSON.stringify(operationEvidence(input)) || existing.undoneAt) {
        throw new Error('Schedule operation key is already in use');
      }
      const { _operation: _storedOperation, ...storedImpact } = stored;
      return { auditId: existing.id, alreadyApplied: true, impact: storedImpact as unknown as ScheduleImpact };
    }
    const tournament = await tx.tournament.findUnique({
      where: { id: input.tournamentId },
      select: {
        id: true, settings: true, updatedAt: true,
        divisions: {
          where: { deletedAt: null },
          select: {
            id: true, name: true, eventType: true, beltLevel: true, gender: true, ageMin: true, ageMax: true,
            assignments: { select: { registrationId: true, registration: { select: { competitor: { select: { firstName: true, lastName: true } } } } } },
          },
        },
      },
    });
    if (!tournament) throw new Error('Tournament not found');
    if (tournament.updatedAt.toISOString() !== input.expectedUpdatedAt
      || scheduleInputVersion(tournament.divisions) !== input.expectedInputVersion) {
      throw new Error('Schedule preview is stale');
    }
    const afterState = mergeScheduleSettings(tournament.settings, input.config);
    const updated = await tx.tournament.updateMany({
      where: { id: input.tournamentId, updatedAt: new Date(input.expectedUpdatedAt) },
      data: { settings: afterState },
    });
    if (updated.count !== 1) throw new Error('Schedule preview is stale');
    await invalidateScheduleRecommendations(tx, input.tournamentId);
    const audit = await tx.tournamentOperationAudit.create({
      data: {
        tournamentId: input.tournamentId,
        operationType: 'schedule_regeneration',
        operationKey: input.operationKey,
        beforeState: tournament.settings,
        afterState,
        impactSummary: JSON.stringify({ ...input.impact, _operation: operationEvidence(input) }),
        reversible: true,
        createdBy: input.approvedBy,
      },
    });
    return { auditId: audit.id };
  }, { isolationLevel: 'Serializable' });
}

export async function undoScheduleCorrection(
  prisma: PrismaClient,
  auditId: string,
  undoneBy: string,
  now = new Date(),
  expectedTournamentId?: string,
): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      const audit = await tx.tournamentOperationAudit.findUnique({ where: { id: auditId } });
      if (!audit || audit.operationType !== 'schedule_regeneration' || !audit.reversible
        || (expectedTournamentId && audit.tournamentId !== expectedTournamentId)) {
        throw new Error('Schedule change cannot be undone');
      }
      if (audit.undoneAt) return;
      const tournament = await tx.tournament.findUnique({ where: { id: audit.tournamentId }, select: { id: true, settings: true } });
      if (!tournament || tournament.settings !== audit.afterState) throw new Error('Schedule changed after this operation; undo is unsafe');
      const restored = await tx.tournament.updateMany({
        where: { id: audit.tournamentId, settings: audit.afterState }, data: { settings: audit.beforeState },
      });
      if (restored.count !== 1) throw new Error('Schedule changed after this operation; undo is unsafe');
      await invalidateScheduleRecommendations(tx, audit.tournamentId, now);
      const marked = await tx.tournamentOperationAudit.updateMany({
        where: { id: audit.id, undoneAt: null }, data: { undoneAt: now, undoneBy },
      });
      if (marked.count !== 1) throw new Error('Schedule change cannot be undone');
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    const current = await prisma.tournamentOperationAudit.findUnique({ where: { id: auditId } });
    if (current?.undoneAt && (!expectedTournamentId || current.tournamentId === expectedTournamentId)) return;
    throw error;
  }
}

export async function getScheduleOperationStatus(prisma: PrismaClient, tournamentId: string, operationKey: string) {
  const audit = await prisma.tournamentOperationAudit.findUnique({ where: { operationKey } });
  if (!audit || audit.tournamentId !== tournamentId || audit.operationType !== 'schedule_regeneration') return null;
  return { auditId: audit.id, applied: true, undone: Boolean(audit.undoneAt), createdAt: audit.createdAt.toISOString() };
}
