import { PrismaClient } from '@prisma/client';
import { AppError, ErrorCode } from '../utils/errors.js';

/**
 * State backup for recovery purposes
 */
export interface TournamentBackup {
  tournamentId: string;
  timestamp: Date;
  /**
   * Shape version. Absent (v1) backups predate match/format capture: their
   * brackets carry only the structure JSON. v2 adds bracket format, matches
   * and the division soft-delete/fairness fields.
   */
  version?: 2;
  divisions: DivisionBackup[];
}

export interface MatchBackup {
  id: string;
  roundNumber: number;
  matchNumber: number;
  bracketType: string;
  competitor1Id: string | null;
  competitor2Id: string | null;
  winnerId: string | null;
  score1: string | null;
  score2: string | null;
  status: string;
  scheduledTime: Date | string | null;
  ringNumber: number | null;
  notes: string | null;
  videoUrl: string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface DivisionBackup {
  id: string;
  name: string;
  beltLevel: string;
  gender: string;
  eventType: string;
  ageMin: number;
  ageMax: number;
  beltColors: string | null;
  danMin: number | null;
  danMax: number | null;
  weightClass: string | null;
  divisionNumber: number;
  isSpecialNeeds: boolean;
  displayOrder: number | null;
  // v2 fields (optional so v1 backups still type-check and restore)
  deletedAt?: Date | string | null;
  createdAt?: Date | string;
  bracketDifficulty?: number | null;
  matchupQuality?: number | null;
  avgSkillRating?: number | null;
  assignments: Array<{
    registrationId: string;
    seedPosition: number | null;
    manualOverride: boolean;
  }>;
  bracket?: {
    id: string;
    structure: string;
    format?: string;
    /** v2: every match with its result. Absent in v1 backups. */
    matches?: MatchBackup[];
  };
}

/**
 * Interactive-transaction budget for a restore. A tournament restore
 * recreates every division, assignment, bracket and match; Prisma's default
 * 5 s timeout rolled a large one back half-way through.
 */
export const RESTORE_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 120_000 } as const;

function toDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(value);
}

/**
 * Create a backup of tournament division state
 */
export async function backupDivisionState(
  prisma: PrismaClient,
  tournamentId: string
): Promise<TournamentBackup> {
  const divisions = await prisma.division.findMany({
    where: { tournamentId },
    include: {
      assignments: {
        select: {
          registrationId: true,
          seedPosition: true,
          manualOverride: true,
        },
      },
      bracket: {
        select: {
          id: true,
          structure: true,
          format: true,
          matches: {
            select: {
              id: true,
              roundNumber: true,
              matchNumber: true,
              bracketType: true,
              competitor1Id: true,
              competitor2Id: true,
              winnerId: true,
              score1: true,
              score2: true,
              status: true,
              scheduledTime: true,
              ringNumber: true,
              notes: true,
              videoUrl: true,
              createdAt: true,
              updatedAt: true,
            },
            orderBy: { matchNumber: 'asc' },
          },
        },
      },
    },
  });

  return {
    tournamentId,
    timestamp: new Date(),
    version: 2,
    divisions: divisions.map((d) => ({
      id: d.id,
      name: d.name,
      beltLevel: d.beltLevel,
      gender: d.gender,
      eventType: d.eventType,
      ageMin: d.ageMin,
      ageMax: d.ageMax,
      beltColors: d.beltColors,
      danMin: d.danMin,
      danMax: d.danMax,
      weightClass: d.weightClass,
      divisionNumber: d.divisionNumber,
      isSpecialNeeds: d.isSpecialNeeds,
      displayOrder: d.displayOrder,
      deletedAt: d.deletedAt,
      createdAt: d.createdAt,
      bracketDifficulty: d.bracketDifficulty,
      matchupQuality: d.matchupQuality,
      avgSkillRating: d.avgSkillRating,
      assignments: d.assignments,
      bracket: d.bracket || undefined,
    })),
  };
}

