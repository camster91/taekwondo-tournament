import type { Prisma, PrismaClient } from '@prisma/client';
import { readCanonicalSchedule, type CanonicalScheduleSnapshot, mergeCanonicalScheduleSettings, canonicalScheduleVersion } from './canonical-schedule.js';
import { invalidateScheduleRecommendations } from './schedule-recommendation-invalidation.js';

export interface ScheduleDelayInput {
  tournamentId: string;
  delayType: 'ring' | 'division';
  ringNumber?: number; // Required if delayType === 'ring'
  divisionId?: string; // Required if delayType === 'division'
  delayMinutes: number;
  reason: string;
}

export interface ScheduleDelayImpact {
  affectedDivisionIds: string[];
  affectedDivisionNames: string[];
  divisionMoves: Array<{
    divisionId: string;
    divisionName: string;
    oldStartTime: string;
    newStartTime: string;
    oldEndTime: string;
    newEndTime: string;
    ring: number;
  }>;
  warnings: string[];
  endTimeOverruns: string[];
  conflicts: Array<{
    type: 'overlap' | 'athlete_conflict';
    description: string;
    divisionIds: string[];
  }>;
}

export interface ScheduleDelayPreview {
  before: CanonicalScheduleSnapshot;
  after: CanonicalScheduleSnapshot;
  impact: ScheduleDelayImpact;
  expectedUpdatedAt: string;
  expectedInputVersion: string;
  operationKey: string;
}

export interface ApplyDelayInput {
  tournamentId: string;
  delayInput: ScheduleDelayInput;
  expectedUpdatedAt: string;
  expectedInputVersion: string;
  operationKey: string;
  approvedBy: string;
}

function parseSettings(raw: string | null, strict = false): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    if (strict) throw new Error('Tournament settings require repair before applying delay');
    return {};
  } catch {
    if (strict) throw new Error('Tournament settings require repair before applying delay');
    return {};
  }
}

function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Calculate delay propagation: shift eligible downstream divisions deterministically.
 * Preserve completed and in-progress matches by only moving "pending" divisions.
 */
