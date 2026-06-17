import { Router } from 'express';
import type { Request, Response } from 'express-serve-static-core';
import { PrismaClient } from '@prisma/client';
import { autoCategorize, previewCategorization, type CategorizationConfig } from '../services/categorization-engine.js';
import { getBracketPlacementsEnriched } from '../services/match-advancement.js';
import { getSportProfile } from '../../shared/constants/sport-profiles.js';
import { Errors } from '../utils/errors.js';
import {
  checkDataLoss,
  validateTournamentState,
  backupDivisionState,
  saveBackup,
  getBackup,
  restoreDivisionState,
} from '../services/backup-recovery.js';
import { authenticate, requireRole, type AuthenticatedRequest } from '../middleware/auth.js';
import { z } from 'zod';
import { validateRequest } from '../middleware/validate.js';

const router = Router();

// Helper to safely get string param
const getParam = (param: string | string[] | undefined): string => {
  if (Array.isArray(param)) return param[0];
  return param || '';
};

// Validation schemas
const divisionCreateSchema = z.object({
  tournamentId: z.string().min(1),
  name: z.string().min(1),
  beltLevel: z.string().min(1),
  gender: z.string().min(1),
  eventType: z.string().min(1),
  ageMin: z.number().int().min(0),
  ageMax: z.number().int().min(0),
  beltColors: z.string().optional(),
  danMin: z.number().int().optional(),
  danMax: z.number().int().optional(),
  weightClass: z.string().optional(),
  divisionNumber: z.number().int().optional(),
  isSpecialNeeds: z.boolean().optional(),
});

const divisionUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  beltLevel: z.string().min(1).optional(),
  gender: z.string().min(1).optional(),
  eventType: z.string().min(1).optional(),
  ageMin: z.number().int().min(0).optional(),
  ageMax: z.number().int().min(0).optional(),
  weightClass: z.string().optional(),
  isSpecialNeeds: z.boolean().optional(),
  beltColors: z.string().optional(),
  danMin: z.number().int().optional(),
  danMax: z.number().int().optional(),
  divisionNumber: z.number().int().optional(),
  displayOrder: z.number().int().optional(),
});

// Get divisions for a tournament (requires authentication)
router.get('/tournament/:tournamentId', authenticate, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const withMatches = req.query.withMatches === 'true';

  const divisions = await prisma.division.findMany({
    where: { tournamentId: getParam(req.params.tournamentId) },
    include: {
      _count: {
        select: { assignments: true },
      },
      bracket: withMatches ? {
        include: {
          matches: {
            include: {
              competitor1: { include: { competitor: true } },
              competitor2: { include: { competitor: true } },
            },
            orderBy: [{ roundNumber: 'asc' }, { matchNumber: 'asc' }],
          },
        },
      } : true,
    },
    orderBy: [
      { beltLevel: 'asc' },
      { gender: 'asc' },
      { eventType: 'asc' },
      { ageMin: 'asc' },
      { displayOrder: 'asc' },
    ],
  });

  // The Results page reads bracket.placements. Placements are computed from
  // the bracket's match results (winnerId of finals), not stored on the
  // bracket model. Compute them here so the response shape matches the
  // client's expectations.
  if (withMatches) {
    await Promise.all(
      divisions.map(async (d: any) => {
        if (d.bracket?.id) {
          d.bracket.placements = await getBracketPlacementsEnriched(prisma, d.bracket.id);
        }
      })
    );
  }

  res.json(divisions);
});

// Get single division with competitors (requires authentication)
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  const division = await prisma.division.findUnique({
    where: { id: getParam(req.params.id) },
    include: {
      assignments: {
        include: {
          registration: {
            include: {
              competitor: true,
            },
          },
        },
        orderBy: { seedPosition: 'asc' },
      },
      bracket: {
        include: {
          matches: {
            include: {
              competitor1: { include: { competitor: true } },
              competitor2: { include: { competitor: true } },
            },
            orderBy: [{ roundNumber: 'asc' }, { matchNumber: 'asc' }],
          },
        },
      },
    },
  });

  if (!division) {
    return res.status(404).json({ error: 'Division not found' });
  }

  res.json(division);
});

