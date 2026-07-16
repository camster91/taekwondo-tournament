import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

/**
 * State backup for recovery purposes
 */
export interface TournamentBackup {
  tournamentId: string;
  timestamp: Date;
  divisions: DivisionBackup[];
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
  assignments: Array<{
    registrationId: string;
    seedPosition: number | null;
    manualOverride: boolean;
  }>;
  bracket?: {
    id: string;
    structure: string;
  };
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
        },
      },
    },
  });

  return {
    tournamentId,
    timestamp: new Date(),
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
      assignments: d.assignments,
      bracket: d.bracket || undefined,
    })),
  };
}

/**
 * Restore tournament division state from backup
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
      try {
        // Create division
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

        // Restore bracket if exists
        if (div.bracket) {
          await tx.bracket.create({
            data: {
              id: div.bracket.id,
              divisionId: division.id,
              structure: div.bracket.structure,
            },
          });
        }

        restored++;
      } catch (error: any) {
        errors.push(`Failed to restore ${div.name}: ${error.message}`);
      }
    }
  });

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
 * New implementation: a JSON file on disk. Each tournament's
 * backup is at <BACKUP_DIR>/<tournamentId>.json. The dir defaults
 * to a sibling of the data dir, override with BACKUP_DIR env.
 *
 * Why file and not DB? A new `BackupState` table would be the
 * "proper" fix and is on the day-2 list. A JSON file is
 * good enough for now: the rollback path is rare, the
 * payload per backup is small (one tournament's division
 * tree, typically <10 KB), and it survives every failure
 * mode that drops in-memory state. The interface
 * (saveBackup / getBackup) is the same as the Map, so the
 * eventual DB migration is a one-line change.
 */

const BACKUP_DIR = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.resolve(process.cwd(), 'data', 'backups');

function ensureDir(): void {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  } catch (err) {
    console.error(`[backup-recovery] could not create ${BACKUP_DIR}:`, err);
  }
}

function backupFilePath(tournamentId: string): string {
  // Sanitize: tournamentId is a UUID in practice but guard against
  // path traversal from a malformed value.
  const safe = tournamentId.replace(/[^a-zA-Z0-9-]/g, '_');
  return path.join(BACKUP_DIR, `${safe}.json`);
}

/**
 * Save backup to disk. Synchronous write so a deploy restart right
 * after the call still has the file. Cost is one ~10 KB write per
 * tournament regeneration.
 */
export function saveBackup(backup: TournamentBackup): void {
  ensureDir();
  try {
    fs.writeFileSync(
      backupFilePath(backup.tournamentId),
      JSON.stringify(backup),
      { mode: 0o600 }
    );
  } catch (err) {
    console.error(`[backup-recovery] saveBackup failed for ${backup.tournamentId}:`, err);
  }
}

/**
 * Get backup from disk. Returns undefined if no backup exists OR
 * if the file is unreadable (corrupt / perms). Errors are logged
 * but never thrown — the caller's rollback flow treats "no
 * backup" the same as "corrupt backup".
 */
export function getBackup(tournamentId: string): TournamentBackup | undefined {
  try {
    const raw = fs.readFileSync(backupFilePath(tournamentId), 'utf-8');
    return JSON.parse(raw) as TournamentBackup;
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      console.error(`[backup-recovery] getBackup failed for ${tournamentId}:`, err);
    }
    return undefined;
  }
}

/**
 * Drop a backup (used after a successful restore, so the next
 * bad regeneration doesn't restore the same state again).
 */
export function clearBackup(tournamentId: string): void {
  try {
    fs.unlinkSync(backupFilePath(tournamentId));
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      console.error(`[backup-recovery] clearBackup failed for ${tournamentId}:`, err);
    }
  }
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