async function calculateDelayPropagation(
  prisma: PrismaClient | Prisma.TransactionClient,
  tournamentId: string,
  delayInput: ScheduleDelayInput,
  currentCanonical: CanonicalScheduleSnapshot,
): Promise<{ after: CanonicalScheduleSnapshot; impact: ScheduleDelayImpact }> {
  // Get tournament config to check end time
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: {
      settings: true,
      divisions: {
        where: { deletedAt: null },
        select: {
          id: true,
          name: true,
          bracket: {
            select: {
              matches: {
                where: {
                  OR: [
                    { status: 'in_progress' },
                    { status: 'completed' },
                  ],
                },
                select: { id: true, status: true },
              },
            },
          },
          assignments: {
            select: {
              registrationId: true,
            },
          },
        },
      },
    },
  });

  if (!tournament) throw new Error('Tournament not found');

  const settings = parseSettings(tournament.settings);
  const scheduleConfig = settings.schedule as { endTime?: string } | undefined;
  const endMinutes = scheduleConfig?.endTime ? timeToMinutes(scheduleConfig.endTime) : 17 * 60; // Default 17:00

  // Build set of divisions with completed or in-progress matches (cannot be moved)
  const lockedDivisionIds = new Set<string>();
  for (const division of tournament.divisions) {
    if (division.bracket?.matches && division.bracket.matches.length > 0) {
      lockedDivisionIds.add(division.id);
    }
  }

  // Build registry of division metadata
  const divisionRegistry = new Map(
    tournament.divisions.map((d) => [
      d.id,
      {
        name: d.name,
        registrationIds: d.assignments.map((a) => a.registrationId),
      },
    ]),
  );

  // Sort canonical schedule by start time, then ring
  const sortedRows = [...currentCanonical.rows].sort(
    (a, b) => a.startMinutes - b.startMinutes || a.ring - b.ring,
  );

  // Identify the divisions affected by the delay
  let affectedStartMinutes: number;
  let affectedRing: number | null = null;

  if (delayInput.delayType === 'ring' && delayInput.ringNumber !== undefined) {
    // Ring delay: find the first pending division in that ring
    affectedRing = delayInput.ringNumber;
    const firstPendingInRing = sortedRows.find(
      (row) => row.ring === affectedRing && !lockedDivisionIds.has(row.divisionId),
    );
    if (!firstPendingInRing) {
      // No pending divisions in this ring
      return {
        after: currentCanonical,
        impact: {
          affectedDivisionIds: [],
          affectedDivisionNames: [],
          divisionMoves: [],
          warnings: [`No pending divisions found in Ring ${affectedRing}; no changes needed.`],
          endTimeOverruns: [],
          conflicts: [],
        },
      };
    }
    affectedStartMinutes = firstPendingInRing.startMinutes;
  } else if (delayInput.delayType === 'division' && delayInput.divisionId) {
    // Division-specific delay
    const targetRow = sortedRows.find((row) => row.divisionId === delayInput.divisionId);
    if (!targetRow) throw new Error('Division not found in schedule');
    if (lockedDivisionIds.has(delayInput.divisionId)) {
      throw new Error('Cannot delay a division with completed or in-progress matches');
    }
    affectedStartMinutes = targetRow.startMinutes;
    affectedRing = targetRow.ring;
  } else {
    throw new Error('Invalid delay input');
  }

  // Propagate delay: shift all eligible downstream divisions
  const newRows: typeof currentCanonical.rows = [];
  const divisionMoves: ScheduleDelayImpact['divisionMoves'] = [];
  const warnings: string[] = [];
  const endTimeOverruns: string[] = [];

  for (const row of sortedRows) {
    const isInAffectedRing = affectedRing === null || row.ring === affectedRing;
    const isDownstream = row.startMinutes >= affectedStartMinutes;
    const isLocked = row.locked || lockedDivisionIds.has(row.divisionId);

    if (isInAffectedRing && isDownstream && !isLocked) {
      // Apply delay
      const oldStartMinutes = row.startMinutes;
      const newStartMinutes = oldStartMinutes + delayInput.delayMinutes;
      const newEndMinutes = newStartMinutes + row.durationMinutes;

      const divisionName = divisionRegistry.get(row.divisionId)?.name ?? row.divisionId;

      newRows.push({
        ...row,
        startMinutes: newStartMinutes,
      });

      divisionMoves.push({
        divisionId: row.divisionId,
        divisionName,
        oldStartTime: minutesToTime(oldStartMinutes),
        newStartTime: minutesToTime(newStartMinutes),
        oldEndTime: minutesToTime(oldStartMinutes + row.durationMinutes),
        newEndTime: minutesToTime(newEndMinutes),
        ring: row.ring,
      });

      // Check for end-of-day overrun
      if (newEndMinutes > endMinutes) {
        endTimeOverruns.push(
          `${divisionName} (Ring ${row.ring}) now ends at ${minutesToTime(newEndMinutes)}, after tournament end time ${minutesToTime(endMinutes)}`,
        );
      }
    } else {
      newRows.push(row);
    }
  }

  // Detect conflicts: athlete double-booking
  const conflicts: ScheduleDelayImpact['conflicts'] = [];
  const timeSlotsByAthlete = new Map<string, Array<{ ring: number; startMinutes: number; endMinutes: number; divisionId: string; divisionName: string }>>();

  for (const row of newRows) {
    const division = divisionRegistry.get(row.divisionId);
    if (!division) continue;

    const endMinutes = row.startMinutes + row.durationMinutes;
    for (const registrationId of division.registrationIds) {
      const slots = timeSlotsByAthlete.get(registrationId) ?? [];
      // Check for overlaps
      for (const existingSlot of slots) {
        if (
          row.startMinutes < existingSlot.endMinutes &&
          endMinutes > existingSlot.startMinutes
        ) {
          conflicts.push({
            type: 'athlete_conflict',
            description: `Athlete double-booked: ${division.name} (Ring ${row.ring}, ${minutesToTime(row.startMinutes)}-${minutesToTime(endMinutes)}) overlaps with ${existingSlot.divisionName} (Ring ${existingSlot.ring}, ${minutesToTime(existingSlot.startMinutes)}-${minutesToTime(existingSlot.endMinutes)})`,
            divisionIds: [row.divisionId, existingSlot.divisionId],
          });
        }
      }
      slots.push({ ring: row.ring, startMinutes: row.startMinutes, endMinutes, divisionId: row.divisionId, divisionName: division.name });
      timeSlotsByAthlete.set(registrationId, slots);
    }
  }

  if (endTimeOverruns.length > 0) {
    warnings.push(`${endTimeOverruns.length} division(s) extend past tournament end time after delay.`);
  }

  if (conflicts.length > 0) {
    warnings.push(`${conflicts.length} athlete conflict(s) detected after delay propagation.`);
  }

  return {
    after: { version: 1, rows: newRows },
    impact: {
      affectedDivisionIds: divisionMoves.map((m) => m.divisionId),
      affectedDivisionNames: divisionMoves.map((m) => m.divisionName),
      divisionMoves,
      warnings,
      endTimeOverruns,
      conflicts,
    },
  };
}

/**
 * Preview a schedule delay: calculate impact without applying changes.
 */
