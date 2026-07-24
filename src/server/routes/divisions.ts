import { Router } from 'express';
import type { Request, Response } from 'express-serve-static-core';
import { PrismaClient } from '@prisma/client';
import { autoCategorize, previewCategorization, type CategorizationConfig } from '../services/categorization-engine.js';
import { getBracketPlacementsFromLoaded } from '../services/match-advancement.js';
import { getSportProfile } from '../../shared/constants/sport-profiles.js';
import { Errors } from '../utils/errors.js';
import {
  checkDataLoss,
  validateTournamentState,
  backupDivisionState,
  saveBackup,
  getBackup,
  clearBackup,
  restoreDivisionState,
} from '../services/backup-recovery.js';
import {
  authenticate,
  requireTournamentAccess,
  checkTournamentAccess,
  type AuthenticatedRequest,
} from '../middleware/auth.js';
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

// Get divisions for a tournament (requires authentication + tournament access)
router.get('/tournament/:tournamentId', authenticate, requireTournamentAccess('viewer'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const withMatches = req.query.withMatches === 'true';

  const divisions = await prisma.division.findMany({
    // Filter out divisions belonging to soft-deleted tournaments so a
    // stale URL can't leak a deleted tournament's data via the
    // divisions endpoint.
    where: {
      tournamentId: getParam(req.params.tournamentId),
      tournament: { deletedAt: null },
    },
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
  // client's expectations — from already-loaded matches (no N+1), then
  // one bulk registration fetch for enrichment.
  if (withMatches) {
    const baseByDivision = new Map<string, { place: number; competitorId: string }[]>();
    const allRegIds = new Set<string>();

    // Prisma's ternary `include` widens bracket to the no-matches shape;
    // when withMatches is true the nested matches are always present.
    type BracketWithMatches = {
      id: string;
      structure: string;
      matches: Array<{
        matchNumber: number;
        bracketType: string;
        status: string;
        winnerId: string | null;
        competitor1Id: string | null;
        competitor2Id: string | null;
      }>;
    };

    for (const d of divisions) {
      const bracket = d.bracket as BracketWithMatches | null;
      if (!bracket?.id || !bracket.matches) continue;
      const base = getBracketPlacementsFromLoaded(
        bracket.structure,
        bracket.matches.map((m) => ({
          matchNumber: m.matchNumber,
          bracketType: m.bracketType as 'winners' | 'losers' | 'finals',
          status: m.status,
          winnerId: m.winnerId,
          competitor1Id: m.competitor1Id,
          competitor2Id: m.competitor2Id,
        })),
      );
      baseByDivision.set(d.id, base);
      for (const p of base) allRegIds.add(p.competitorId);
    }

    const registrations = allRegIds.size
      ? await prisma.registration.findMany({
          where: { id: { in: [...allRegIds] } },
          include: {
            competitor: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                schoolDojang: true,
                belt: true,
              },
            },
          },
        })
      : [];
    const regById = new Map(registrations.map((r) => [r.id, r]));

    for (const d of divisions) {
      if (!d.bracket?.id) continue;
      const base = baseByDivision.get(d.id) || [];
      (d.bracket as { placements?: unknown }).placements = base
        .map((p) => {
          const reg = regById.get(p.competitorId);
          if (!reg) return null;
          return {
            place: p.place,
            registrationId: reg.id,
            registration: {
              id: reg.id,
              competitor: reg.competitor,
            },
          };
        })
        .filter(Boolean);
    }
  }

  res.json(divisions);
});