// Preview divisions before generating (requires authentication + admin/director role)
router.post('/tournament/:tournamentId/preview', authenticate, requireRole('admin', 'director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { config } = req.body;

  const tournament = await prisma.tournament.findUnique({
    where: { id: getParam(req.params.tournamentId) },
  });

  if (!tournament) {
    return res.status(404).json({ error: 'Tournament not found' });
  }

  // Get all registrations with competitor data
  const registrations = await prisma.registration.findMany({
    where: { tournamentId: getParam(req.params.tournamentId) },
    include: { competitor: true },
  });

  if (registrations.length === 0) {
    return res.json({
      divisions: [],
      totalCompetitors: 0,
      warnings: ['No registrations found for this tournament'],
    });
  }

  // Derive event type labels from sport profile
  const sportProfile = getSportProfile(tournament.sportProfileSlug || 'taekwondo');
  const eventTypeLabels = sportProfile
    ? { patterns: sportProfile.eventTypes[0]?.name ?? 'Patterns', sparring: sportProfile.eventTypes[1]?.name ?? 'Sparring' }
    : undefined;

  // Fetch custom weight classes from DB
  const customWeightClasses = await prisma.weightClass.findMany({
    where: { tournamentId: getParam(req.params.tournamentId) },
  });

  // Run preview (no database changes)
  const categorizationConfig: CategorizationConfig = {
    divisionThreshold: config?.divisionThreshold ?? 8,
    ...config,
    eventTypeLabels,
    customWeightClasses: customWeightClasses.length > 0 ? customWeightClasses : undefined,
  };

  const preview = previewCategorization(registrations, categorizationConfig);
  res.json(preview);
});

// Check if regenerating divisions would lose data (requires authentication)
router.get('/tournament/:tournamentId/check-data-loss', authenticate, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const tournamentId = getParam(req.params.tournamentId);

  const dataLoss = await checkDataLoss(prisma, tournamentId, 'regenerate_divisions');
  res.json(dataLoss);
});

// Auto-generate divisions for tournament (requires authentication + admin/director role)
router.post('/tournament/:tournamentId/auto-generate', authenticate, requireRole('admin', 'director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const tournamentId = getParam(req.params.tournamentId);
  const { config, force = false } = req.body;

  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
  });

  if (!tournament) {
    throw Errors.tournamentNotFound(tournamentId);
  }

  // Validate state
  const validation = await validateTournamentState(prisma, tournamentId, 'has_registrations');
  if (!validation.valid) {
    throw Errors.noRegistrations(tournament.name);
  }

  // Check for data loss unless forced
  if (!force) {
    const dataLoss = await checkDataLoss(prisma, tournamentId, 'regenerate_divisions');
    if (dataLoss.wouldLoseData) {
      return res.status(409).json({
        error: 'Operation would cause data loss',
        code: 'DATA_LOSS_WARNING',
        warning: dataLoss.warning,
        affectedItems: dataLoss.affectedItems,
        recoverable: true,
        suggestion: 'Set "force: true" to proceed anyway, or export data first',
      });
    }
  }

  // Create backup before modifying
  const backup = await backupDivisionState(prisma, tournamentId);
  saveBackup(backup);

  // Get all registrations with competitor data
  const registrations = await prisma.registration.findMany({
    where: { tournamentId },
    include: { competitor: true },
  });

  // Derive event type labels from sport profile
  const sportProfile = getSportProfile(tournament.sportProfileSlug || 'taekwondo');
  const eventTypeLabels = sportProfile
    ? { patterns: sportProfile.eventTypes[0]?.name ?? 'Patterns', sparring: sportProfile.eventTypes[1]?.name ?? 'Sparring' }
    : undefined;

  // Fetch custom weight classes from DB
  const customWeightClasses = await prisma.weightClass.findMany({
    where: { tournamentId },
  });

  // Load tournament rules from settings (with default fallback)
  const { parseTournamentRules } = await import('../../shared/constants/tournament-rules.js');
  const rules = parseTournamentRules(tournament.settings);

  // Run auto-categorization
  const categorizationConfig: CategorizationConfig = {
    divisionThreshold: config?.divisionThreshold ?? rules.divisions.maxDivisionSize,
    enableSmartSplitting: rules.divisions.splitBy !== 'age',
    enableSmartMerging: rules.divisions.minDivisionSize > 1,
    enableAgeBoundaryFlex: rules.divisions.ageFlexMonths > 0,
    ageBoundaryTolerance: rules.divisions.ageFlexMonths,
    useBlackBeltAgeGroups: rules.ageBands.preset === 'blackBelt',
    customAgeGroups: rules.ageBands.customBands,
    eventTypeLabels,
    customWeightClasses: customWeightClasses.length > 0 ? customWeightClasses : undefined,
    // v2: pass the full rules object
    rules,
  };

  const result = await autoCategorize(prisma, tournamentId, registrations, categorizationConfig);

  res.json({
    ...result,
    backupAvailable: true,
    message: `Generated ${result.divisions} divisions with ${result.assignments} assignments`,
  });
});