/**
 * Restore tournament division state from backup.
 *
 * Divisions, brackets and matches keep their original ids, so rows that
 * reference them without a foreign key (MatchAuditLog.matchId,
 * MatchupHistory, CompetitorHistory) stay linked. All-or-nothing: any row
 * that cannot be recreated (e.g. a registration deleted since the backup)
 * rolls the whole restore back and leaves the current state untouched.
 *
 * v1 backups (no `matches` on the bracket) cannot reproduce match rows; their
 * brackets are skipped (an empty bracket would block regeneration) and the
 * division is reported in `errors` so the director regenerates it.
 */
export async function restoreDivisionState(
  prisma: PrismaClient,
  backup: TournamentBackup
): Promise<{ restored: number; errors: string[] }> {
  const errors: string[] = [];
  let restored = 0;

  await prisma.$transaction(async (tx) => {
    // Clear current divisions
    await tx.division.deleteMany({
      where: { tournamentId: backup.tournamentId },
    });

    // Restore each division
    for (const div of backup.divisions) {
      // Any failure must escape the transaction. Catching per-division errors
      // commits a partial restore after the current state has been deleted.
      const createdAt = toDate(div.createdAt);
      const division = await tx.division.create({
          data: {
            id: div.id,
            tournamentId: backup.tournamentId,
            name: div.name,
            beltLevel: div.beltLevel,
            gender: div.gender,
            eventType: div.eventType,
            ageMin: div.ageMin,
            ageMax: div.ageMax,
            beltColors: div.beltColors,
            danMin: div.danMin,
            danMax: div.danMax,
            weightClass: div.weightClass,
            divisionNumber: div.divisionNumber,
            isSpecialNeeds: div.isSpecialNeeds,
            displayOrder: div.displayOrder,
            deletedAt: toDate(div.deletedAt),
            ...(createdAt ? { createdAt } : {}),
            bracketDifficulty: div.bracketDifficulty ?? null,
            matchupQuality: div.matchupQuality ?? null,
            avgSkillRating: div.avgSkillRating ?? null,
          },
      });

      // Restore assignments
      for (const assignment of div.assignments) {
        await tx.divisionAssignment.create({
            data: {
              divisionId: division.id,
              registrationId: assignment.registrationId,
              seedPosition: assignment.seedPosition,
              manualOverride: assignment.manualOverride,
            },
        });
      }

      // Restore bracket (with its matches and results) if it exists
      const bracket = div.bracket;
      if (bracket && !Array.isArray(bracket.matches)) {
        errors.push(
          `Division "${div.name}": its bracket was backed up without match data (older backup format) and was not restored; regenerate it.`,
        );
      } else if (bracket) {
        await tx.bracket.create({
            data: {
              id: bracket.id,
              divisionId: division.id,
              structure: bracket.structure,
              ...(bracket.format ? { format: bracket.format } : {}),
            },
        });
        const matches = bracket.matches ?? [];
        if (matches.length > 0) {
          await tx.match.createMany({
            data: matches.map((m) => {
              const matchCreatedAt = toDate(m.createdAt);
              const matchUpdatedAt = toDate(m.updatedAt);
              return {
                id: m.id,
                bracketId: bracket.id,
                roundNumber: m.roundNumber,
                matchNumber: m.matchNumber,
                bracketType: m.bracketType,
                competitor1Id: m.competitor1Id,
                competitor2Id: m.competitor2Id,
                winnerId: m.winnerId,
                score1: m.score1,
                score2: m.score2,
                status: m.status,
                scheduledTime: toDate(m.scheduledTime),
                ringNumber: m.ringNumber,
                notes: m.notes,
                videoUrl: m.videoUrl,
                ...(matchCreatedAt ? { createdAt: matchCreatedAt } : {}),
                ...(matchUpdatedAt ? { updatedAt: matchUpdatedAt } : {}),
              };
            }),
          });
        }
      }

      restored++;
    }
  }, RESTORE_TRANSACTION_OPTIONS);

  return { restored, errors };
}

