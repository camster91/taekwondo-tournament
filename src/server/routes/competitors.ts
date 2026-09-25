import { Router } from 'express';
import type { Request, Response } from 'express-serve-static-core';
import { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import { importFromExcel, type ColumnMapping, type ExcelRow } from '../services/excel-import.js';
import { generateImportTemplate, getDefaultColumnMapping } from '../services/excel-template.js';
import { autoDetectMapping } from '../services/excel-auto-map.js';
import { validateRequest } from '../middleware/validate.js';
import { jsonBodyParser } from '../index.js';
import {
  authenticate,
  requireRole,
  resolveTournamentScope,
  buildCompetitorAccessFilter,
  buildCompetitorWriteFilter,
  type AuthenticatedRequest,
} from '../middleware/auth.js';
import { parseBoundedInt, parseOptionalInt } from './query-parsing.js';
import { findPotentialDuplicates, mergeCompetitors, MIN_DUPLICATE_THRESHOLD } from '../services/competitor-deduplication.js';

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
  } catch (err: unknown) {
    console.error('[competitors/auto-map] parse failed:', err);
    res.status(500).json({ error: 'Failed to parse file' });
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

  // Defensive numeric parsing. `parseInt('abc')` returns NaN,
  // which Prisma rejects at the DB layer with a 500 — better to
  // clamp here so the route returns a sensible page.
  const limitResult = parseBoundedInt(limit, 100, 1, 1000);
  if (!limitResult.ok) return res.status(400).json({ error: `limit ${limitResult.error}` });
  const offsetResult = parseBoundedInt(offset, 0, 0, Number.MAX_SAFE_INTEGER);
  if (!offsetResult.ok) return res.status(400).json({ error: `offset ${offsetResult.error}` });
  const weightMinResult = parseOptionalInt(weight_min);
  if (!weightMinResult.ok) return res.status(400).json({ error: `weight_min ${weightMinResult.error}` });
  const weightMaxResult = parseOptionalInt(weight_max);
  if (!weightMaxResult.ok) return res.status(400).json({ error: `weight_max ${weightMaxResult.error}` });
  const parsedLimit = limitResult.value!;
  const parsedOffset = offsetResult.value!;
  const parsedWeightMin = weightMinResult.value;
  const parsedWeightMax = weightMaxResult.value;

  // Build a Prisma `where` for the competitors list. The shape is
  // `Prisma.CompetitorWhereInput`; we assemble it incrementally as
  // optional filters are added (search, belt, school, age/weight
  // ranges, trash, tournament-scope). No cast needed.
  const where: Prisma.CompetitorWhereInput = { deletedAt: trash === 'true' ? { not: null } : null };

  // Closes B34: scope competitor list to the competitors the user
  // can access (registered in an accessible tournament; unregistered
  // competitors only for legacy single-tenant users). Without this, a
  // viewer in org A can list every competitor in the system (name,
  // DOB, school, special needs). Only admins get `null` (unscoped).
  const competitorFilter = await buildCompetitorAccessFilter(
    req as AuthenticatedRequest,
    prisma
  );
  const scopeFilters: Prisma.CompetitorWhereInput[] = competitorFilter ? [competitorFilter] : [];

  if (search) {
    scopeFilters.push({
      OR: [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName:  { contains: search, mode: 'insensitive' } },
        { schoolDojang: { contains: search, mode: 'insensitive' } },
      ],
    });
  }
  if (scopeFilters.length > 0) where.AND = scopeFilters;

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
  if (parsedWeightMin !== undefined || parsedWeightMax !== undefined) {
    where.weightLbs = {};
    if (parsedWeightMin !== undefined) where.weightLbs.gte = parsedWeightMin;
    if (parsedWeightMax !== undefined) where.weightLbs.lte = parsedWeightMax;
  }

  // Push age filters into SQL via DOB bounds so take/skip/count stay
  // correct (post-filter on a page used to shrink pages and lie about total).
  const now = new Date();
  const ageMinParsed = age_min ? parseInt(String(age_min), 10) : NaN;
  const ageMaxParsed = age_max ? parseInt(String(age_max), 10) : NaN;
  if (!Number.isNaN(ageMinParsed) || !Number.isNaN(ageMaxParsed)) {
    const dobFilter: Prisma.DateTimeFilter = {};
    if (!Number.isNaN(ageMinParsed)) {
      const latestDob = new Date(now);
      latestDob.setFullYear(latestDob.getFullYear() - ageMinParsed);
      dobFilter.lte = latestDob;
    }
    if (!Number.isNaN(ageMaxParsed)) {
      const earliestDob = new Date(now);
      earliestDob.setFullYear(earliestDob.getFullYear() - ageMaxParsed - 1);
      dobFilter.gt = earliestDob;
    }
    where.dateOfBirth = dobFilter;
  }

  const [competitors, total] = await Promise.all([
    prisma.competitor.findMany({
      where,
      take: parsedLimit,
      skip: parsedOffset,
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
      age = now.getFullYear() - dob.getFullYear();
      const m = now.getMonth() - dob.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
    }
    const isBlack = /^black/i.test(c.belt || '');
    return { ...c, age, tier: isBlack ? 'BB' : 'CB' };
  });

  res.json({ competitors: enriched, total, filteredCount: enriched.length });
});

