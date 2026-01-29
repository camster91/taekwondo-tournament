import { Router } from 'express';
import type { Request, Response } from 'express-serve-static-core';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { importFromExcel } from '../services/excel-import.js';
import { generateImportTemplate, getDefaultColumnMapping } from '../services/excel-template.js';
import { validateRequest } from '../middleware/validate.js';

const router = Router();

// Validation schemas
const competitorCreateSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  gender: z.enum(['M', 'F']),
  dateOfBirth: z.string().refine((val) => !isNaN(Date.parse(val)), { message: 'Invalid date format' }),
  belt: z.string().min(1, 'Belt is required'),
  beltStripe: z.number().int().min(0).max(10).optional().nullable(),
  danRank: z.number().int().min(0).max(10).optional().nullable(),
  heightInches: z.number().positive().optional().nullable(),
  weightLbs: z.number().positive().optional().nullable(),
  schoolDojang: z.string().max(200).optional().nullable(),
  specialNeeds: z.string().max(500).optional().nullable(),
});

const competitorUpdateSchema = competitorCreateSchema.partial();

// Helper to safely get string param
const getParam = (param: string | string[] | undefined): string => {
  if (Array.isArray(param)) return param[0];
  return param || '';
};

// Download import template
router.get('/template', (_req: Request, res: Response) => {
  const buffer = generateImportTemplate();

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="competitor-import-template.xlsx"');
  res.send(buffer);
});

// Get default column mapping for imports
router.get('/template/mapping', (_req: Request, res: Response) => {
  res.json(getDefaultColumnMapping());
});

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

// Get unique schools for filtering
// NOTE: Must be defined BEFORE /:id route to avoid being matched as an ID
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
// NOTE: Must be defined BEFORE /:id route to avoid being matched as an ID
router.get('/meta/belts', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const belts = await prisma.competitor.findMany({
    select: { belt: true },
    distinct: ['belt'],
    orderBy: { belt: 'asc' },
  });

  res.json(belts.map((b) => b.belt));
});

// Get single competitor
router.get('/:id', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const competitor = await prisma.competitor.findUnique({
    where: { id: getParam(req.params.id) },
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
router.post('/', validateRequest(competitorCreateSchema), async (req: Request, res: Response) => {
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
router.put('/:id', validateRequest(competitorUpdateSchema), async (req: Request, res: Response) => {
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
    where: { id: getParam(req.params.id) },
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
    where: { id: getParam(req.params.id) },
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

export default router;
