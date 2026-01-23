import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { calculateAge } from '../../shared/constants/age-groups.js';

const router = Router();

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
    where: { id: req.params.id },
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

// Create tournament
router.post('/', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { name, date, location, settings } = req.body;

  const tournament = await prisma.tournament.create({
    data: {
      name,
      date: new Date(date),
      location,
      settings: settings ? JSON.stringify(settings) : null,
      status: 'draft',
    },
  });

  res.status(201).json(tournament);
});

// Update tournament
router.put('/:id', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { name, date, location, status, settings } = req.body;

  const tournament = await prisma.tournament.update({
    where: { id: req.params.id },
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

// Delete tournament
router.delete('/:id', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  await prisma.tournament.delete({
    where: { id: req.params.id },
  });

  res.status(204).send();
});

// Get tournament registrations
router.get('/:id/registrations', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  const registrations = await prisma.registration.findMany({
    where: { tournamentId: req.params.id },
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

// Register competitor to tournament
router.post('/:id/registrations', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { competitorId, patterns, sparring, weightAtRegistration } = req.body;

  // Get tournament date for age calculation
  const tournament = await prisma.tournament.findUnique({
    where: { id: req.params.id },
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
      tournamentId: req.params.id,
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

// Bulk register competitors
router.post('/:id/registrations/bulk', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { competitorIds, patterns, sparring } = req.body;

  const tournament = await prisma.tournament.findUnique({
    where: { id: req.params.id },
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
            tournamentId: req.params.id,
            competitorId: competitor.id,
          },
        },
        update: {
          patterns: patterns ?? false,
          sparring: sparring ?? false,
          ageAtTournament,
        },
        create: {
          tournamentId: req.params.id,
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

// Update registration
router.put('/:id/registrations/:regId', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { patterns, sparring, weightAtRegistration } = req.body;

  const registration = await prisma.registration.update({
    where: { id: req.params.regId },
    data: {
      patterns,
      sparring,
      weightAtRegistration,
    },
    include: {
      competitor: true,
    },
  });

  res.json(registration);
});

// Remove registration
router.delete('/:id/registrations/:regId', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  await prisma.registration.delete({
    where: { id: req.params.regId },
  });

  res.status(204).send();
});

export default router;