// Aggregates for faceted UI (count by belt, gender, school, age band).
// Scoped to accessible tournaments; belt/gender/school use groupBy so
// we don't load the full registry into Node memory.
router.get('/meta/aggregates', authenticate, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const competitorFilter = await buildCompetitorAccessFilter(
    req as AuthenticatedRequest,
    prisma,
  );
  const where: Prisma.CompetitorWhereInput = competitorFilter
    ? { deletedAt: null, AND: [competitorFilter] }
    : { deletedAt: null };

  const [total, byBeltRows, byGenderRows, bySchoolRows, slim] = await Promise.all([
    prisma.competitor.count({ where }),
    prisma.competitor.groupBy({ by: ['belt'], where, _count: { _all: true } }),
    prisma.competitor.groupBy({ by: ['gender'], where, _count: { _all: true } }),
    prisma.competitor.groupBy({
      by: ['schoolDojang'],
      where: { ...where, schoolDojang: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { schoolDojang: 'desc' } },
      take: 20,
    }),
    // Age/weight histograms need the values — select only those two columns.
    prisma.competitor.findMany({
      where,
      select: { dateOfBirth: true, weightLbs: true },
    }),
  ]);

  const byBelt: Record<string, number> = {};
  for (const row of byBeltRows) byBelt[row.belt] = row._count._all;
  const byGender: Record<string, number> = {};
  for (const row of byGenderRows) byGender[row.gender] = row._count._all;
  const bySchool: Record<string, number> = {};
  for (const row of bySchoolRows) {
    if (row.schoolDojang) bySchool[row.schoolDojang] = row._count._all;
  }

  const now = new Date();
  const byAge: Record<string, number> = {
    '4-5': 0, '6-7': 0, '8-9': 0, '10-11': 0, '12-14': 0, '15-17': 0, '18-35': 0, '36+': 0,
  };
  const byWeight: Record<string, number> = {
    'Under 50': 0, '50-75': 0, '75-100': 0, '100-150': 0, '150+': 0,
  };

  for (const c of slim) {
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

  res.json({ total, byBelt, byGender, bySchool, byAge, byWeight });
});