export async function previewScheduleDelay(
  prisma: PrismaClient,
  delayInput: ScheduleDelayInput,
): Promise<ScheduleDelayPreview> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: delayInput.tournamentId },
    select: { id: true, settings: true, updatedAt: true },
  });

  if (!tournament) throw new Error('Tournament not found');

  const currentCanonical = readCanonicalSchedule(tournament.settings);
  if (!currentCanonical) {
    throw new Error('No schedule exists for this tournament');
  }

  const { after, impact } = await calculateDelayPropagation(
    prisma,
    delayInput.tournamentId,
    delayInput,
    currentCanonical,
  );

  return {
    before: currentCanonical,
    after,
    impact,
    expectedUpdatedAt: tournament.updatedAt.toISOString(),
    expectedInputVersion: canonicalScheduleVersion(currentCanonical),
    operationKey: `delay-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
  };
}

/**
 * Apply a schedule delay after preview and confirmation.
 */
export async function applyScheduleDelay(
  prisma: PrismaClient,
  input: ApplyDelayInput,
): Promise<{ auditId: string; alreadyApplied?: boolean }> {
  return prisma.$transaction(
    async (tx) => {
      // Check for idempotency
      const existing = await tx.tournamentOperationAudit.findUnique({
        where: { operationKey: input.operationKey },
      });

      if (existing) {
        if (
          existing.tournamentId !== input.tournamentId ||
          existing.operationType !== 'schedule_delay_propagation'
        ) {
          throw new Error('Operation key is already in use');
        }
        if (existing.undoneAt) {
          throw new Error('Operation key is already in use');
        }
        return { auditId: existing.id, alreadyApplied: true };
      }

      // Verify tournament hasn't changed since preview
      const tournament = await tx.tournament.findUnique({
        where: { id: input.tournamentId },
        select: { id: true, settings: true, updatedAt: true },
      });

      if (!tournament) throw new Error('Tournament not found');

      if (tournament.updatedAt.toISOString() !== input.expectedUpdatedAt) {
        throw new Error('Schedule has changed since preview; regenerate and confirm again');
      }

      const currentCanonical = readCanonicalSchedule(tournament.settings);
      if (!currentCanonical) {
        throw new Error('No schedule exists for this tournament');
      }

      if (canonicalScheduleVersion(currentCanonical) !== input.expectedInputVersion) {
        throw new Error('Schedule has changed since preview; regenerate and confirm again');
      }

      // Recalculate propagation to ensure consistency
      const { after } = await calculateDelayPropagation(
        tx,
        input.tournamentId,
        input.delayInput,
        currentCanonical,
      );

      // Apply the new schedule
      const afterSettings = mergeCanonicalScheduleSettings(tournament.settings, after);

      await tx.tournament.updateMany({
        where: {
          id: input.tournamentId,
          updatedAt: new Date(input.expectedUpdatedAt),
        },
        data: { settings: afterSettings },
      });

      // Invalidate any existing optimization recommendations
      await invalidateScheduleRecommendations(tx, input.tournamentId);

      // Create audit record
      const audit = await tx.tournamentOperationAudit.create({
        data: {
          tournamentId: input.tournamentId,
          operationType: 'schedule_delay_propagation',
          operationKey: input.operationKey,
          beforeState: tournament.settings,
          afterState: afterSettings,
          impactSummary: JSON.stringify({
            delayType: input.delayInput.delayType,
            delayMinutes: input.delayInput.delayMinutes,
            reason: input.delayInput.reason,
            affectedCount: after.rows.length - currentCanonical.rows.length,
          }),
          reversible: true,
          createdBy: input.approvedBy,
        },
      });

      return { auditId: audit.id };
    },
    { isolationLevel: 'Serializable' },
  );
}

/**
 * Undo a schedule delay propagation.
 */
export async function undoScheduleDelay(
  prisma: PrismaClient,
  auditId: string,
  undoneBy: string,
  now = new Date(),
  expectedTournamentId?: string,
): Promise<void> {
  try {
    await prisma.$transaction(
      async (tx) => {
        const audit = await tx.tournamentOperationAudit.findUnique({
          where: { id: auditId },
        });

        if (
          !audit ||
          audit.operationType !== 'schedule_delay_propagation' ||
          !audit.reversible ||
          (expectedTournamentId && audit.tournamentId !== expectedTournamentId)
        ) {
          throw new Error('Delay propagation cannot be undone');
        }

        if (audit.undoneAt) return; // Already undone

        // Verify schedule hasn't changed since the delay was applied
        const tournament = await tx.tournament.findUnique({
          where: { id: audit.tournamentId },
          select: { id: true, settings: true },
        });

        if (!tournament || tournament.settings !== audit.afterState) {
          throw new Error('Schedule changed after this delay; undo is unsafe');
        }

        // Restore previous schedule
        const restored = await tx.tournament.updateMany({
          where: { id: audit.tournamentId, settings: audit.afterState },
          data: { settings: audit.beforeState },
        });

        if (restored.count !== 1) {
          throw new Error('Schedule changed after this delay; undo is unsafe');
        }

        // Invalidate recommendations
        await invalidateScheduleRecommendations(tx, audit.tournamentId, now);

        // Mark as undone
        const marked = await tx.tournamentOperationAudit.updateMany({
          where: { id: audit.id, undoneAt: null },
          data: { undoneAt: now, undoneBy },
        });

        if (marked.count !== 1) {
          throw new Error('Delay propagation cannot be undone');
        }
      },
      { isolationLevel: 'Serializable' },
    );
  } catch (error) {
    const current = await prisma.tournamentOperationAudit.findUnique({
      where: { id: auditId },
    });
    if (
      current?.undoneAt &&
      (!expectedTournamentId || current.tournamentId === expectedTournamentId)
    ) {
      return; // Already undone
    }
    throw error;
  }
}