// Create manual division (requires authentication + admin/director role)
router.post('/', authenticate, requireRole('admin', 'director'), validateRequest(divisionCreateSchema), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const {
    tournamentId,
    name,
    beltLevel,
    gender,
    eventType,
    ageMin,
    ageMax,
    beltColors,
    danMin,
    danMax,
    weightClass,
    divisionNumber,
    isSpecialNeeds,
  } = req.body;

  const division = await prisma.division.create({
    data: {
      tournamentId,
      name,
      beltLevel,
      gender,
      eventType,
      ageMin,
      ageMax,
      beltColors: beltColors ? JSON.stringify(beltColors) : null,
      danMin,
      danMax,
      weightClass,
      divisionNumber: divisionNumber ?? 1,
      isSpecialNeeds: isSpecialNeeds ?? false,
    },
  });

  res.status(201).json(division);
});

// Update division (requires authentication + admin/director role)
router.put('/:id', authenticate, requireRole('admin', 'director'), validateRequest(divisionUpdateSchema), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const {
    name,
    ageMin,
    ageMax,
    beltColors,
    danMin,
    danMax,
    weightClass,
    divisionNumber,
    isSpecialNeeds,
    displayOrder,
  } = req.body;

  const division = await prisma.division.update({
    where: { id: getParam(req.params.id) },
    data: {
      name,
      ageMin,
      ageMax,
      beltColors: beltColors ? JSON.stringify(beltColors) : undefined,
      danMin,
      danMax,
      weightClass,
      divisionNumber,
      isSpecialNeeds,
      displayOrder,
    },
  });

  res.json(division);
});

// Delete division (requires authentication + admin/director role)
router.delete('/:id', authenticate, requireRole('admin', 'director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const divisionId = getParam(req.params.id);
  const force = req.query.force === 'true';

  const division = await prisma.division.findUnique({
    where: { id: divisionId },
    include: {
      bracket: {
        include: {
          matches: { where: { status: { in: ['completed', 'in_progress'] } } },
        },
      },
    },
  });

  if (!division) {
    throw Errors.divisionNotFound(divisionId);
  }

  // Check if bracket has results
  if (!force && division.bracket && division.bracket.matches.length > 0) {
    return res.status(409).json({
      error: 'Division has match results',
      code: 'DIVISION_HAS_RESULTS',
      warning: `Division "${division.name}" has ${division.bracket.matches.length} completed match(es)`,
      recoverable: true,
      suggestion: 'Add ?force=true to delete anyway',
    });
  }

  await prisma.division.delete({
    where: { id: divisionId },
  });

  res.json({ deleted: true, name: division.name });
});

// Clear all divisions for a tournament (requires authentication)
router.delete('/tournament/:tournamentId/all', authenticate, requireRole('admin', 'director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const tournamentId = getParam(req.params.tournamentId);
  const force = req.query.force === 'true';

  // Check for data loss unless forced
  if (!force) {
    const dataLoss = await checkDataLoss(prisma, tournamentId, 'delete_divisions');
    if (dataLoss.wouldLoseData) {
      return res.status(409).json({
        error: 'Operation would cause data loss',
        code: 'DATA_LOSS_WARNING',
        warning: dataLoss.warning,
        affectedItems: dataLoss.affectedItems,
        recoverable: true,
        suggestion: 'Add ?force=true to proceed anyway',
      });
    }
  }

  // Create backup before deleting
  const backup = await backupDivisionState(prisma, tournamentId);
  saveBackup(backup);

  const result = await prisma.division.deleteMany({
    where: { tournamentId },
  });

  res.json({
    deleted: result.count,
    backupAvailable: true,
    message: `Deleted ${result.count} division(s)`,
  });
});

