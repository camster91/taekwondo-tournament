import { Router } from 'express';
import type { Request, Response } from 'express-serve-static-core';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { calculateAge } from '../../shared/constants/age-groups.js';
import { generateSchedule } from '../services/schedule-generator.js';
import { validateRequest } from '../middleware/validate.js';
import { authenticate, requireRole, type AuthenticatedRequest } from '../middleware/auth.js';
import {
  parseTournamentRules,
  serializeTournamentRules,
  DEFAULT_TOURNAMENT_RULES,
  type TournamentRules,
} from '../../shared/constants/tournament-rules.js';
import { Errors } from '../utils/errors.js';

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

const registrationUpdateSchema = z.object({
  patterns: z.boolean().optional(),
  sparring: z.boolean().optional(),
  weightAtRegistration: z.number().positive().optional(),
  checkedIn: z.boolean().optional(),
  checkInWeight: z.number().positive().optional(),
  // v2 fields
  competeWithOlder: z.boolean().optional(),
  specialNeeds: z.string().max(500).optional().nullable(),
  manualDivisionId: z.string().optional().nullable(),
  seeding: z.number().int().min(1).optional().nullable(),
});

const weightClassesSchema = z.object({
  weightClasses: z.array(z.object({
    name: z.string().min(1),
    gender: z.string().optional(),
    ageMin: z.number().int().optional(),
    ageMax: z.number().int().optional(),
    weightMinLbs: z.number().optional(),
    weightMaxLbs: z.number().optional(),
    displayOrder: z.number().int().optional(),
  })),
});

// Helper to safely get string param
const getParam = (param: string | string[] | undefined): string => {
  if (Array.isArray(param)) return param[0];
  return param || '';
};