/**
 * Persistent backup storage. Closes D3, B27, S21.
 *
 * History: the original implementation kept backups in a
 * module-level Map, which meant any restart (deploy, OOM, crash)
 * dropped every backup. The Restore endpoint silently returned
 * "no backup" after a redeploy, defeating the feature.
 *
 * New implementation: a JSON column on the `BackupState` table
 * (one row per tournament). Replaces the previous file-based
 * BACKUP_DIR/<tournamentId>.json store (day-2 follow-up "move
 * backupStore to DB table"). The DB-backed approach is the
 * "proper" fix: backups now survive container restarts on any
 * host (no filesystem persistence dependency), can be inspected
 * via SQL, and are backed up by the same nightly DB backup
 * that covers the rest of the data. The interface
 * (saveBackup / getBackup) is unchanged.
 */

// BACKUP_DIR was the old file-based store's directory. The DB-backed
// BackupState table replaces it. Kept as a comment for the day-2
// migration history; can be deleted in a follow-up once we're sure
// no leftover files exist on the VPS.
//
// const BACKUP_DIR = process.env.BACKUP_DIR
//   ? path.resolve(process.env.BACKUP_DIR)
//   : path.resolve(process.cwd(), 'data', 'backups');

/**
 * Save backup. Now async + DB-backed: INSERT … ON CONFLICT
 * (tournamentId) DO UPDATE so the row is overwritten in place.
 * One round-trip per save; the payload is a single ~10 KB column.
 * Closes day-2 follow-up: move backupStore to DB table.
 *
 * Throws when the backup cannot be stored. Callers run it BEFORE a
 * destructive operation, so a failed save aborts the operation instead
 * of deleting data while claiming a backup exists.
 */
export async function saveBackup(
  prisma: PrismaClient,
  backup: TournamentBackup
): Promise<void> {
  try {
    await prisma.backupState.upsert({
      where: { tournamentId: backup.tournamentId },
      create: {
        tournamentId: backup.tournamentId,
        payload: JSON.stringify(backup),
      },
      update: {
        payload: JSON.stringify(backup),
        updatedAt: new Date(),
      },
    });
  } catch (err) {
    console.error(`[backup-recovery] saveBackup failed for ${backup.tournamentId}:`, err);
    throw new AppError(
      'Could not save a recovery backup; nothing was changed.',
      ErrorCode.DATABASE_ERROR,
      503,
      { recoverable: true, suggestion: 'Try again. If it keeps failing, export your data before retrying.' },
    );
  }
}

/**
 * Get backup from the DB. Returns undefined if no backup exists
 * OR if the payload is corrupt. Errors are logged but never
 * thrown — the caller's rollback flow treats "no backup" the
 * same as "corrupt backup".
 */
export async function getBackup(
  prisma: PrismaClient,
  tournamentId: string
): Promise<TournamentBackup | undefined> {
  try {
    const row = await prisma.backupState.findUnique({
      where: { tournamentId },
    });
    if (!row) return undefined;
    return JSON.parse(row.payload) as TournamentBackup;
  } catch (err: unknown) {
    console.error(`[backup-recovery] getBackup failed for ${tournamentId}:`, err);
    return undefined;
  }
}

/**
 * Drop a backup (used after a successful restore, so the next
 * bad regeneration doesn't restore the same state again).
 */
export async function clearBackup(
  prisma: PrismaClient,
  tournamentId: string
): Promise<void> {
  try {
    await prisma.backupState.delete({
      where: { tournamentId },
    });
  } catch (err: unknown) {
    // P2025 = "record not found" — same as ENOENT for our purposes.
    // Prisma's error shape uses a string `code`, so narrow it without
    // dragging the whole Prisma error class into this catch.
    const code = (err as { code?: unknown } | null)?.code;
    if (code !== 'P2025') {
      console.error(`[backup-recovery] clearBackup failed for ${tournamentId}:`, err);
      throw err;
    }
  }
}

