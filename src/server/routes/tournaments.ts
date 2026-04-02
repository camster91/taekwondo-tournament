import { Router } from 'express';
import type { Request, Response } from 'express-serve-static-core';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { calculateAge } from '../../shared/constants/age-groups.js';
import { generateSchedule } from '../services/schedule-generator.js';
import { validateRequest } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// Validation schemas
const tournamentCreateSchema = z.object({
  name: z.string().min(1, 'Tournament name is required').max(200),
  date: z.string().refine((val) => !isNaN(Date.parse(val)), { message: 'Invalid date format' }),
  location: z.string().max(300).optional().nullable(),
  settings: z.record(z.string(), z.unknown()).optional(),
  sportProfileSlug: z.string().optional().default('taekwondo'),
  organizationId: z.string().optional(),
});

const tournamentUpdateSchema = tournamentCreateSchema.partial().extend({
  status: z.enum(['draft', 'registration', 'brackets', 'in_progress', 'active', 'completed']).optional(),
});

const registrationSchema = z.object({
  competitorId: z.string().min(1, 'Competitor ID is required'),
  patterns: z.boolean().optional(),
  sparring: z.boolean().optional(),
  weightAtRegistration: z.number().positive().optional(),
});

const bulkRegistrationSchema = z.object({
  competitorIds: z.array(z.string()).min(1, 'At least one competitor required'),
  patterns: z.boolean().optional(),
  sparring: z.boolean().optional(),
});

// Helper to safely get string param
const getParam = (param: string | string[] | undefined): string => {
  if (Array.isArray(param)) return param[0];
  return param || '';
};

// Get all tournaments
router.get('/', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  const tournaments = await prisma.tournament.findMany({
    include: {
      _count: {
        select: {
          registrations: true,
          divisions: true,
        },
      },
    },
    orderBy: { date: 'desc' },
  });

  res.json(tournaments);
});

// Get single tournament
router.get('/:id', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  const tournament = await prisma.tournament.findUnique({
    where: { id: getParam(req.params.id) },
    include: {
      _count: {
        select: {
          registrations: true,
          divisions: true,
        },
      },
      weightClasses: true,
    },
  });

  if (!tournament) {
    return res.status(404).json({ error: 'Tournament not found' });
  }

  res.json(tournament);
});

// Create tournament (requires authentication)
router.post('/', authenticate, validateRequest(tournamentCreateSchema), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { name, date, location, settings, sportProfileSlug, organizationId } = req.body;

  const tournament = await prisma.tournament.create({
    data: {
      name,
      date: new Date(date),
      location,
      settings: settings ? JSON.stringify(settings) : null,
      status: 'draft',
      sportProfileSlug: sportProfileSlug || 'taekwondo',
      organizationId: organizationId || null,
    },
  });

  res.status(201).json(tournament);
});

// Update tournament (requires authentication)
router.put('/:id', authenticate, validateRequest(tournamentUpdateSchema), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { name, date, location, status, settings } = req.body;

  const tournament = await prisma.tournament.update({
    where: { id: getParam(req.params.id) },
    data: {
      name,
      date: date ? new Date(date) : undefined,
      location,
      status,
      settings: settings ? JSON.stringify(settings) : undefined,
    },
  });

  res.json(tournament);
});

// Delete tournament (requires authentication)
router.delete('/:id', authenticate, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  await prisma.tournament.delete({
    where: { id: getParam(req.params.id) },
  });

  res.status(204).send();
});

// Get tournament registrations
router.get('/:id/registrations', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  const registrations = await prisma.registration.findMany({
    where: { tournamentId: getParam(req.params.id) },
    include: {
      competitor: true,
      assignments: {
        include: {
          division: true,
        },
      },
    },
    orderBy: {
      competitor: {
        lastName: 'asc',
      },
    },
  });

  res.json(registrations);
});

// Register competitor to tournament (requires authentication)
router.post('/:id/registrations', authenticate, validateRequest(registrationSchema), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { competitorId, patterns, sparring, weightAtRegistration } = req.body;

  // Get tournament date for age calculation
  const tournament = await prisma.tournament.findUnique({
    where: { id: getParam(req.params.id) },
  });

  if (!tournament) {
    return res.status(404).json({ error: 'Tournament not found' });
  }

  // Get competitor for age calculation
  const competitor = await prisma.competitor.findUnique({
    where: { id: competitorId },
  });

  if (!competitor) {
    return res.status(404).json({ error: 'Competitor not found' });
  }

  const ageAtTournament = calculateAge(competitor.dateOfBirth, tournament.date);

  const registration = await prisma.registration.create({
    data: {
      tournamentId: getParam(req.params.id),
      competitorId,
      patterns: patterns ?? false,
      sparring: sparring ?? false,
      weightAtRegistration: weightAtRegistration ?? competitor.weightLbs,
      ageAtTournament,
    },
    include: {
      competitor: true,
    },
  });

  res.status(201).json(registration);
});

