import { Router } from 'express';
import type { Request, Response } from 'express-serve-static-core';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import { importFromExcel } from '../services/excel-import.js';
import { generateImportTemplate, getDefaultColumnMapping } from '../services/excel-template.js';
import { autoDetectMapping } from '../services/excel-auto-map.js';
import { validateRequest } from '../middleware/validate.js';
import { authenticate, requireRole, buildTournamentAccessFilter, type AuthenticatedRequest } from '../middleware/auth.js';

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

// Auto-detect the column mapping for an uploaded Excel/CSV file.
// The client parses the file with xlsx (browser-side), sends the resulting
// workbook as a base64 buffer; the server re-parses and runs the auto-detector.
// (Avoids adding multer as a dep — the file is already in memory after
//  xlsx.read in the browser.)
const autoMapSchema = z.object({
  fileBase64: z.string().min(1),
  fileName: z.string().optional(),
});
router.post('/auto-map', authenticate, requireRole('admin', 'director'), validateRequest(autoMapSchema), async (req: Request, res: Response) => {
  try {
    const { fileBase64, fileName } = req.body as { fileBase64: string; fileName?: string };
    const buffer = Buffer.from(fileBase64, 'base64');
    if (buffer.length > 25 * 1024 * 1024) {
      return res.status(413).json({ error: 'File too large (max 25MB)' });
    }
    const result = autoDetectMapping(buffer);
    res.json({ ...result, fileName: fileName || 'uploaded' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to parse file' });
  }
});

// Get all competitors (requires authentication)
router.get('/', authenticate, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const {
    search, belt, school, gender,
    age_min, age_max,
    weight_min, weight_max,
    trash,  // ?trash=true returns soft-deleted items
    limit = '100', offset = '0',
  } = req.query as Record<string, string>;

  const where: any = { deletedAt: trash === 'true' ? { not: null } : null };

  // Closes B34: scope competitor list to the tournaments the user
  // can access. Without this, a viewer in org A can list every
  // competitor in the system (name, DOB, school, special needs).
  const tournamentFilter = await buildTournamentAccessFilter(
    req as AuthenticatedRequest,
    prisma
  );
  if (tournamentFilter !== null) {
    // Restrict to competitors that have a registration in a
    // tournament the user can access. This still leaks an
    // orphan competitor with no registrations, but those have no
    // PII to leak in the first place.
    where.registrations = {
      some: { tournament: tournamentFilter, deletedAt: null },
    };
  }

  if (search) {
    where.OR = [
      { firstName: { contains: search, mode: 'insensitive' } },
      { lastName:  { contains: search, mode: 'insensitive' } },
      { schoolDojang: { contains: search, mode: 'insensitive' } },
    ];
  }

  if (belt) {
    // Allow comma-separated for "Yellow,Green"
    const belts = belt.split(',').map((b) => b.trim()).filter(Boolean);
    where.belt = belts.length > 1 ? { in: belts } : belts[0];
  }

  if (school) {
    // Exact match (no fuzzy) for school — too easy to over-match
    where.schoolDojang = { equals: school, mode: 'insensitive' };
  }

  if (gender) {
    where.gender = String(gender).toUpperCase();
  }

  // Age / weight filters require computed-from-DOB & weightLbs columns.
  // We compute age in JS from dateOfBirth. For SQL-level filtering
  // we use weightLbs directly.
  if (weight_min || weight_max) {
    where.weightLbs = {};
    if (weight_min) where.weightLbs.gte = parseInt(weight_min);
    if (weight_max) where.weightLbs.lte = parseInt(weight_max);
  }

  const [competitors, total] = await Promise.all([
    prisma.competitor.findMany({
      where,
      take: parseInt(limit),
      skip: parseInt(offset),
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    }),
    prisma.competitor.count({ where }),
  ]);

  // Compute age and belt-level group client-side so the UI can show
  // "682 kids, 5 with weight = 0" etc.
  const enriched = competitors.map((c) => {
    let age: number | null = null;
    if (c.dateOfBirth) {
      const dob = new Date(c.dateOfBirth);
      const now = new Date();
      age = now.getFullYear() - dob.getFullYear();
      const m = now.getMonth() - dob.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
    }
    const isBlack = /^black/i.test(c.belt || '');
    return { ...c, age, tier: isBlack ? 'BB' : 'CB' };
  });

  // Post-filter by age in JS (cheaper to do it here than a Prisma raw query)
  let filtered = enriched;
  if (age_min) filtered = filtered.filter((c) => c.age != null && c.age >= parseInt(age_min));
  if (age_max) filtered = filtered.filter((c) => c.age != null && c.age <= parseInt(age_max));

  res.json({ competitors: filtered, total, filteredCount: filtered.length });
});

// Aggregates for faceted UI (count by belt, gender, school, age band)
router.get('/meta/aggregates', authenticate, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const all = await prisma.competitor.findMany({
    where: { deletedAt: null },
    select: { belt: true, gender: true, schoolDojang: true, dateOfBirth: true, weightLbs: true },
  });

  const now = new Date();
  const byBelt: Record<string, number> = {};
  const byGender: Record<string, number> = {};
  const bySchool: Record<string, number> = {};
  const byAge: Record<string, number> = {
    '4-5': 0, '6-7': 0, '8-9': 0, '10-11': 0, '12-14': 0, '15-17': 0, '18-35': 0, '36+': 0,
  };
  const byWeight: Record<string, number> = {
    'Under 50': 0, '50-75': 0, '75-100': 0, '100-150': 0, '150+': 0,
  };

  for (const c of all) {
    byBelt[c.belt] = (byBelt[c.belt] || 0) + 1;
    byGender[c.gender] = (byGender[c.gender] || 0) + 1;
    if (c.schoolDojang) bySchool[c.schoolDojang] = (bySchool[c.schoolDojang] || 0) + 1;

    if (c.dateOfBirth) {
      const dob = new Date(c.dateOfBirth);
      let age = now.getFullYear() - dob.getFullYear();
      const m = now.getMonth() - dob.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
      if (age <= 5) byAge['4-5']++;
      else if (age <= 7) byAge['6-7']++;
      else if (age <= 9) byAge['8-9']++;
      else if (age <= 11) byAge['10-11']++;
      else if (age <= 14) byAge['12-14']++;
      else if (age <= 17) byAge['15-17']++;
      else if (age <= 35) byAge['18-35']++;
      else byAge['36+']++;
    }

    if (c.weightLbs != null) {
      if (c.weightLbs < 50) byWeight['Under 50']++;
      else if (c.weightLbs < 75) byWeight['50-75']++;
      else if (c.weightLbs < 100) byWeight['75-100']++;
      else if (c.weightLbs < 150) byWeight['100-150']++;
      else byWeight['150+']++;
    }
  }

  res.json({
    total: all.length,
    byBelt,
    byGender,
    bySchool: Object.fromEntries(
      Object.entries(bySchool).sort((a, b) => b[1] - a[1]).slice(0, 20)
    ),
    byAge,
    byWeight,
  });
});

