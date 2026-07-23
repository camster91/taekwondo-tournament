import { Router } from 'express';
import type { Request, Response } from 'express-serve-static-core';
import { PrismaClient } from '@prisma/client';
import { authenticate, requireTournamentAccess, buildTournamentAccessFilter, checkTournamentAccess } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { buildDashboardWhereClauses } from './analytics-validation.js';

const router = Router();

// Get dashboard analytics
router.get('/dashboard', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  try {
    // Filter soft-deleted rows out of the public dashboard analytics.
    // The Competitor / Tournament models use deletedAt as a 7-day trash
    // window; without this filter, soft-deleted demo rows leak into the
    // dashboard counts and charts.
    const notDeleted = { deletedAt: null };

    // Closes B35: scope all dashboard counts to the tournaments the
    // user is allowed to see. buildTournamentAccessFilter returns
    // null = "see everything" (admins / legacy single-tenant).
    // Closes Phase 18: every count below also applies tournamentFilter
    // — the prior handler had `prisma.match.count()` with no where at
    // all, so a viewer in org A could see totalMatches across every
    // tournament in the database. See analytics-validation.ts.
    const tournamentFilter = await buildTournamentAccessFilter(req, prisma);
    const where = buildDashboardWhereClauses(tournamentFilter, notDeleted);

    // Get total counts
    const [totalCompetitors, totalTournaments, totalMatches] = await Promise.all([
      prisma.competitor.count({ where: where.competitor }),
      prisma.tournament.count({ where: where.tournament }),
      prisma.match.count({ where: where.match }),
    ]);

    // Get completed matches
    const completedMatches = await prisma.match.count({
      where: { ...where.match, status: 'completed' },
    });

    // Get competitors by belt level
    const beltDistribution = await prisma.competitor.groupBy({
      by: ['belt'],
      where: where.competitor,
      _count: true,
      orderBy: { _count: { belt: 'desc' } },
    });

    // Get competitors by gender
    const genderDistribution = await prisma.competitor.groupBy({
      by: ['gender'],
      where: where.competitor,
      _count: true,
    });

    // Get top schools by competitor count
    const topSchools = await prisma.competitor.groupBy({
      by: ['schoolDojang'],
      where: { ...where.competitor, schoolDojang: { not: null } },
      _count: true,
      orderBy: { _count: { schoolDojang: 'desc' } },
      take: 10,
    });

    // Get recent activity (registrations in last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentRegistrations = await prisma.registration.count({
      where: { ...where.registration, createdAt: { gte: thirtyDaysAgo } },
    });

    // Get matches by status
    const matchesByStatus = await prisma.match.groupBy({
      by: ['status'],
      where: where.match,
      _count: true,
    });

    // Get age distribution (approximate using birth year)
    const competitors = await prisma.competitor.findMany({
      where: where.competitor,
      select: { dateOfBirth: true },
    });

    const ageGroups: Record<string, number> = {
      '4-7': 0,
      '8-11': 0,
      '12-14': 0,
      '15-17': 0,
      '18-35': 0,
      '36+': 0,
    };

    const now = new Date();
    competitors.forEach((c) => {
      const age = Math.floor((now.getTime() - new Date(c.dateOfBirth).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
      if (age >= 4 && age <= 7) ageGroups['4-7']++;
      else if (age >= 8 && age <= 11) ageGroups['8-11']++;
      else if (age >= 12 && age <= 14) ageGroups['12-14']++;
      else if (age >= 15 && age <= 17) ageGroups['15-17']++;
      else if (age >= 18 && age <= 35) ageGroups['18-35']++;
      else if (age >= 36) ageGroups['36+']++;
    });

    res.json({
      totals: {
        competitors: totalCompetitors,
        tournaments: totalTournaments,
        matches: totalMatches,
        completedMatches,
        recentRegistrations,
      },
      beltDistribution: beltDistribution.map((b) => ({
        belt: b.belt,
        count: b._count,
      })),
      genderDistribution: genderDistribution.map((g) => ({
        gender: g.gender === 'M' ? 'Male' : 'Female',
        count: g._count,
      })),
      topSchools: topSchools.map((s) => ({
        school: s.schoolDojang || 'Unknown',
        count: s._count,
      })),
      matchesByStatus: matchesByStatus.map((m) => ({
        status: m.status,
        count: m._count,
      })),
      ageDistribution: Object.entries(ageGroups).map(([range, count]) => ({
        range,
        count,
      })),
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// Get tournament-specific analytics (requires authentication + tournament access;
// closes S5 + B36). Replaces the full `competitor: true` include with a
// `select` projection that excludes PII (dateOfBirth, specialNeeds,
// weightLbs, heightInches, danRank). Only non-sensitive fields needed
// for school aggregation are fetched, and the response remains aggregate-only.
router.get('/tournament/:tournamentId', authenticate, requireTournamentAccess('viewer'), async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { tournamentId } = req.params;

  try {
    // Authorization BEFORE the expensive payload. The previous order
    // (full findUnique → checkTournamentAccess) paid the cost of
    // eager-loading registrations + competitors + divisions + brackets
    // + matches before denying unauthorized requests — a DoS vector
    // (malicious user hammering a server with foreign tournamentIds)
    // and a timing-side-channel leak (response time revealed whether
    // the user had access). The access check now runs first; the
    // minimal findUnique it performs inside (organizationId + deletedAt
    // only) is two orders of magnitude cheaper. checkTournamentAccess
    // also returns 404 for missing/soft-deleted tournaments with the
    // same error message, so the previous explicit 404 branch is
    // folded into the access result.
    const access = await checkTournamentAccess(
      req,
      prisma,
      tournamentId,
      'viewer'
    );
    if (!access.ok) {
      return res.status(access.status || 403).json({ error: access.error });
    }

    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId, deletedAt: null },
      include: {
        registrations: {
          include: {
            competitor: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                schoolDojang: true,
              },
            },
          },
        },
        divisions: {
          include: {
            bracket: { include: { matches: true } },
          },
        },
      },
    });

    if (!tournament) {
      // Race: tournament was hard-deleted between the access check
      // and this query (admin wipe, etc.). Same shape as the access
      // check's own 404 so callers see one consistent error.
      return res.status(404).json({ error: 'Tournament not found' });
    }

    // School participation. Note: tournament.registrations is already
    // eager-loaded via the include above, so the JS-side aggregation
    // is on in-memory data — no extra round trips. (P2 was flagged
    // for the pattern, but the actual `competitor.groupBy` we want
    // here can't filter by tournament directly because groupBy
    // doesn't follow the registration relation. A raw SQL count
    // would be marginally faster for very large tournaments but
    // not worth the maintainability hit here.)
    const schoolCounts: Record<string, number> = {};
    tournament.registrations.forEach((r) => {
      const school = r.competitor.schoolDojang || 'Unknown';
      schoolCounts[school] = (schoolCounts[school] || 0) + 1;
    });

    const topSchools = Object.entries(schoolCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([school, count]) => ({ school, count }));

    // Division breakdown
    const divisionStats = tournament.divisions.map((d) => {
      const totalMatches = d.bracket?.matches.length || 0;
      const completedMatches = d.bracket?.matches.filter((m) => m.status === 'completed').length || 0;
      return {
        id: d.id,
        name: d.name,
        eventType: d.eventType,
        totalMatches,
        completedMatches,
        progress: totalMatches > 0 ? Math.round((completedMatches / totalMatches) * 100) : 0,
      };
    });

    // Registration stats
    const patternsCount = tournament.registrations.filter((r) => r.patterns).length;
    const sparringCount = tournament.registrations.filter((r) => r.sparring).length;
    const checkedInCount = tournament.registrations.filter((r) => r.checkedIn).length;

    res.json({
      tournamentId,
      name: tournament.name,
      registrations: {
        total: tournament.registrations.length,
        patterns: patternsCount,
        sparring: sparringCount,
        checkedIn: checkedInCount,
        checkInRate: tournament.registrations.length > 0
          ? Math.round((checkedInCount / tournament.registrations.length) * 100)
          : 0,
      },
      divisions: {
        total: tournament.divisions.length,
        byType: {
          patterns: tournament.divisions.filter((d) => d.eventType === 'patterns').length,
          sparring: tournament.divisions.filter((d) => d.eventType === 'sparring').length,
        },
        stats: divisionStats,
      },
      topSchools,
    });
  } catch (error) {
    console.error('Tournament analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch tournament analytics' });
  }
});

export default router;