// Get unique schools for filtering (requires authentication)
// NOTE: Must be defined BEFORE /:id route to avoid being matched as an ID
router.get('/meta/schools', authenticate, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  // Scoped like the list: school names can identify another tenant's
  // clients, so only schools of accessible competitors are returned.
  const competitorFilter = await buildCompetitorAccessFilter(req as AuthenticatedRequest, prisma);
  const schools = await prisma.competitor.findMany({
    select: { schoolDojang: true },
    distinct: ['schoolDojang'],
    where: competitorFilter
      ? { schoolDojang: { not: null }, deletedAt: null, AND: [competitorFilter] }
      : { schoolDojang: { not: null } },
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

// Find potential duplicate competitors.
// NOTE: Must be defined BEFORE /:id so "duplicates" isn't captured as an id.
//
// Scoped to competitors the caller may modify (the only useful action on
// a duplicate is merging it), threshold clamped to MIN_DUPLICATE_THRESHOLD
// so the scan stays a DOB sliding window instead of an O(n²) all-pairs
// scan, and the candidate set / result count are capped in the service.
router.get('/duplicates', authenticate, requireRole('admin', 'director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { threshold } = req.query;

  const thresholdValue = threshold ? parseFloat(threshold as string) : 0.75;
  if (isNaN(thresholdValue) || thresholdValue < 0 || thresholdValue > 1) {
    return res.status(400).json({ error: 'threshold must be a number between 0 and 1' });
  }
  const effectiveThreshold = Math.max(thresholdValue, MIN_DUPLICATE_THRESHOLD);

  const writeFilter = await buildCompetitorWriteFilter(req as AuthenticatedRequest, prisma);
  const duplicates = await findPotentialDuplicates(prisma, effectiveThreshold, {
    where: writeFilter ?? undefined,
  });
  res.json({ duplicates, count: duplicates.length, threshold: effectiveThreshold });
});

// Get competitor history and statistics (requires authentication)
// NOTE: Must be defined BEFORE /:id route to avoid being matched as an ID
router.get('/:id/history', authenticate, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const competitorId = getParam(req.params.id);

  // Same access scope as GET /:id — without it any authenticated user
  // could read another tenant's competitor record + results by UUID.
  const competitorFilter = await buildCompetitorAccessFilter(req as AuthenticatedRequest, prisma);
  const competitor = await prisma.competitor.findFirst({
    where: competitorFilter
      ? { id: competitorId, deletedAt: null, AND: [competitorFilter] }
      : { id: competitorId, deletedAt: null },
  });

  if (!competitor) {
    return res.status(404).json({ error: 'Competitor not found' });
  }

  // Get tournament history with placements
  const history = await prisma.competitorHistory.findMany({
    where: { competitorId },
    include: {
      tournament: {
        select: {
          id: true,
          name: true,
          date: true,
          location: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Get current ratings (patterns and sparring)
  const ratings = await prisma.competitorRating.findMany({
    where: { competitorId },
  });

  // Calculate aggregate stats
  const totalMatches = history.reduce((sum, h) => sum + h.matchesWon + h.matchesLost, 0);
  const totalWins = history.reduce((sum, h) => sum + h.matchesWon, 0);
  const totalLosses = history.reduce((sum, h) => sum + h.matchesLost, 0);
  
  const medals = {
    gold: history.filter(h => h.placement === 1).length,
    silver: history.filter(h => h.placement === 2).length,
    bronze: history.filter(h => h.placement === 3).length,
  };

  // Group by event type for more detailed stats
  const patternHistory = history.filter(h => h.eventType === 'patterns');
  const sparringHistory = history.filter(h => h.eventType === 'sparring');

  const stats = {
    overall: {
      matches: totalMatches,
      wins: totalWins,
      losses: totalLosses,
      winRate: totalMatches > 0 ? (totalWins / totalMatches) * 100 : 0,
      medals,
      tournaments: history.length,
    },
    patterns: {
      matches: patternHistory.reduce((sum, h) => sum + h.matchesWon + h.matchesLost, 0),
      wins: patternHistory.reduce((sum, h) => sum + h.matchesWon, 0),
      losses: patternHistory.reduce((sum, h) => sum + h.matchesLost, 0),
      medals: {
        gold: patternHistory.filter(h => h.placement === 1).length,
        silver: patternHistory.filter(h => h.placement === 2).length,
        bronze: patternHistory.filter(h => h.placement === 3).length,
      },
      rating: ratings.find(r => r.eventType === 'patterns'),
    },
    sparring: {
      matches: sparringHistory.reduce((sum, h) => sum + h.matchesWon + h.matchesLost, 0),
      wins: sparringHistory.reduce((sum, h) => sum + h.matchesWon, 0),
      losses: sparringHistory.reduce((sum, h) => sum + h.matchesLost, 0),
      medals: {
        gold: sparringHistory.filter(h => h.placement === 1).length,
        silver: sparringHistory.filter(h => h.placement === 2).length,
        bronze: sparringHistory.filter(h => h.placement === 3).length,
      },
      rating: ratings.find(r => r.eventType === 'sparring'),
    },
  };

  res.json({
    competitor,
    history,
    stats,
  });
});

// Get single competitor (requires authentication). Closes S17 + IDOR:
// list is scoped via buildCompetitorAccessFilter; get-by-id must use
// the same scope so a viewer can't fetch arbitrary competitor PII
// (DOB, specialNeeds, weight) by UUID.
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const competitorFilter = await buildCompetitorAccessFilter(
    req as AuthenticatedRequest,
    prisma,
  );

  const where: Prisma.CompetitorWhereInput = {
    id: getParam(req.params.id),
    deletedAt: null,
  };
  if (competitorFilter !== null) {
    where.AND = [competitorFilter];
  }

  const competitor = await prisma.competitor.findFirst({ where });

  if (!competitor) {
    return res.status(404).json({ error: 'Competitor not found' });
  }

  res.json(competitor);
});

// Create competitor (requires authentication + admin/director role).
// Multi-tenant: legacy single-tenant users (no org memberships) may
// create unregistered competitors — they stay visible in the legacy
// pool. Tenant (org) users may only create when they have at least one
// accessible tournament.
router.post('/', authenticate, requireRole('admin', 'director'), validateRequest(competitorCreateSchema), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const authReq = req as AuthenticatedRequest;
  const scope = await resolveTournamentScope(authReq, prisma);
  // Tenant users must belong to at least one tournament — creating
  // floating competitors that no scoped list would show (and that
  // later IDOR-scoped updates couldn't touch) is disallowed.
  if (scope.filter !== null && !scope.legacyPool) {
    const accessible = await prisma.tournament.count({
      where: { deletedAt: null, AND: [scope.filter] },
    });
    if (accessible === 0) {
      return res.status(403).json({ error: 'No accessible tournament to attach competitors to' });
    }
  }
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

/**
 * True when the caller may modify the competitor. Admins always may.
 * Everyone else needs EVERY tournament the competitor is registered in
 * to be accessible (see buildCompetitorWriteFilter) — a registration in
 * the caller's own tournament must not unlock a competitor that is
 * also registered in another tenant's tournaments.
 */
async function assertCompetitorWritable(
  req: AuthenticatedRequest,
  prisma: PrismaClient,
  competitorId: string,
): Promise<boolean> {
  if (req.user?.role === 'admin') return true;
  const writeFilter = await buildCompetitorWriteFilter(req, prisma);
  if (writeFilter === null) return true;
  const found = await prisma.competitor.findFirst({
    where: { id: competitorId, AND: [writeFilter] },
    select: { id: true },
  });
  return !!found;
}

// Update competitor (requires authentication + admin/director role)
router.put('/:id', authenticate, requireRole('admin', 'director'), validateRequest(competitorUpdateSchema), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const id = getParam(req.params.id);
  if (!(await assertCompetitorWritable(req as AuthenticatedRequest, prisma, id))) {
    return res.status(404).json({ error: 'Competitor not found' });
  }
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
    where: { id },
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
// Soft-delete a competitor (admin/director only). Closes S18: the
// previous implementation used `updateMany` which silently no-ops
// when the row doesn't exist (returns count: 0). API clients
// couldn't tell a successful delete from a typo'd id. Switched
// to a single `update` with a not-found catch.
router.delete('/:id', authenticate, requireRole('admin', 'director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const id = getParam(req.params.id);
  if (!(await assertCompetitorWritable(req as AuthenticatedRequest, prisma, id))) {
    return res.status(404).json({ error: 'Competitor not found' });
  }
  try {
    await prisma.competitor.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    res.status(204).send();
  } catch (error: unknown) {
    // Prisma throws P2025 when the row doesn't exist. Returning
    // 404 here matches the contract for GET /:id and PUT /:id
    // (which also throw P2025 → handler turns it into 500 today;
    // this DELETE fix is the easy case because the row may
    // legitimately not exist).
    if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2025') {
      return res.status(404).json({ error: 'Competitor not found' });
    }
    throw error;
  }
});

// Restore a soft-deleted competitor (admin/director only). Same
// 404-on-missing handling as DELETE above.
router.post('/:id/restore', authenticate, requireRole('admin', 'director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const id = getParam(req.params.id);
  if (!(await assertCompetitorWritable(req as AuthenticatedRequest, prisma, id))) {
    return res.status(404).json({ error: 'Competitor not found' });
  }
  try {
    const updated = await prisma.competitor.update({
      where: { id },
      data: { deletedAt: null },
    });
    res.json(updated);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2025') {
      return res.status(404).json({ error: 'Competitor not found' });
    }
    throw error;
  }
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
//
// Two request shapes are accepted:
//   1. { data: any[], columnMapping }    — client already parsed
//      the .xlsx via xlsx.read (SheetJS in the browser). This is
//      the original path; kept for backward compat with the
//      existing client.
//   2. { fileBase64: string, columnMapping, fileName? } — closes
//      P8. The client uploads the raw file as a base64 string
//      and lets the server parse it. Reasons to prefer this:
//        a) Larger files don't blow the Vite proxy's 1 MB JSON
//           limit (a 50 KB .xlsx inflates to ~70 KB JSON but
//           a 5 MB .xlsx inflates to ~7 MB which trips the
//           proxy's limit). With a base64 form the body
//           parser is mounted on this route at 40 MB (per the
//           jsonBodyParser('40mb') override in src/server/index.ts).
//        b) Single source of truth for the parser — if we add
//           validation rules (e.g. "max 5000 rows") we don't
//           need to ship them in two places.
//        c) The client can show a progress bar against the
//           upload, not against a parse that already happened.
/**
 * Existing competitors an import may match + overwrite: everything for
 * admins, otherwise only competitors the importer may write. Anything
 * else is created fresh instead of overwritten.
 */
async function importMatchScope(
  req: AuthenticatedRequest,
  prisma: PrismaClient,
): Promise<Prisma.CompetitorWhereInput | 'all'> {
  const writeFilter = await buildCompetitorWriteFilter(req, prisma);
  return writeFilter ?? 'all';
}

const importFileSchema = z.object({
  fileBase64: z.string().min(1),
  columnMapping: z.record(z.string(), z.string()),
  fileName: z.string().optional(),
});

router.post('/import', jsonBodyParser('40mb'), authenticate, requireRole('admin', 'director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  // The import endpoint takes two shapes: pre-parsed JSON (browser already
  // ran SheetJS) or a base64-encoded workbook (server parses here). The
  // Zod schema for the base64 path validates columnMapping strictly;
  // the JSON path's mapping is treated as Partial<ColumnMapping> below.
  const body = req.body as { data?: ExcelRow[]; columnMapping?: Partial<ColumnMapping>; fileBase64?: string; fileName?: string };

  if (!body.columnMapping) {
    return res.status(400).json({ error: 'Missing columnMapping' });
  }

  // Path 2: server-side xlsx parsing.
  if (body.fileBase64) {
    const parsed = importFileSchema.safeParse(body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid file payload', details: parsed.error.flatten() });
    }
    try {
      const buffer = Buffer.from(parsed.data.fileBase64, 'base64');
      if (buffer.length > 25 * 1024 * 1024) {
        return res.status(413).json({ error: 'File too large (max 25MB)' });
      }
      // Read the workbook. The first non-empty sheet is what
      // we import (matches the client behavior — see
      // Competitors.tsx handleFileUpload which picks the sheet
      // matching 'competitor' or falls back to SheetNames[0]).
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        return res.status(400).json({ error: 'Workbook has no sheets' });
      }
      const data = XLSX.utils.sheet_to_json<ExcelRow>(workbook.Sheets[sheetName], { defval: '' });
      const result = await importFromExcel(prisma, data, parsed.data.columnMapping, {
        matchScope: await importMatchScope(req as AuthenticatedRequest, prisma),
      });
      return res.json({ ...result, parsedServerSide: true });
    } catch (err: unknown) {
      console.error('[competitors/import] failed:', err);
      res.status(500).json({ error: 'Import failed' });
    }
  }

  // Path 1: pre-parsed JSON (original behavior).
  if (!body.data) {
    return res.status(400).json({ error: 'Missing data or fileBase64' });
  }
  const result = await importFromExcel(prisma, body.data, body.columnMapping, {
    matchScope: await importMatchScope(req as AuthenticatedRequest, prisma),
  });
  res.json(result);
});

// Merge two competitors
const mergeCompetitorsSchema = z.object({
  primaryId: z.string().uuid(),
  secondaryId: z.string().uuid(),
  mergeOptions: z.object({
    takeSecondaryBelt: z.boolean().optional(),
    takeSecondaryWeight: z.boolean().optional(),
    takeSecondaryHeight: z.boolean().optional(),
    takeSecondarySchool: z.boolean().optional(),
  }).optional(),
});

router.post('/merge', authenticate, requireRole('admin', 'director'), validateRequest(mergeCompetitorsSchema), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { primaryId, secondaryId, mergeOptions } = req.body;

  // Both sides must be writable by the caller: a merge rewrites the
  // primary and soft-deletes the secondary (admins bypass).
  const authReq = req as AuthenticatedRequest;
  if (authReq.user?.role !== 'admin') {
    const writeFilter = await buildCompetitorWriteFilter(authReq, prisma);
    if (writeFilter !== null) {
      const writable = await prisma.competitor.count({
        where: { id: { in: [primaryId, secondaryId] }, AND: [writeFilter] },
      });
      const expected = primaryId === secondaryId ? 1 : 2;
      if (writable !== expected) {
        return res.status(404).json({ error: 'Competitor not found' });
      }
    }
  }

  try {
    const result = await mergeCompetitors(prisma, primaryId, secondaryId, mergeOptions);
    res.json({ success: true, result });
  } catch (err: unknown) {
    console.error('[competitors/merge] merge failed:', err);
    const message = err instanceof Error ? err.message : 'Failed to merge competitors';
    res.status(400).json({ error: message });
  }
});

export default router;
