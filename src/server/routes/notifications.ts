import { Router } from 'express';
import type { Response } from 'express-serve-static-core';
import { PrismaClient, Prisma } from '@prisma/client';
import {
  authenticate,
  buildTournamentAccessFilter,
  resolveTournamentScope,
  type AuthenticatedRequest,
} from '../middleware/auth.js';
import { readStoredScheduleConfig } from '../services/schedule-correction.js';
import { computeCoverage } from '../services/staffing-coverage.js';
import {
  buildNotifications,
  type NotificationSources,
  type TournamentCount,
} from '../services/notifications.js';

// GET /api/notifications — the top-bar bell (#17). Read-only and computed
// from existing rows. Tournament items are limited to tournaments the
// caller can manage (director level); support and invite items follow the
// same visibility as the Support Tickets and Users pages.

const router = Router();

const DAY_MS = 24 * 60 * 60 * 1000;
/** Tournaments checked for staffing gaps / your own jobs: yesterday..+2 days. */
const DAY_OF_WINDOW = { beforeMs: DAY_MS, afterMs: 2 * DAY_MS };
const MAX_TOURNAMENTS = 10;

async function countsByTournament(
  prisma: PrismaClient,
  where: Prisma.RegistrationWhereInput,
): Promise<TournamentCount[]> {
  const groups = await prisma.registration.groupBy({
    by: ['tournamentId'],
    where,
    _count: { _all: true },
    _max: { createdAt: true },
    orderBy: { _max: { createdAt: 'desc' } },
    take: MAX_TOURNAMENTS,
  });
  if (groups.length === 0) return [];
  const tournaments = await prisma.tournament.findMany({
    where: { id: { in: groups.map((g) => g.tournamentId) } },
    select: { id: true, name: true },
  });
  const names = new Map(tournaments.map((t) => [t.id, t.name]));
  return groups.map((g) => ({
    tournamentId: g.tournamentId,
    tournamentName: names.get(g.tournamentId) ?? 'Tournament',
    count: g._count._all,
    latestAt: g._max.createdAt ?? new Date(0),
  }));
}

router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const user = req.user!;
  const now = Date.now();
  const isAdmin = user.role === 'admin';
  const canManage = isAdmin || user.role === 'director';
  const sources: NotificationSources = {};

  const dayOfRange = {
    gte: new Date(now - DAY_OF_WINDOW.beforeMs),
    lte: new Date(now + DAY_OF_WINDOW.afterMs),
  };

  // Everyone: their own staff jobs for today / the next two days.
  const viewFilter = await buildTournamentAccessFilter(req, prisma);
  const mine = await prisma.staffAssignment.findMany({
    where: {
      userId: user.id,
      status: 'active',
      tournament: { deletedAt: null, status: { not: 'completed' }, date: dayOfRange, ...(viewFilter ?? {}) },
    },
    select: {
      id: true, duty: true, ringNumber: true, startTime: true, endTime: true, updatedAt: true,
      tournament: { select: { id: true, name: true } },
    },
    orderBy: { startTime: 'asc' },
    take: MAX_TOURNAMENTS,
  });
  sources.myAssignments = mine.map((a) => ({
    id: a.id,
    tournamentId: a.tournament.id,
    tournamentName: a.tournament.name,
    duty: a.duty,
    ringNumber: a.ringNumber,
    startTime: a.startTime,
    endTime: a.endTime,
    updatedAt: a.updatedAt,
  }));

  if (canManage) {
    const scope = await resolveTournamentScope(req, prisma, 'director');
    const managed: Prisma.TournamentWhereInput = { deletedAt: null, ...(scope.filter ?? {}) };

    const [newRegistrations, waitlisted, dayOfTournaments] = await Promise.all([
      countsByTournament(prisma, {
        createdAt: { gte: new Date(now - DAY_MS) },
        waitlistStatus: { in: ['active', 'promoted'] },
        tournament: managed,
      }),
      countsByTournament(prisma, {
        waitlistStatus: 'waitlisted',
        tournament: { ...managed, status: { not: 'completed' } },
      }),
      prisma.tournament.findMany({
        where: { ...managed, status: { not: 'completed' }, date: dayOfRange },
        select: {
          id: true, name: true, date: true, settings: true,
          staffAssignments: {
            where: { status: 'active' },
            select: { id: true, userId: true, duty: true, ringNumber: true, startTime: true, endTime: true },
          },
        },
        orderBy: { date: 'asc' },
        take: MAX_TOURNAMENTS,
      }),
    ]);
    sources.newRegistrations = newRegistrations;
    sources.waitlisted = waitlisted;

    const lastChanges = dayOfTournaments.length > 0
      ? await prisma.staffAssignment.groupBy({
        by: ['tournamentId'],
        where: { tournamentId: { in: dayOfTournaments.map((t) => t.id) } },
        _max: { updatedAt: true },
      })
      : [];
    const lastChangeBy = new Map(lastChanges.map((c) => [c.tournamentId, c._max.updatedAt]));

    sources.staffingGaps = dayOfTournaments.flatMap((t) => {
      const config = readStoredScheduleConfig(t.settings);
      try {
        const coverage = computeCoverage({
          ringCount: config.ringCount,
          windowStart: config.startTime,
          windowEnd: config.endTime,
          assignments: t.staffAssignments,
        });
        const ringsWithGaps = new Set(coverage.gaps.map((g) => g.ringNumber)).size;
        return [{
          tournamentId: t.id,
          tournamentName: t.name,
          tournamentDate: t.date,
          ringsWithGaps,
          ringCount: coverage.ringCount,
          lastAssignmentChangeAt: lastChangeBy.get(t.id) ?? null,
        }];
      } catch {
        // A malformed stored schedule time; the Staffing page reports it.
        return [];
      }
    });

    // Support requests: admins see all; directors see their organizations'.
    const orgIds = isAdmin
      ? null
      : (await prisma.organizationMember.findMany({
        where: { userId: user.id },
        select: { organizationId: true },
      })).map((m) => m.organizationId);
    const ticketWhere: Prisma.SupportTicketWhereInput = {
      status: 'open',
      ...(orgIds ? { organizationId: { in: orgIds } } : {}),
    };
    const [open, bugReports, latest] = await Promise.all([
      prisma.supportTicket.count({ where: ticketWhere }),
      prisma.supportTicket.count({ where: { ...ticketWhere, source: 'bug-report' } }),
      prisma.supportTicket.findFirst({ where: ticketWhere, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    ]);
    sources.supportTickets = { open, bugReports, latestAt: latest?.createdAt ?? null };
  }

  if (isAdmin) {
    // Invitations are managed on the admin-only Users page.
    const pendingWhere: Prisma.InvitationWhereInput = { status: 'pending', tokenExpiry: { gt: new Date(now) } };
    const failedWhere: Prisma.InvitationWhereInput = { ...pendingWhere, deliveryStatus: 'failed' };
    const [pending, failed] = await Promise.all([
      prisma.invitation.aggregate({ where: pendingWhere, _count: { _all: true }, _max: { createdAt: true } }),
      prisma.invitation.aggregate({ where: failedWhere, _count: { _all: true }, _max: { updatedAt: true } }),
    ]);
    sources.pendingInvites = { count: pending._count._all, latestAt: pending._max.createdAt };
    sources.failedInviteEmails = { count: failed._count._all, latestAt: failed._max.updatedAt };
  }

  res.json({ notifications: buildNotifications(sources), generatedAt: new Date(now).toISOString() });
});

export default router;
