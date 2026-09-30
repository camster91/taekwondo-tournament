import { Router } from 'express';
import type { Response } from 'express-serve-static-core';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { validateRequest } from '../middleware/validate.js';
import {
  authenticate,
  buildTournamentAccessFilter,
  checkTournamentAccess,
  type AuthenticatedRequest,
} from '../middleware/auth.js';
import { readStoredScheduleConfig } from '../services/schedule-correction.js';
import {
  STAFF_DUTIES,
  computeCoverage,
  isValidTime,
  toMinutes,
} from '../services/staffing-coverage.js';

// Day-of staffing (#192). Assignments are operational only: they never
// grant access. Directors manage them; any staff member reads their own.

const router = Router();

const MAX_RINGS = 100;

const time = z.string().refine(isValidTime, 'Use HH:MM (24-hour)');

const assignmentFields = {
  userId: z.string().uuid(),
  duty: z.enum(STAFF_DUTIES),
  ringNumber: z.number().int().min(1).max(MAX_RINGS).nullable(),
  startTime: time,
  endTime: time,
  note: z.string().trim().max(200).nullable().optional(),
};

export const createAssignmentSchema = z.object(assignmentFields).refine(
  // Malformed times are reported by their own field checks; Zod still runs
  // this refinement, so it must not throw on them.
  (value) => !isValidTime(value.startTime) || !isValidTime(value.endTime)
    || toMinutes(value.endTime) > toMinutes(value.startTime),
  { message: 'End time must be after start time', path: ['endTime'] },
);

export const updateAssignmentSchema = z.object({
  duty: assignmentFields.duty.optional(),
  ringNumber: assignmentFields.ringNumber.optional(),
  startTime: time.optional(),
  endTime: time.optional(),
  note: assignmentFields.note,
});

type StaffUser = { id: string; firstName: string; lastName: string; email: string; role: string };

const staffUserSelect = { id: true, firstName: true, lastName: true, email: true, role: true } as const;