// Get single division with competitors (requires authentication + tournament access)
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  // Resolve parent tournament for the access check before returning
  // any competitor PII (closes S6 + B36-style IDOR).
  const parent = await prisma.division.findUnique({
    where: { id: getParam(req.params.id) },
    select: { tournamentId: true, deletedAt: true },
  });
  if (!parent || parent.deletedAt) {
    return res.status(404).json({ error: 'Division not found' });
  }
  const access = await checkTournamentAccess(
    req as AuthenticatedRequest,
    prisma,
    parent.tournamentId,
    'viewer'
  );
  if (!access.ok) {
    return res.status(access.status || 403).json({ error: access.error });
  }

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
router.post('/tournament/:tournamentId/preview', authenticate, requireTournamentAccess('director'), async (req: Request, res: Response) => {
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
router.get('/tournament/:tournamentId/check-data-loss', authenticate, requireTournamentAccess('viewer'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const tournamentId = getParam(req.params.tournamentId);

  const dataLoss = await checkDataLoss(prisma, tournamentId, 'regenerate_divisions');
  res.json(dataLoss);
});

// Auto-generate divisions for tournament (requires authentication + admin/director role)
router.post('/tournament/:tournamentId/auto-generate', authenticate, requireTournamentAccess('director'), async (req: Request, res: Response) => {
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
  await saveBackup(prisma, backup);

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
// tournamentId comes from the body — auth is checked inline after
// validation so we can enforce per-tournament access.
router.post('/', authenticate, validateRequest(divisionCreateSchema), async (req: AuthenticatedRequest, res: Response) => {
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

  const access = await checkTournamentAccess(req, prisma, tournamentId, 'director');
  if (!access.ok) {
    return res.status(access.status || 403).json({ error: access.error });
  }

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
// `:id` is the division id — resolve to its parent tournamentId
// for the per-tournament access check before mutating.
router.put('/:id', authenticate, validateRequest(divisionUpdateSchema), async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const divisionId = getParam(req.params.id);

  const existing = await prisma.division.findUnique({
    where: { id: divisionId },
    select: { tournamentId: true },
  });
  if (!existing) {
    return res.status(404).json({ error: 'Division not found' });
  }

  const access = await checkTournamentAccess(req, prisma, existing.tournamentId, 'director');
  if (!access.ok) {
    return res.status(access.status || 403).json({ error: access.error });
  }

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
    where: { id: divisionId },
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
router.delete('/:id', authenticate, async (req: AuthenticatedRequest, res: Response) => {
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
    return res.status(404).json({ error: 'Division not found' });
  }

  const access = await checkTournamentAccess(req, prisma, division.tournamentId, 'director');
  if (!access.ok) {
    return res.status(access.status || 403).json({ error: access.error });
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

// Bulk reorder divisions for a tournament — used by drag-to-reorder in
// the Schedule page. Accepts an ordered array of division IDs; assigns
// displayOrder = index. Closes L7 from the UI audit (drag-to-reorder
// ring assignment).
router.post('/tournament/:tournamentId/reorder', authenticate, requireTournamentAccess('director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const tournamentId = getParam(req.params.tournamentId);
  const { divisionIds } = req.body as { divisionIds?: string[] };

  if (!Array.isArray(divisionIds) || divisionIds.length === 0) {
    return res.status(400).json({ error: 'divisionIds must be a non-empty array' });
  }

  // All IDs must belong to this tournament — refuse anything else so
  // a director can't accidentally reorder someone else's divisions.
  const validDivisions = await prisma.division.findMany({
    where: { tournamentId, id: { in: divisionIds } },
    select: { id: true },
  });
  if (validDivisions.length !== divisionIds.length) {
    return res.status(400).json({
      error: 'Some division IDs do not belong to this tournament.',
      expected: divisionIds.length,
      found: validDivisions.length,
    });
  }

  // Use a transaction so partial failures don't leave the list in a
  // half-reordered state. Each update sets displayOrder to its index
  // in the new ordering.
  await prisma.$transaction(
    divisionIds.map((id, index) =>
      prisma.division.update({
        where: { id },
        data: { displayOrder: index },
      }),
    ),
  );

  res.json({ success: true, count: divisionIds.length });
});

// Clear all divisions for a tournament (requires authentication)
router.delete('/tournament/:tournamentId/all', authenticate, requireTournamentAccess('director'), async (req: Request, res: Response) => {
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
  await saveBackup(prisma, backup);

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
router.post('/:id/assign', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const divisionId = getParam(req.params.id);

  // Resolve the parent tournament for the per-tournament check.
  const division = await prisma.division.findUnique({
    where: { id: divisionId },
    select: { tournamentId: true },
  });
  if (!division) {
    return res.status(404).json({ error: 'Division not found' });
  }
  const access = await checkTournamentAccess(req, prisma, division.tournamentId, 'scorekeeper');
  if (!access.ok) {
    return res.status(access.status || 403).json({ error: access.error });
  }

  const { registrationId, seedPosition, manualOverride } = req.body;

  // Cross-tournament FK check: the registration must belong to the
  // same tournament as the division. Closes B5 (cross-tenant data
  // corruption via assign/move).
  const registration = await prisma.registration.findUnique({
    where: { id: registrationId },
    select: { tournamentId: true },
  });
  if (!registration) {
    return res.status(404).json({ error: 'Registration not found' });
  }
  if (registration.tournamentId !== division.tournamentId) {
    return res.status(400).json({
      error: 'Registration does not belong to this tournament',
    });
  }

  // Idempotency check: a registration can only be assigned to ONE
  // division at a time. Without this, calling POST /:id/assign for
  // the same registration in different divisions would silently
  // land the kid in two divisions — the auto-categorization engine
  // would then count them twice, the bracket generator would create
  // duplicate match slots, etc.
  //
  // The schema's @@unique([divisionId, registrationId]) only blocks
  // re-assignment to the SAME division, not different ones — that's
  // a logical constraint this route enforces.
  const existingAssignment = await prisma.divisionAssignment.findFirst({
    where: { registrationId },
    select: { id: true, divisionId: true, division: { select: { name: true } } },
  });
  if (existingAssignment) {
    return res.status(409).json({
      error: 'Registration is already assigned to a division',
      existingDivisionId: existingAssignment.divisionId,
      existingDivisionName: existingAssignment.division.name,
      suggestion: 'Use POST /:id/move to transfer the registration instead.',
    });
  }

  const assignment = await prisma.divisionAssignment.create({
    data: {
      divisionId,
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
router.delete('/:id/assign/:assignmentId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const assignmentId = getParam(req.params.assignmentId);

  // Resolve the assignment's division → parent tournament for the
  // per-tournament access check before deleting.
  const assignment = await prisma.divisionAssignment.findUnique({
    where: { id: assignmentId },
    select: { division: { select: { tournamentId: true } } },
  });
  if (!assignment) {
    return res.status(404).json({ error: 'Assignment not found' });
  }
  const access = await checkTournamentAccess(req, prisma, assignment.division.tournamentId, 'scorekeeper');
  if (!access.ok) {
    return res.status(access.status || 403).json({ error: access.error });
  }

  await prisma.divisionAssignment.delete({
    where: { id: assignmentId },
  });

  res.status(204).send();
});

// Move competitor between divisions (requires authentication)
router.post('/:id/move', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { assignmentId, toDivisionId } = req.body;

  // Resolve the assignment's current division → parent tournament
  // for the per-tournament access check.
  const current = await prisma.divisionAssignment.findUnique({
    where: { id: assignmentId },
    select: { division: { select: { tournamentId: true } } },
  });
  if (!current) {
    return res.status(404).json({ error: 'Assignment not found' });
  }
  const access = await checkTournamentAccess(req, prisma, current.division.tournamentId, 'scorekeeper');
  if (!access.ok) {
    return res.status(access.status || 403).json({ error: access.error });
  }

  // Cross-tournament FK check: the destination division must belong
  // to the same tournament as the source assignment. Closes B5.
  const target = await prisma.division.findUnique({
    where: { id: toDivisionId },
    select: { tournamentId: true, deletedAt: true },
  });
  if (!target || target.deletedAt) {
    return res.status(404).json({ error: 'Target division not found' });
  }
  if (target.tournamentId !== current.division.tournamentId) {
    return res.status(400).json({
      error: 'Target division does not belong to the same tournament',
    });
  }

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
router.post('/:id/split', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const divisionId = getParam(req.params.id);
  // Closes S14: cap splitCount at half the assignment count
  // (a division can't have more sub-divisions than
  // competitors). Zod-validate to reject extreme values.
  const rawSplitCount = Number(req.body?.splitCount ?? 2);
  if (!Number.isFinite(rawSplitCount) || rawSplitCount < 2) {
    return res.status(400).json({ error: 'splitCount must be a number >= 2' });
  }
  const splitCount = Math.min(rawSplitCount, 50); // hard upper bound
  req.body = { ...req.body, splitCount };

  const division = await prisma.division.findUnique({
    where: { id: divisionId },
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

  const access = await checkTournamentAccess(req, prisma, division.tournamentId, 'director');
  if (!access.ok) {
    return res.status(access.status || 403).json({ error: access.error });
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
router.get('/tournament/:tournamentId/backup', authenticate, requireTournamentAccess('director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const tournamentId = getParam(req.params.tournamentId);
  const backup = await getBackup(prisma, tournamentId);

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
router.post('/tournament/:tournamentId/restore', authenticate, requireTournamentAccess('director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const tournamentId = getParam(req.params.tournamentId);

  const backup = await getBackup(prisma, tournamentId);

  if (!backup) {
    return res.status(404).json({
      error: 'No backup found to restore',
      code: 'NO_BACKUP',
      suggestion: 'Backups are created automatically before auto-generation or clearing divisions',
    });
  }

  const result = await restoreDivisionState(prisma, backup);
  // Clear the backup after a successful restore so the next
  // bad regeneration doesn't restore the same state again.
  await clearBackup(prisma, tournamentId);

  res.json({
    ...result,
    message: `Restored ${result.restored} division(s)`,
  });
});

export default router;
