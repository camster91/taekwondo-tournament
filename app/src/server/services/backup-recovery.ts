import { PrismaClient } from '@prisma/client';

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
  assignments: Array<{
    registrationId: string;
    seedPosition: number | null;
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

  // Clear current divisions
  await prisma.division.deleteMany({
    where: { tournamentId: backup.tournamentId },
  });

  // Restore each division
  for (const div of backup.divisions) {
    try {
      // Create division
      const division = await prisma.division.create({
        data: {
          id: div.id,
          tournamentId: backup.tournamentId,
          name: div.name,
          beltLevel: 'CB', // Will need full backup to restore these
          gender: 'M',
          eventType: 'patterns',
          ageMin: 0,
          ageMax: 99,
        },
      });

      // Restore assignments
      for (const assignment of div.assignments) {
        await prisma.divisionAssignment.create({
          data: {
            divisionId: division.id,
            registrationId: assignment.registrationId,
            seedPosition: assignment.seedPosition,
          },
        });
      }

      // Restore bracket if exists
      if (div.bracket) {
        await prisma.bracket.create({
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

  return { restored, errors };
}

/**
 * In-memory backup storage (for session-based recovery)
 * In production, this should be persisted to Redis or database
 */
const backupStore = new Map<string, TournamentBackup>();

/**
 * Save backup to store
 */
export function saveBackup(backup: TournamentBackup): void {
  backupStore.set(backup.tournamentId, backup);
}

/**
 * Get backup from store
 */
export function getBackup(tournamentId: string): TournamentBackup | undefined {
  return backupStore.get(tournamentId);
}

/**
 * Clear backup from store
 */
export function clearBackup(tournamentId: string): void {
  backupStore.delete(tournamentId);
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