function param(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

/**
 * Active users who can open this tournament at viewer level or above: its
 * organization's members, explicit per-tournament grants and, for a legacy
 * org-less tournament, users outside every organization. Each candidate is
 * re-checked with the real access rules so the list can never drift from
 * what the user could actually open.
 */
async function eligibleStaff(prisma: PrismaClient, tournamentId: string): Promise<StaffUser[]> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { organizationId: true },
  });
  if (!tournament) return [];

  const [grants, members, legacyPool] = await Promise.all([
    prisma.userTournamentAccess.findMany({
      where: { tournamentId, user: { isActive: true } },
      select: { user: { select: staffUserSelect } },
    }),
    tournament.organizationId
      ? prisma.organizationMember.findMany({
        where: { organizationId: tournament.organizationId, user: { isActive: true } },
        select: { user: { select: staffUserSelect } },
      })
      : Promise.resolve([]),
    tournament.organizationId
      ? Promise.resolve([])
      : prisma.user.findMany({
        where: { isActive: true, organizationMembers: { none: {} } },
        select: staffUserSelect,
        take: 500,
      }),
  ]);

  const candidates = new Map<string, StaffUser>();
  for (const row of [...grants, ...members]) candidates.set(row.user.id, row.user);
  for (const user of legacyPool) candidates.set(user.id, user);

  const eligible: StaffUser[] = [];
  for (const user of candidates.values()) {
    const access = await checkTournamentAccess(
      { user: { ...user, isDemo: false } },
      prisma,
      tournamentId,
      'viewer',
    );
    if (access.ok) eligible.push(user);
  }
  return eligible.sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`));
}

async function loadBoard(prisma: PrismaClient, tournamentId: string) {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { id: true, name: true, date: true, settings: true },
  });
  if (!tournament) return null;
  const config = readStoredScheduleConfig(tournament.settings);
  const assignments = await prisma.staffAssignment.findMany({
    where: { tournamentId },
    include: { user: { select: staffUserSelect } },
    orderBy: [{ status: 'asc' }, { ringNumber: 'asc' }, { startTime: 'asc' }],
  });
  const active = assignments.filter((a) => a.status === 'active');
  const coverage = computeCoverage({
    ringCount: config.ringCount,
    windowStart: config.startTime,
    windowEnd: config.endTime,
    assignments: active,
  });
  return {
    tournament: { id: tournament.id, name: tournament.name, date: tournament.date },
    window: { startTime: config.startTime, endTime: config.endTime, ringCount: config.ringCount },
    assignments,
    coverage,
  };
}

async function writeAudit(
  prisma: PrismaClient,
  input: { tournamentId: string; operationType: string; before: unknown; after: unknown; summary: string; userId: string },
) {
  await prisma.tournamentOperationAudit.create({
    data: {
      tournamentId: input.tournamentId,
      operationType: input.operationType,
      operationKey: randomUUID(),
      beforeState: input.before === null ? null : JSON.stringify(input.before),
      afterState: JSON.stringify(input.after),
      impactSummary: JSON.stringify({ summary: input.summary }),
      reversible: false,
      createdBy: input.userId,
    },
  });
}

async function ringCountFor(prisma: PrismaClient, tournamentId: string): Promise<number | null> {
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { settings: true } });
  return tournament ? readStoredScheduleConfig(tournament.settings).ringCount : null;
}

// GET /api/staffing/tournament/:tournamentId — director coverage board
router.get('/tournament/:tournamentId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const tournamentId = param(req.params.tournamentId);
  const access = await checkTournamentAccess(req, prisma, tournamentId, 'director');
  if (!access.ok) return res.status(access.status || 403).json({ error: access.error || 'Forbidden' });

  const board = await loadBoard(prisma, tournamentId);
  if (!board) return res.status(404).json({ error: 'Tournament not found' });
  const staff = await eligibleStaff(prisma, tournamentId);
  res.json({ ...board, eligibleStaff: staff, generatedAt: new Date().toISOString() });
});

// GET /api/staffing/tournament/:tournamentId/mine — the caller's own run sheet
router.get('/tournament/:tournamentId/mine', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const tournamentId = param(req.params.tournamentId);
  const access = await checkTournamentAccess(req, prisma, tournamentId, 'viewer');
  if (!access.ok) return res.status(access.status || 403).json({ error: access.error || 'Forbidden' });

  const assignments = await prisma.staffAssignment.findMany({
    where: { tournamentId, userId: req.user!.id, status: 'active' },
    select: { id: true, duty: true, ringNumber: true, startTime: true, endTime: true, note: true },
    orderBy: { startTime: 'asc' },
  });
  res.json({ assignments, generatedAt: new Date().toISOString() });
});

// GET /api/staffing/mine — the caller's active assignments in every
// tournament they can still open (upcoming and in progress first).
router.get('/mine', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const filter = await buildTournamentAccessFilter(req, prisma);
  const assignments = await prisma.staffAssignment.findMany({
    where: {
      userId: req.user!.id,
      status: 'active',
      tournament: { deletedAt: null, status: { not: 'completed' }, ...(filter ?? {}) },
    },
    select: {
      id: true, duty: true, ringNumber: true, startTime: true, endTime: true, note: true,
      tournament: { select: { id: true, name: true, date: true, location: true } },
    },
    orderBy: [{ tournament: { date: 'asc' } }, { startTime: 'asc' }],
  });
  res.json({ assignments, generatedAt: new Date().toISOString() });
});

// POST /api/staffing/tournament/:tournamentId/assignments — assign someone
router.post(
  '/tournament/:tournamentId/assignments',
  authenticate,
  validateRequest(createAssignmentSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    const prisma: PrismaClient = req.app.locals.prisma;
    const tournamentId = param(req.params.tournamentId);
    const access = await checkTournamentAccess(req, prisma, tournamentId, 'director');
    if (!access.ok) return res.status(access.status || 403).json({ error: access.error || 'Forbidden' });

    const body = req.body as z.infer<typeof createAssignmentSchema>;
    const ringCount = await ringCountFor(prisma, tournamentId);
    if (ringCount === null) return res.status(404).json({ error: 'Tournament not found' });
    if (body.ringNumber !== null && body.ringNumber > ringCount) {
      return res.status(400).json({ error: `This tournament has ${ringCount} ring(s)` });
    }
    const staff = await eligibleStaff(prisma, tournamentId);
    if (!staff.some((user) => user.id === body.userId)) {
      return res.status(400).json({ error: 'That person cannot open this tournament. Invite them or grant access first.' });
    }

    const created = await prisma.staffAssignment.create({
      data: {
        tournamentId,
        userId: body.userId,
        duty: body.duty,
        ringNumber: body.ringNumber,
        startTime: body.startTime,
        endTime: body.endTime,
        note: body.note || null,
        createdById: req.user!.id,
      },
      include: { user: { select: staffUserSelect } },
    });
    await writeAudit(prisma, {
      tournamentId,
      operationType: 'staff_assignment_created',
      before: null,
      after: created,
      summary: `Assigned ${created.user.firstName} ${created.user.lastName} as ${created.duty}`,
      userId: req.user!.id,
    });
    res.status(201).json({ assignment: created });
  },
);

async function loadOwnedAssignment(req: AuthenticatedRequest, res: Response) {
  const prisma: PrismaClient = req.app.locals.prisma;
  const assignment = await prisma.staffAssignment.findUnique({ where: { id: param(req.params.id) } });
  if (!assignment) {
    res.status(404).json({ error: 'Assignment not found' });
    return null;
  }
  const access = await checkTournamentAccess(req, prisma, assignment.tournamentId, 'director');
  if (!access.ok) {
    // Same answer as "not found" for assignments in tournaments you can't see.
    res.status(access.status === 403 ? 404 : access.status || 404).json({ error: 'Assignment not found' });
    return null;
  }
  return assignment;
}

// PUT /api/staffing/assignments/:id — change duty, ring, times or note
router.put(
  '/assignments/:id',
  authenticate,
  validateRequest(updateAssignmentSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    const prisma: PrismaClient = req.app.locals.prisma;
    const existing = await loadOwnedAssignment(req, res);
    if (!existing) return;
    if (existing.status !== 'active') return res.status(409).json({ error: 'Withdrawn assignments cannot be edited' });

    const body = req.body as z.infer<typeof updateAssignmentSchema>;
    const next = {
      duty: body.duty ?? existing.duty,
      ringNumber: body.ringNumber === undefined ? existing.ringNumber : body.ringNumber,
      startTime: body.startTime ?? existing.startTime,
      endTime: body.endTime ?? existing.endTime,
      note: body.note === undefined ? existing.note : body.note || null,
    };
    if (toMinutes(next.endTime) <= toMinutes(next.startTime)) {
      return res.status(400).json({ error: 'End time must be after start time' });
    }
    const ringCount = await ringCountFor(prisma, existing.tournamentId);
    if (next.ringNumber !== null && ringCount !== null && next.ringNumber > ringCount) {
      return res.status(400).json({ error: `This tournament has ${ringCount} ring(s)` });
    }

    // Conditional on the row still being active so a concurrent withdraw wins.
    const updated = await prisma.staffAssignment.updateMany({
      where: { id: existing.id, status: 'active' },
      data: next,
    });
    if (updated.count !== 1) return res.status(409).json({ error: 'Assignment was withdrawn meanwhile' });
    const assignment = await prisma.staffAssignment.findUnique({
      where: { id: existing.id },
      include: { user: { select: staffUserSelect } },
    });
    await writeAudit(prisma, {
      tournamentId: existing.tournamentId,
      operationType: 'staff_assignment_updated',
      before: existing,
      after: assignment,
      summary: 'Updated a staff assignment',
      userId: req.user!.id,
    });
    res.json({ assignment });
  },
);

// POST /api/staffing/assignments/:id/withdraw — keep the row, end the duty
router.post('/assignments/:id/withdraw', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const existing = await loadOwnedAssignment(req, res);
  if (!existing) return;

  const withdrawn = await prisma.staffAssignment.updateMany({
    where: { id: existing.id, status: 'active' },
    data: { status: 'withdrawn', withdrawnAt: new Date(), withdrawnById: req.user!.id },
  });
  if (withdrawn.count !== 1) return res.status(409).json({ error: 'Assignment is already withdrawn' });
  await writeAudit(prisma, {
    tournamentId: existing.tournamentId,
    operationType: 'staff_assignment_withdrawn',
    before: existing,
    after: { ...existing, status: 'withdrawn' },
    summary: 'Withdrew a staff assignment',
    userId: req.user!.id,
  });
  res.status(204).send();
});

export default router;