// Get all tournaments (requires authentication)
router.get('/', authenticate, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  // ?trash=true returns soft-deleted tournaments (for the Trash page);
  // ?trash=all returns both. Default hides soft-deleted.
  const trash = req.query.trash;
  const where =
    trash === 'true' ? { deletedAt: { not: null } } :
    trash === 'all' ? {} :
    { deletedAt: null };

  const tournaments = await prisma.tournament.findMany({
    where,
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

// Get single tournament (requires authentication)
router.get('/:id', authenticate, async (req: Request, res: Response) => {
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

// Create tournament (requires authentication + admin/director role)
router.post('/', authenticate, requireRole('admin', 'director'), validateRequest(tournamentCreateSchema), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { name, date, location, settings, sportProfileSlug, organizationId } = req.body;

  // Normalize the incoming date to noon UTC. The schema column is a
  // timestamptz but the field represents a calendar date, not an
  // instant. Storing at midnight UTC causes the date to shift by one
  // day when displayed in negative-offset timezones (e.g. PDT shows
  // "2026-08-14" for a date the user picked as 2026-08-15). Noon
  // UTC is safe across all timezones.
  const normalizeDate = (raw: string): Date => {
    const dateOnly = raw.includes('T') ? raw.slice(0, 10) : raw;
    return new Date(dateOnly + 'T12:00:00.000Z');
  };

  const tournament = await prisma.tournament.create({
    data: {
      name,
      date: normalizeDate(date),
      location,
      settings: settings ? JSON.stringify(settings) : null,
      status: 'draft',
      sportProfileSlug: sportProfileSlug || 'taekwondo',
      organizationId: organizationId || null,
    },
  });

  res.status(201).json(tournament);
});

// Update tournament (requires authentication + admin/director role)
router.put('/:id', authenticate, requireRole('admin', 'director'), validateRequest(tournamentUpdateSchema), async (req: Request, res: Response) => {
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

// ─── Tournament rules (v2) ──────────────────────────────────────────────
// GET /api/tournaments/:id/rules — returns the rules JSON for this tournament
router.get('/:id/rules', authenticate, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const tournament = await prisma.tournament.findUnique({
    where: { id: getParam(req.params.id) },
    select: { settings: true },
  });
  if (!tournament) throw Errors.tournamentNotFound(getParam(req.params.id));
  const rules = parseTournamentRules(tournament.settings);
  res.json(rules);
});

// PUT /api/tournaments/:id/rules — replaces the rules JSON
router.put('/:id/rules', authenticate, requireRole('admin', 'director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { rules } = req.body as { rules: TournamentRules };
  // Validate by round-tripping through parse (which merges with defaults)
  const normalized = parseTournamentRules(JSON.stringify(rules));
  const tournament = await prisma.tournament.update({
    where: { id: getParam(req.params.id) },
    data: { settings: serializeTournamentRules(normalized) },
    select: { id: true, settings: true },
  });
  res.json({ rules: parseTournamentRules(tournament.settings) });
});

// POST /api/tournaments/:id/rules/reset — restore defaults
router.post('/:id/rules/reset', authenticate, requireRole('admin', 'director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const tournament = await prisma.tournament.update({
    where: { id: getParam(req.params.id) },
    data: { settings: serializeTournamentRules(DEFAULT_TOURNAMENT_RULES) },
    select: { id: true, settings: true },
  });
  res.json({ rules: parseTournamentRules(tournament.settings) });
});

// Delete tournament (requires authentication + admin/director role)
// Delete a tournament. The Tournament table has a deletedAt column
// (see prisma/schema.prisma) for soft-delete. Hard-deleting a tournament
// cascades through Match (SetNull), Division (cascade-delete), and
// Registration (cascade-delete) — losing the entire bracket history.
// The default is therefore a soft-delete that preserves audit trail;
// a separate ?hard=true flag is required to actually drop the row.
router.delete('/:id', authenticate, requireRole('admin', 'director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const hard = req.query.hard === 'true';

  if (hard) {
    await prisma.tournament.delete({
      where: { id: getParam(req.params.id) },
    });
    return res.status(204).send();
  }

  await prisma.tournament.update({
    where: { id: getParam(req.params.id) },
    data: { deletedAt: new Date() },
  });

  res.status(204).send();
});

// Restore a soft-deleted tournament
router.post('/:id/restore', authenticate, requireRole('admin', 'director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  await prisma.tournament.update({
    where: { id: getParam(req.params.id) },
    data: { deletedAt: null },
  });

  res.status(204).send();
});

// Get tournament registrations (requires authentication)
router.get('/:id/registrations', authenticate, async (req: Request, res: Response) => {
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

// Register competitor to tournament (requires authentication + admin/director role)
router.post('/:id/registrations', authenticate, requireRole('admin', 'director'), validateRequest(registrationSchema), async (req: Request, res: Response) => {
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

// Bulk register competitors (requires authentication + admin/director role)
router.post('/:id/registrations/bulk', authenticate, requireRole('admin', 'director'), validateRequest(bulkRegistrationSchema), async (req: Request, res: Response) => {
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

// Update registration (requires authentication + admin/director role)
router.put('/:id/registrations/:regId', authenticate, requireRole('admin', 'director'), validateRequest(registrationUpdateSchema), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { patterns, sparring, weightAtRegistration, checkedIn, checkInWeight, competeWithOlder, specialNeeds, manualDivisionId, seeding } = req.body;

  // Verify registration belongs to this tournament
  const existing = await prisma.registration.findFirst({
    where: { id: getParam(req.params.regId), tournamentId: getParam(req.params.id) },
  });
  if (!existing) {
    return res.status(404).json({ error: 'Registration not found in this tournament' });
  }

  const updateData: Record<string, unknown> = {};
  if (patterns !== undefined) updateData.patterns = patterns;
  if (sparring !== undefined) updateData.sparring = sparring;
  if (weightAtRegistration !== undefined) updateData.weightAtRegistration = weightAtRegistration;
  if (checkedIn !== undefined) {
    updateData.checkedIn = checkedIn;
    updateData.checkInTime = checkedIn ? new Date() : null;
  }
  if (checkInWeight !== undefined) updateData.checkInWeight = checkInWeight;
  // v2 fields
  if (competeWithOlder !== undefined) updateData.competeWithOlder = competeWithOlder;
  if (specialNeeds !== undefined) updateData.specialNeeds = specialNeeds;
  if (manualDivisionId !== undefined) updateData.manualDivisionId = manualDivisionId || null;
  if (seeding !== undefined) updateData.seeding = seeding || null;

  const registration = await prisma.registration.update({
    where: { id: getParam(req.params.regId) },
    data: updateData,
    include: {
      competitor: true,
    },
  });

  res.json(registration);
});

// Remove registration (requires authentication + admin/director role)
router.delete('/:id/registrations/:regId', authenticate, requireRole('admin', 'director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  // Verify registration belongs to this tournament
  const existing = await prisma.registration.findFirst({
    where: { id: getParam(req.params.regId), tournamentId: getParam(req.params.id) },
  });
  if (!existing) {
    return res.status(404).json({ error: 'Registration not found in this tournament' });
  }

  await prisma.registration.delete({
    where: { id: getParam(req.params.regId) },
  });

  res.status(204).send();
});

// Get weight classes for tournament (requires authentication)
router.get('/:id/weight-classes', authenticate, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const weightClasses = await prisma.weightClass.findMany({
    where: { tournamentId: getParam(req.params.id) },
    orderBy: [{ ageMin: 'asc' }, { gender: 'asc' }, { weightMinLbs: 'asc' }],
  });
  res.json(weightClasses);
});

// Save weight classes for tournament (bulk replace, requires authentication + admin/director role)
router.put('/:id/weight-classes', authenticate, requireRole('admin', 'director'), validateRequest(weightClassesSchema), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const tournamentId = getParam(req.params.id);
  const { weightClasses } = req.body;

  // Delete existing and recreate
  await prisma.weightClass.deleteMany({ where: { tournamentId } });

  const created = await prisma.weightClass.createMany({
    data: weightClasses.map((wc: z.infer<typeof weightClassesSchema>['weightClasses'][number], i: number) => ({
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

// Get tournament schedule (requires authentication)
router.get('/:id/schedule', authenticate, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  try {
    const schedule = await generateSchedule(prisma, getParam(req.params.id));
    res.json(schedule);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Day-of operations: live stats for the running tournament
router.get('/:id/day-of', authenticate, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const tournamentId = getParam(req.params.id);

  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId } });
  if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

  // All registrations with check-in status
  const [registrations, divisions, matches] = await Promise.all([
    prisma.registration.findMany({
      where: { tournamentId },
      include: { competitor: { select: { firstName: true, lastName: true, schoolDojang: true, belt: true, weightLbs: true } } },
    }),
    prisma.division.findMany({
      where: { tournamentId },
      include: { _count: { select: { assignments: true } } },
    }),
    prisma.match.findMany({
      where: { bracket: { division: { tournamentId } } },
      include: { bracket: { select: { id: true, divisionId: true } } },
    }),
  ]);

  // Check-in counts
  const checkedIn = registrations.filter((r) => r.checkedIn);
  const notCheckedIn = registrations.filter((r) => !r.checkedIn);

  // Weight mismatches: registration weight at check-in differs from initial by > 2 lbs
  // (kids grow; >2 lb difference is a re-weigh signal)
  const weightMismatches = checkedIn
    .filter((r) => r.checkInWeight != null && r.weightAtRegistration != null
      && Math.abs(r.checkInWeight - r.weightAtRegistration) > 2)
    .map((r) => ({
      registrationId: r.id,
      name: `${r.competitor.firstName} ${r.competitor.lastName}`,
      school: r.competitor.schoolDojang,
      weightAtRegistration: r.weightAtRegistration,
      checkInWeight: r.checkInWeight,
      delta: r.checkInWeight! - r.weightAtRegistration!,
    }));

  // Match status counts
  const matchCounts = {
    total: matches.length,
    pending: matches.filter((m) => m.status === 'pending').length,
    ready: matches.filter((m) => m.status === 'ready').length,
    inProgress: matches.filter((m) => m.status === 'in_progress').length,
    completed: matches.filter((m) => m.status === 'completed').length,
  };

  // By ring: how many matches are scheduled per ring, how many in-progress
  // Matches with null ringNumber are NOT bucketed into a default ring (the
  // previous `|| 1` fallback miscounted unassigned matches into Ring 1 and
  // made "Up next by ring" lie about which ring was busy). Closes #30
  // (the public scoreboard fix shipped in fa278b6 applied the same logic
  // on the client; this is the server side).
  const byRing: Record<number, { total: number; inProgress: number; completed: number }> = {};
  for (const m of matches) {
    if (m.ringNumber == null) continue;
    const ring = m.ringNumber;
    if (!byRing[ring]) byRing[ring] = { total: 0, inProgress: 0, completed: 0 };
    byRing[ring].total++;
    if (m.status === 'in_progress') byRing[ring].inProgress++;
    else if (m.status === 'completed') byRing[ring].completed++;
  }

  // Backfill from configured ring count (tournament.settings.rings.count).
  // Without this, a brand-new tournament with no matches routed to a ring
  // yet shows an empty byRing / upNext list even though rings 1..N are
  // configured in the Schedule page. Same fix as the DirectorDashboard
  // backfill in 320bac8.
  let configuredRingCount = 0;
  try {
    const settings = tournament.settings ? JSON.parse(tournament.settings) : null;
    configuredRingCount = settings?.rings?.count || 0;
  } catch {
    configuredRingCount = 0;
  }
  for (let i = 1; i <= configuredRingCount; i++) {
    if (!byRing[i]) byRing[i] = { total: 0, inProgress: 0, completed: 0 };
  }

  // Up next per ring: next ready match (smallest matchNumber per ring)
  const upNext: Array<{ ring: number; matchId: string; matchNumber: number; division: string }> = [];
  for (const ring of Object.keys(byRing).map(Number)) {
    const nextMatch = matches
      .filter((m) => m.ringNumber === ring && m.status === 'ready')
      .sort((a, b) => a.matchNumber - b.matchNumber)[0];
    if (nextMatch) {
      const div = divisions.find((d) => d.id === nextMatch.bracket.divisionId);
      upNext.push({
        ring,
        matchId: nextMatch.id,
        matchNumber: nextMatch.matchNumber,
        division: div?.name || 'Unknown',
      });
    }
  }

  return res.json({
    tournament: { id: tournament.id, name: tournament.name, date: tournament.date, status: tournament.status },
    checkIn: {
      total: registrations.length,
      checkedIn: checkedIn.length,
      notCheckedIn: notCheckedIn.length,
      percent: registrations.length > 0 ? Math.round((checkedIn.length / registrations.length) * 100) : 0,
      weightMismatches: weightMismatches.length,
      weightMismatchDetails: weightMismatches.slice(0, 10),
    },
    matches: matchCounts,
    byRing,
    upNext,
    divisionCount: divisions.length,
  });
});

export default router;
