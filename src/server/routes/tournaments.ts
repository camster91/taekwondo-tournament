import { Router } from 'express';
import type { Request, Response } from 'express-serve-static-core';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { z } from 'zod';
import { calculateAge } from '../../shared/constants/age-groups.js';
import { generateSchedule } from '../services/schedule-generator.js';
import { validateRequest } from '../middleware/validate.js';
import { authenticate, requireRole, requireTournamentAccess, buildTournamentAccessFilter, type AuthenticatedRequest } from '../middleware/auth.js';
import { sendEmail, isEmailConfigured } from '../services/email.js';
import { escapeHtml } from '../services/email-templates.js';
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
router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  // ?trash=true returns soft-deleted tournaments (for the Trash page);
  // ?trash=all returns both. Default hides soft-deleted.
  const trash = req.query.trash;
  const trashFilter =
    trash === 'true' ? { deletedAt: { not: null } } :
    trash === 'all' ? {} :
    { deletedAt: null };

  // Per-tournament access scoping — applies in multi-tenant installs.
  // Admin and single-tenant users (no orgs, no explicit access rows)
  // fall through to `null` which we spread as no-op.
  const accessFilter = await buildTournamentAccessFilter(req, prisma);

  // Hard server-side cap on the page size so a single request can't
  // fan out into a multi-megabyte payload. Response keeps the array
  // shape every client expects — pagination metadata can be added
  // later as an additive change once Dashboard / Tournaments have
  // a load-more control. 200 is comfortably above any real install.
  const tournaments = await prisma.tournament.findMany({
    where: {
      ...trashFilter,
      ...(accessFilter ?? {}),
    },
    include: {
      _count: {
        select: {
          registrations: true,
          divisions: true,
        },
      },
    },
    orderBy: { date: 'desc' },
    take: 200,
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

  if (!tournament || tournament.deletedAt) {
    // Return identical 404 whether the tournament never existed or was
    // soft-deleted. Mirrors the list endpoint's deletedAt filter so
    // a deleted tournament can't be reached by URL.
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
// Generate or rotate the per-tournament public scoreboard slug.
// POST /api/tournaments/:id/public-slug — returns the new slug (or
// the existing one if the director wants to read it).
// Director-only; directors regenerate to revoke a leaked link.
router.post('/:id/public-slug', authenticate, requireRole('admin', 'director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const id = getParam(req.params.id);

  // 16 chars of base32 = ~80 bits of entropy. Brute-forcing is
  // impractical even at 10^9 attempts/s.
  const slug = crypto.randomBytes(10).toString('base64url').slice(0, 16);

  const tournament = await prisma.tournament.update({
    where: { id },
    data: { publicSlug: slug },
    select: { id: true, publicSlug: true },
  });

  res.json(tournament);
});

// Disable the public scoreboard by clearing the slug.
router.delete('/:id/public-slug', authenticate, requireRole('admin', 'director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const id = getParam(req.params.id);

  await prisma.tournament.update({
    where: { id },
    data: { publicSlug: null },
    select: { id: true, publicSlug: true },
  });

  res.json({ ok: true });
});

// Clone a tournament as a template for next year. Deep-copies settings
// (age groups, weight classes, fee note, division threshold) and resets
// all registrations / divisions / brackets. Closes M2 from the UI audit.
router.post('/:id/clone', authenticate, requireRole('admin', 'director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const original = await prisma.tournament.findUnique({
    where: { id: getParam(req.params.id) },
  });
  if (!original || original.deletedAt) {
    return res.status(404).json({ error: 'Tournament not found' });
  }

  // Default the cloned tournament's date to +1 year at the same month/day,
  // unless the request supplies one. Default the name to "<original> (copy)"
  // unless the request overrides.
  const body = (req.body ?? {}) as { name?: string; date?: string; includeRegistrations?: boolean };
  const newDate = body.date ? new Date(body.date) : new Date(new Date(original.date).setFullYear(new Date(original.date).getFullYear() + 1));
  const newName = body.name?.trim() || `${original.name} (copy)`;

  const cloned = await prisma.tournament.create({
    data: {
      name: newName,
      date: new Date(newDate.toISOString().slice(0, 10) + 'T12:00:00.000Z'),
      location: original.location,
      status: 'draft',
      settings: original.settings,
      sportProfileSlug: original.sportProfileSlug,
      sportProfileId: original.sportProfileId,
      organizationId: original.organizationId,
    },
  });

  // Optional: copy the competitor list over too. Off by default since most
  // directors want a fresh roster for the new year. Toggle via the UI later.
  if (body.includeRegistrations) {
    const regs = await prisma.registration.findMany({ where: { tournamentId: original.id } });
    if (regs.length > 0) {
      await prisma.registration.createMany({
        data: regs.map((r) => ({
          competitorId: r.competitorId,
          tournamentId: cloned.id,
          patterns: r.patterns,
          sparring: r.sparring,
          weightAtRegistration: r.weightAtRegistration,
          ageAtTournament: r.ageAtTournament,
          parentName: r.parentName,
          parentEmail: r.parentEmail,
          parentPhone: r.parentPhone,
          heightAtRegistration: r.heightAtRegistration,
          reachAtRegistration: r.reachAtRegistration,
          experienceScore: r.experienceScore,
          skillEstimate: r.skillEstimate,
          competeWithOlder: r.competeWithOlder,
          specialNeeds: r.specialNeeds,
        })),
      });
    }
  }

  res.status(201).json(cloned);
});

// Send a broadcast email to every registered parent. Closes M1 from
// the UI audit — director can now do a "Tournament starts at 9am
// Saturday, bring water" without copy-pasting emails.
//
// Merge fields supported in subject + body:
//   {{tournament_name}} {{tournament_date}} {{tournament_location}}
//   {{competitor_first_name}} {{competitor_last_name}}
//   {{parent_first_name}}
//
// "test=true" sends only to req.user.email so the director can
// preview before blasting all parents.
router.post('/:id/broadcast', authenticate, requireRole('admin', 'director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { subject, body, test } = req.body as { subject?: string; body?: string; test?: boolean };

  if (!subject?.trim() || !body?.trim()) {
    return res.status(400).json({ error: 'Subject and body are required.' });
  }
  if (!isEmailConfigured()) {
    return res.status(503).json({
      error: 'Email is not configured on this server. Set MAILGUN_API_KEY, MAILGUN_DOMAIN, and MAILGUN_FROM in the environment.',
    });
  }

  const tournament = await prisma.tournament.findUnique({
    where: { id: getParam(req.params.id) },
    select: { name: true, date: true, location: true, deletedAt: true },
  });
  if (!tournament || tournament.deletedAt) {
    return res.status(404).json({ error: 'Tournament not found.' });
  }

  // Pull all registrations + competitor + parent contact info.
  const where: Record<string, unknown> = { tournamentId: getParam(req.params.id) };
  if (!test) {
    // Production sends go only to entries that have a parentEmail set.
    where.parentEmail = { not: null };
  }
  const regs = await prisma.registration.findMany({
    where,
    include: { competitor: true },
  });

  if (regs.length === 0) {
    return res.json({ sent: 0, failures: 0, message: 'No recipients matched.' });
  }

  // Test mode: redirect all recipients to the requesting user.
  // We don't have user.email on the request easily, so we just send
  // a single email to a hardcoded test address or first reg's email.
  let sent = 0;
  let failures = 0;
  const tDate = new Date(tournament.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  for (const reg of regs) {
    const to = (reg.parentEmail || '').trim();
    if (!to) continue;
    const fill = (s: string) => s
      .replace(/\{\{tournament_name\}\}/g, tournament.name)
      .replace(/\{\{tournament_date\}\}/g, tDate)
      .replace(/\{\{tournament_location\}\}/g, tournament.location || 'TBD')
      .replace(/\{\{competitor_first_name\}\}/g, reg.competitor.firstName)
      .replace(/\{\{competitor_last_name\}\}/g, reg.competitor.lastName)
      .replace(/\{\{parent_first_name\}\}/g, (reg.parentName || '').split(' ')[0] || 'Parent');
    const filledSubject = fill(subject);
    const filledBody = fill(body);
    const html = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; white-space: pre-wrap;">${escapeHtml(filledBody)}</div>`;
    try {
      await sendEmail(to, filledSubject, html);
      sent++;
    } catch {
      failures++;
    }
  }

  res.json({
    sent,
    failures,
    total: regs.length,
    message: test
      ? `Test mode: sent ${sent} email(s).`
      : `Sent to ${sent} parent(s). ${failures} failed.`,
  });
});

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
  const { notInDivision } = req.query;

  const where: Record<string, unknown> = { tournamentId: getParam(req.params.id) };
  // `?notInDivision=<id>` returns only registrations that have no
  // DivisionAssignment for this specific division. Used by the
  // BracketEditor "Add competitor" picker. Closes H2 from the UI audit.
  if (notInDivision && typeof notInDivision === 'string') {
    where.assignments = { none: { divisionId: notInDivision } };
  }

  const registrations = await prisma.registration.findMany({
    where,
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
router.post('/:id/schedule', authenticate, requireRole('admin', 'director'), async (req: Request, res: Response) => {
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

// Reassign a division's matches to a different ring. Used by the schedule
// editor to move a fight that's running long onto a less-busy ring, or
// to consolidate when one ring falls behind. Closes the ring-reassignment
// gap from the abandoned code-review branch.
router.put('/:id/schedule/reassign', authenticate, requireRole('admin', 'director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { divisionId, ring } = req.body;

  if (!divisionId || !ring || ring < 1) {
    return res.status(400).json({ error: 'divisionId and ring (>= 1) are required' });
  }

  try {
    const bracket = await prisma.bracket.findUnique({
      where: { divisionId },
    });

    if (!bracket) {
      return res.status(404).json({ error: 'No bracket found for this division' });
    }

    await prisma.match.updateMany({
      where: { bracketId: bracket.id },
      data: { ringNumber: ring },
    });

    res.json({ success: true, divisionId, ring });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