// Bulk register competitors (requires authentication)
router.post('/:id/registrations/bulk', authenticate, validateRequest(bulkRegistrationSchema), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { competitorIds, patterns, sparring } = req.body;

  const tournament = await prisma.tournament.findUnique({
    where: { id: getParam(req.params.id) },
  });

  if (!tournament) {
    return res.status(404).json({ error: 'Tournament not found' });
  }

  const competitors = await prisma.competitor.findMany({
    where: { id: { in: competitorIds } },
  });

  const registrations = await Promise.all(
    competitors.map(async (competitor) => {
      const ageAtTournament = calculateAge(competitor.dateOfBirth, tournament.date);

      return prisma.registration.upsert({
        where: {
          tournamentId_competitorId: {
            tournamentId: getParam(req.params.id),
            competitorId: competitor.id,
          },
        },
        update: {
          patterns: patterns ?? false,
          sparring: sparring ?? false,
          ageAtTournament,
        },
        create: {
          tournamentId: getParam(req.params.id),
          competitorId: competitor.id,
          patterns: patterns ?? false,
          sparring: sparring ?? false,
          weightAtRegistration: competitor.weightLbs,
          ageAtTournament,
        },
      });
    })
  );

  res.json({ registered: registrations.length });
});

// Update registration (requires authentication)
router.put('/:id/registrations/:regId', authenticate, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { patterns, sparring, weightAtRegistration, checkedIn, checkInWeight } = req.body;

  const updateData: Record<string, unknown> = {};
  if (patterns !== undefined) updateData.patterns = patterns;
  if (sparring !== undefined) updateData.sparring = sparring;
  if (weightAtRegistration !== undefined) updateData.weightAtRegistration = weightAtRegistration;
  if (checkedIn !== undefined) {
    updateData.checkedIn = checkedIn;
    updateData.checkInTime = checkedIn ? new Date() : null;
  }
  if (checkInWeight !== undefined) updateData.checkInWeight = checkInWeight;

  const registration = await prisma.registration.update({
    where: { id: getParam(req.params.regId) },
    data: updateData,
    include: {
      competitor: true,
    },
  });

  res.json(registration);
});

// Remove registration (requires authentication)
router.delete('/:id/registrations/:regId', authenticate, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  await prisma.registration.delete({
    where: { id: getParam(req.params.regId) },
  });

  res.status(204).send();
});

// Get weight classes for tournament
router.get('/:id/weight-classes', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const weightClasses = await prisma.weightClass.findMany({
    where: { tournamentId: getParam(req.params.id) },
    orderBy: [{ ageMin: 'asc' }, { gender: 'asc' }, { weightMinLbs: 'asc' }],
  });
  res.json(weightClasses);
});

// Save weight classes for tournament (bulk replace)
router.put('/:id/weight-classes', authenticate, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const tournamentId = getParam(req.params.id);
  const { weightClasses } = req.body as {
    weightClasses: Array<{
      name: string;
      gender?: string;
      ageMin?: number;
      ageMax?: number;
      weightMinLbs?: number;
      weightMaxLbs?: number;
      displayOrder?: number;
    }>;
  };

  if (!Array.isArray(weightClasses)) {
    return res.status(400).json({ error: 'weightClasses must be an array' });
  }

  // Delete existing and recreate
  await prisma.weightClass.deleteMany({ where: { tournamentId } });

  const created = await prisma.weightClass.createMany({
    data: weightClasses.map((wc, i) => ({
      tournamentId,
      name: wc.name,
      gender: wc.gender || null,
      ageMin: wc.ageMin ?? null,
      ageMax: wc.ageMax ?? null,
      weightMinLbs: wc.weightMinLbs ?? null,
      weightMaxLbs: wc.weightMaxLbs ?? null,
      displayOrder: wc.displayOrder ?? i,
    })),
  });

  res.json({ saved: created.count });
});

// Generate tournament schedule (requires authentication)
router.post('/:id/schedule', authenticate, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const config = req.body.config || {};

  try {
    const schedule = await generateSchedule(prisma, getParam(req.params.id), config);
    res.json(schedule);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Get tournament schedule (same as generate but GET method for simple fetch)
router.get('/:id/schedule', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  try {
    const schedule = await generateSchedule(prisma, getParam(req.params.id));
    res.json(schedule);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