/**
 * Restore the currently saved artifact and clear it only after the entire
 * transactional restore succeeds. A rejected restore deliberately leaves the
 * artifact available for investigation and another recovery attempt.
 */
export async function restoreSavedDivisionBackup(
  prisma: PrismaClient,
  tournamentId: string
): Promise<{ restored: number; errors: string[] } | undefined> {
  const backup = await getBackup(prisma, tournamentId);
  if (!backup) return undefined;
  const result = await restoreDivisionState(prisma, backup);
  await clearBackup(prisma, tournamentId);
  return result;
}

/**
 * Check if operation would lose data and return warning
 */
export async function checkDataLoss(
  prisma: PrismaClient,
  tournamentId: string,
  operation: 'regenerate_divisions' | 'regenerate_brackets' | 'delete_divisions'
): Promise<{
  wouldLoseData: boolean;
  warning?: string;
  affectedItems: number;
}> {
  switch (operation) {
    case 'regenerate_divisions': {
      const divisions = await prisma.division.findMany({
        where: { tournamentId },
        include: {
          bracket: true,
          assignments: { where: { manualOverride: true } },
        },
      });

      const withBrackets = divisions.filter((d) => d.bracket);
      const withManualOverrides = divisions.filter(
        (d) => d.assignments.length > 0
      );

      if (withBrackets.length > 0) {
        return {
          wouldLoseData: true,
          warning: `This will delete ${withBrackets.length} existing bracket(s). Match results will be lost.`,
          affectedItems: withBrackets.length,
        };
      }

      if (withManualOverrides.length > 0) {
        return {
          wouldLoseData: true,
          warning: `This will reset ${withManualOverrides.length} manual competitor placements.`,
          affectedItems: withManualOverrides.length,
        };
      }

      return { wouldLoseData: false, affectedItems: divisions.length };
    }

    case 'regenerate_brackets': {
      const matches = await prisma.match.findMany({
        where: {
          bracket: {
            division: { tournamentId },
          },
          status: { in: ['completed', 'in_progress'] },
        },
      });

      if (matches.length > 0) {
        return {
          wouldLoseData: true,
          warning: `This will delete ${matches.length} match result(s).`,
          affectedItems: matches.length,
        };
      }

      return { wouldLoseData: false, affectedItems: 0 };
    }

    case 'delete_divisions': {
      const divisions = await prisma.division.count({
        where: { tournamentId },
      });

      return {
        wouldLoseData: divisions > 0,
        warning: divisions > 0
          ? `This will delete ${divisions} division(s) and all associated data.`
          : undefined,
        affectedItems: divisions,
      };
    }

    default:
      return { wouldLoseData: false, affectedItems: 0 };
  }
}

/**
 * Validate tournament state for operation
 */
export async function validateTournamentState(
  prisma: PrismaClient,
  tournamentId: string,
  requiredState: 'has_registrations' | 'has_divisions' | 'has_brackets'
): Promise<{ valid: boolean; message?: string }> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: {
      registrations: { take: 1 },
      divisions: {
        take: 1,
        include: { bracket: true },
      },
    },
  });

  if (!tournament) {
    return { valid: false, message: 'Tournament not found' };
  }

  switch (requiredState) {
    case 'has_registrations':
      if (tournament.registrations.length === 0) {
        return {
          valid: false,
          message: 'No competitors are registered for this tournament',
        };
      }
      break;

    case 'has_divisions':
      if (tournament.divisions.length === 0) {
        return {
          valid: false,
          message: 'No divisions have been created for this tournament',
        };
      }
      break;

    case 'has_brackets':
      const hasBrackets = tournament.divisions.some((d) => d.bracket);
      if (!hasBrackets) {
        return {
          valid: false,
          message: 'No brackets have been generated for this tournament',
        };
      }
      break;
  }

  return { valid: true };
}