// Get unique schools for filtering (requires authentication)
// NOTE: Must be defined BEFORE /:id route to avoid being matched as an ID
router.get('/meta/schools', authenticate, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const schools = await prisma.competitor.findMany({
    select: { schoolDojang: true },
    distinct: ['schoolDojang'],
    where: { schoolDojang: { not: null } },
    orderBy: { schoolDojang: 'asc' },
  });

  res.json(schools.map((s) => s.schoolDojang).filter(Boolean));
});

// Get unique belts for filtering (requires authentication)
// NOTE: Must be defined BEFORE /:id route to avoid being matched as an ID
router.get('/meta/belts', authenticate, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const belts = await prisma.competitor.findMany({
    where: { deletedAt: null },
    select: { belt: true },
    distinct: ['belt'],
    orderBy: { belt: 'asc' },
  });

  res.json(belts.map((b) => b.belt));
});

// Get single competitor (requires authentication). Closes S17:
// the original `include: { tournament: true }` leaked every tournament
// a competitor has ever been in, including from other orgs. Now
// returns only the basic competitor row; the per-tournament
// registration history is fetched via the registration list endpoint
// which already enforces the tournament access filter.
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  // Soft-deleted competitors are not accessible via direct ID — restore
  // them via POST /:id/restore first. findUnique with a deletedAt filter
  // returns null for the trash; we return 404 so the UI doesn't render
  // a competitor the operator already removed.
  const competitor = await prisma.competitor.findFirst({
    where: { id: getParam(req.params.id), deletedAt: null },
  });

  if (!competitor) {
    return res.status(404).json({ error: 'Competitor not found' });
  }

  res.json(competitor);
});

// Create competitor (requires authentication + admin/director role)
router.post('/', authenticate, requireRole('admin', 'director'), validateRequest(competitorCreateSchema), async (req: Request, res: Response) => {
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

// Update competitor (requires authentication + admin/director role)
router.put('/:id', authenticate, requireRole('admin', 'director'), validateRequest(competitorUpdateSchema), async (req: Request, res: Response) => {
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

// Delete competitor (requires authentication + admin/director role)
// Soft-delete: sets deletedAt, row stays in DB for 7 days, manager can
// restore via POST /:id/restore before the auto-purge cron runs.
// Uses updateMany instead of update so a non-existent ID returns204 silently.
router.delete('/:id', authenticate, requireRole('admin', 'director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  await prisma.competitor.updateMany({
    where: { id: getParam(req.params.id) },
    data: { deletedAt: new Date() },
  });

  res.status(204).send();
});

// Restore a soft-deleted competitor (admin/director only)
router.post('/:id/restore', authenticate, requireRole('admin', 'director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const updated = await prisma.competitor.update({
    where: { id: getParam(req.params.id) },
    data: { deletedAt: null },
  });
  res.json(updated);
});

// Hard-delete a soft-deleted competitor (admin only) — used by the auto-purge
// cron after 7 days. Manager can also call it from Trash if they're sure.
router.delete('/:id/purge', authenticate, requireRole('admin'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  await prisma.competitor.delete({
    where: { id: getParam(req.params.id) },
  });
  res.status(204).send();
});

// Import from Excel (requires authentication + admin/director role)
router.post('/import', authenticate, requireRole('admin', 'director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { data, columnMapping } = req.body;

  if (!data || !columnMapping) {
    return res.status(400).json({ error: 'Missing data or columnMapping' });
  }

  const result = await importFromExcel(prisma, data, columnMapping);
  res.json(result);
});

export default router;
