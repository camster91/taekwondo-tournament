import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { importFromExcel } from '../services/excel-import.js';

const router = Router();

// Get all competitors
router.get('/', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { search, belt, school, limit = '100', offset = '0' } = req.query;

  const where: any = {};

  if (search) {
    where.OR = [
      { firstName: { contains: String(search) } },
      { lastName: { contains: String(search) } },
    ];
  }

  if (belt) {
    where.belt = String(belt);
  }

  if (school) {
    where.schoolDojang = { contains: String(school) };
  }

  const [competitors, total] = await Promise.all([
    prisma.competitor.findMany({
      where,
      take: parseInt(String(limit)),
      skip: parseInt(String(offset)),
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    }),
    prisma.competitor.count({ where }),
  ]);

  res.json({ competitors, total });
});

// Get single competitor
router.get('/:id', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const competitor = await prisma.competitor.findUnique({
    where: { id: req.params.id },
    include: {
      registrations: {
        include: {
          tournament: true,
        },
      },
    },
  });

  if (!competitor) {
    return res.status(404).json({ error: 'Competitor not found' });
  }

  res.json(competitor);
});

// Create competitor
router.post('/', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const {
    firstName,
    lastName,
    gender,
    dateOfBirth,
    belt,
    beltStripe,
    danRank,
    heightInches,
    weightLbs,
    schoolDojang,
    specialNeeds,
  } = req.body;

  const competitor = await prisma.competitor.create({
    data: {
      firstName,
      lastName,
      gender,
      dateOfBirth: new Date(dateOfBirth),
      belt,
      beltStripe,
      danRank,
      heightInches,
      weightLbs,
      schoolDojang,
      specialNeeds,
    },
  });

  res.status(201).json(competitor);
});

// Update competitor
router.put('/:id', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const {
    firstName,
    lastName,
    gender,
    dateOfBirth,
    belt,
    beltStripe,
    danRank,
    heightInches,
    weightLbs,
    schoolDojang,
    specialNeeds,
  } = req.body;

  const competitor = await prisma.competitor.update({
    where: { id: req.params.id },
    data: {
      firstName,
      lastName,
      gender,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
      belt,
      beltStripe,
      danRank,
      heightInches,
      weightLbs,
      schoolDojang,
      specialNeeds,
    },
  });

  res.json(competitor);
});

// Delete competitor
router.delete('/:id', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  await prisma.competitor.delete({
    where: { id: req.params.id },
  });

  res.status(204).send();
});

// Import from Excel
router.post('/import', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { data, columnMapping } = req.body;

  if (!data || !columnMapping) {
    return res.status(400).json({ error: 'Missing data or columnMapping' });
  }

  const result = await importFromExcel(prisma, data, columnMapping);
  res.json(result);
});

// Get unique schools for filtering
router.get('/meta/schools', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const schools = await prisma.competitor.findMany({
    select: { schoolDojang: true },
    distinct: ['schoolDojang'],
    where: { schoolDojang: { not: null } },
    orderBy: { schoolDojang: 'asc' },
  });

  res.json(schools.map((s) => s.schoolDojang).filter(Boolean));
});

// Get unique belts for filtering
router.get('/meta/belts', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const belts = await prisma.competitor.findMany({
    select: { belt: true },
    distinct: ['belt'],
    orderBy: { belt: 'asc' },
  });

  res.json(belts.map((b) => b.belt));
});

export default router;