// Assign competitor to division (requires authentication)
router.post('/:id/assign', authenticate, requireRole('admin', 'director', 'scorekeeper'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { registrationId, seedPosition, manualOverride } = req.body;

  const assignment = await prisma.divisionAssignment.create({
    data: {
      divisionId: getParam(req.params.id),
      registrationId,
      seedPosition,
      manualOverride: manualOverride ?? true,
    },
    include: {
      registration: {
        include: { competitor: true },
      },
    },
  });

  res.status(201).json(assignment);
});

// Remove competitor from division (requires authentication)
router.delete('/:id/assign/:assignmentId', authenticate, requireRole('admin', 'director', 'scorekeeper'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  await prisma.divisionAssignment.delete({
    where: { id: getParam(req.params.assignmentId) },
  });

  res.status(204).send();
});

// Move competitor between divisions (requires authentication)
router.post('/:id/move', authenticate, requireRole('admin', 'director', 'scorekeeper'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { assignmentId, toDivisionId } = req.body;

  const assignment = await prisma.divisionAssignment.update({
    where: { id: assignmentId },
    data: {
      divisionId: toDivisionId,
      manualOverride: true,
    },
    include: {
      registration: {
        include: { competitor: true },
      },
    },
  });

  res.json(assignment);
});

// Split division (requires authentication + admin/director role)
router.post('/:id/split', authenticate, requireRole('admin', 'director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { splitCount = 2 } = req.body;

  const division = await prisma.division.findUnique({
    where: { id: getParam(req.params.id) },
    include: {
      assignments: {
        include: {
          registration: { include: { competitor: true } },
        },
      },
    },
  });

  if (!division) {
    return res.status(404).json({ error: 'Division not found' });
  }

  const assignments = division.assignments;
  const perDivision = Math.ceil(assignments.length / splitCount);

  // Create new divisions and reassign
  const newDivisions = [];

  for (let i = 0; i < splitCount; i++) {
    const isFirst = i === 0;
    const newDivision = isFirst
      ? division
      : await prisma.division.create({
          data: {
            tournamentId: division.tournamentId,
            name: `${division.name.replace(/ DIV\d+$/, '')} DIV${i + 1}`,
            beltLevel: division.beltLevel,
            gender: division.gender,
            eventType: division.eventType,
            ageMin: division.ageMin,
            ageMax: division.ageMax,
            beltColors: division.beltColors,
            danMin: division.danMin,
            danMax: division.danMax,
            weightClass: division.weightClass,
            divisionNumber: i + 1,
            isSpecialNeeds: division.isSpecialNeeds,
          },
        });

    // Update first division name if needed
    if (isFirst && !division.name.includes('DIV')) {
      await prisma.division.update({
        where: { id: division.id },
        data: { name: `${division.name} DIV1`, divisionNumber: 1 },
      });
    }

    const divisionAssignments = assignments.slice(i * perDivision, (i + 1) * perDivision);

    // Move assignments to new division
    if (!isFirst) {
      for (const assignment of divisionAssignments) {
        await prisma.divisionAssignment.update({
          where: { id: assignment.id },
          data: { divisionId: newDivision.id },
        });
      }
    }

    newDivisions.push(newDivision);
  }

  res.json(newDivisions);
});

// Get current backup state for a tournament (requires authentication)
router.get('/tournament/:tournamentId/backup', authenticate, async (req: Request, res: Response) => {
  const tournamentId = getParam(req.params.tournamentId);
  const backup = getBackup(tournamentId);

  if (!backup) {
    return res.status(404).json({
      error: 'No backup found',
      code: 'NO_BACKUP',
      suggestion: 'Backups are created automatically before auto-generation or clearing divisions',
    });
  }

  res.json({
    tournamentId: backup.tournamentId,
    timestamp: backup.timestamp,
    divisionCount: backup.divisions.length,
  });
});

// Restore tournament divisions from backup (requires authentication + admin/director role)
router.post('/tournament/:tournamentId/restore', authenticate, requireRole('admin', 'director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const tournamentId = getParam(req.params.tournamentId);

  const backup = getBackup(tournamentId);

  if (!backup) {
    return res.status(404).json({
      error: 'No backup found to restore',
      code: 'NO_BACKUP',
      suggestion: 'Backups are created automatically before auto-generation or clearing divisions',
    });
  }

  const result = await restoreDivisionState(prisma, backup);

  res.json({
    ...result,
    message: `Restored ${result.restored} division(s)`,
  });
});

export default router;
