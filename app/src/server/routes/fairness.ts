import { Router } from 'express';
import type { Request, Response } from 'express-serve-static-core';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { validateRequest } from '../middleware/validate.js';
import {
  quickFairnessCheck,
  getDivisionFairnessRecommendations,
  calculateBracketFairness,
} from '../services/fairness-calculator.js';
import { getRatingProfile, batchGetRatings } from '../services/skill-rating.js';
import {
  getHeadToHead,
  getRecentOpponents,
  getRematchRecommendations,
} from '../services/matchup-history.js';

const router = Router();

// Helper to safely get string param
const getParam = (param: string | string[] | undefined): string => {
  if (Array.isArray(param)) return param[0];
  return param || '';
};

// Validation schemas
const matchupCheckSchema = z.object({
  registration1Id: z.string().min(1),
  registration2Id: z.string().min(1),
  eventType: z.enum(['patterns', 'sparring']),
  tournamentId: z.string().min(1),
  ageMin: z.number().int().min(0),
  ageMax: z.number().int().min(0),
});

// GET /api/fairness/division/:divisionId/report
// Returns comprehensive fairness analysis for a division
router.get('/division/:divisionId/report', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const divisionId = getParam(req.params.divisionId);

  const division = await prisma.division.findUnique({
    where: { id: divisionId },
    include: { tournament: true },
  });

  if (!division) {
    return res.status(404).json({ error: 'Division not found' });
  }

  const eventType = division.eventType as 'patterns' | 'sparring';

  const recommendations = await getDivisionFairnessRecommendations(
    prisma,
    divisionId,
    eventType,
    division.tournamentId
  );

  res.json({
    divisionId,
    divisionName: division.name,
    eventType,
    ...recommendations,
  });
});

// POST /api/fairness/matchup/check
// Quick check fairness between two specific competitors
router.post('/matchup/check', validateRequest(matchupCheckSchema), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { registration1Id, registration2Id, eventType, tournamentId, ageMin, ageMax } = req.body;

  const result = await quickFairnessCheck(
    prisma,
    registration1Id,
    registration2Id,
    eventType,
    tournamentId,
    ageMin,
    ageMax
  );

  res.json(result);
});

// GET /api/fairness/bracket/:bracketId/analysis
// Analyzes bracket difficulty distribution
router.get('/bracket/:bracketId/analysis', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const bracketId = getParam(req.params.bracketId);

  const bracket = await prisma.bracket.findUnique({
    where: { id: bracketId },
    include: {
      division: {
        include: { tournament: true },
      },
    },
  });

  if (!bracket) {
    return res.status(404).json({ error: 'Bracket not found' });
  }

  const division = bracket.division;
  const eventType = division.eventType as 'patterns' | 'sparring';
  const ageGroup = `${division.ageMin}-${division.ageMax}`;

  let structure;
  try {
    structure = JSON.parse(bracket.structure);
  } catch {
    return res.status(400).json({ error: 'Invalid bracket structure' });
  }

  const analysis = await calculateBracketFairness(
    prisma,
    division.id,
    structure,
    eventType,
    division.tournamentId,
    ageGroup
  );

  res.json({
    bracketId,
    divisionName: division.name,
    ...analysis,
  });
});

// GET /api/fairness/competitor/:competitorId/rating
// Returns skill rating and history for a competitor
router.get('/competitor/:competitorId/rating', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const competitorId = getParam(req.params.competitorId);
  const eventType = (getParam(req.query.eventType as string) || 'sparring') as 'patterns' | 'sparring';

  const competitor = await prisma.competitor.findUnique({
    where: { id: competitorId },
  });

  if (!competitor) {
    return res.status(404).json({ error: 'Competitor not found' });
  }

  const profile = await getRatingProfile(prisma, competitorId, eventType);

  res.json({
    competitorId,
    name: `${competitor.firstName} ${competitor.lastName}`,
    eventType,
    ...profile,
  });
});

// GET /api/fairness/competitor/:competitorId/opponents
// Returns recent opponents for a competitor
router.get('/competitor/:competitorId/opponents', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const competitorId = getParam(req.params.competitorId);
  const limit = parseInt(getParam(req.query.limit as string)) || 10;

  const recentOpponents = await getRecentOpponents(prisma, competitorId, limit);

  // Get opponent details
  const opponents = await prisma.competitor.findMany({
    where: { id: { in: recentOpponents } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      schoolDojang: true,
    },
  });

  res.json(opponents);
});

// GET /api/fairness/head-to-head/:competitor1Id/:competitor2Id
// Returns head-to-head history between two competitors
router.get('/head-to-head/:competitor1Id/:competitor2Id', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const competitor1Id = getParam(req.params.competitor1Id);
  const competitor2Id = getParam(req.params.competitor2Id);

  const [comp1, comp2] = await Promise.all([
    prisma.competitor.findUnique({
      where: { id: competitor1Id },
      select: { id: true, firstName: true, lastName: true },
    }),
    prisma.competitor.findUnique({
      where: { id: competitor2Id },
      select: { id: true, firstName: true, lastName: true },
    }),
  ]);

  if (!comp1 || !comp2) {
    return res.status(404).json({ error: 'Competitor not found' });
  }

  const history = await getHeadToHead(prisma, competitor1Id, competitor2Id);

  res.json({
    competitor1: {
      id: comp1.id,
      name: `${comp1.firstName} ${comp1.lastName}`,
    },
    competitor2: {
      id: comp2.id,
      name: `${comp2.firstName} ${comp2.lastName}`,
    },
    history: history || {
      totalMatches: 0,
      competitor1Wins: 0,
      competitor2Wins: 0,
      matchHistory: [],
    },
  });
});

// GET /api/fairness/division/:divisionId/rematch-warnings
// Get rematch avoidance recommendations for a division
router.get('/division/:divisionId/rematch-warnings', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const divisionId = getParam(req.params.divisionId);

  const division = await prisma.division.findUnique({
    where: { id: divisionId },
  });

  if (!division) {
    return res.status(404).json({ error: 'Division not found' });
  }

  // Get competitor IDs in this division
  const assignments = await prisma.divisionAssignment.findMany({
    where: { divisionId },
    include: {
      registration: {
        select: { competitorId: true },
      },
    },
  });

  const competitorIds = assignments.map((a) => a.registration.competitorId);

  const recommendations = await getRematchRecommendations(
    prisma,
    competitorIds,
    division.tournamentId
  );

  // Enrich with competitor names
  const competitors = await prisma.competitor.findMany({
    where: { id: { in: competitorIds } },
    select: { id: true, firstName: true, lastName: true },
  });

  const nameMap = new Map(competitors.map((c) => [c.id, `${c.firstName} ${c.lastName}`]));

  res.json(
    recommendations.map((r) => ({
      ...r,
      competitor1Name: nameMap.get(r.competitor1Id) || 'Unknown',
      competitor2Name: nameMap.get(r.competitor2Id) || 'Unknown',
    }))
  );
});

// GET /api/fairness/division/:divisionId/ratings
// Get skill ratings for all competitors in a division
router.get('/division/:divisionId/ratings', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const divisionId = getParam(req.params.divisionId);

  const division = await prisma.division.findUnique({
    where: { id: divisionId },
  });

  if (!division) {
    return res.status(404).json({ error: 'Division not found' });
  }

  const assignments = await prisma.divisionAssignment.findMany({
    where: { divisionId },
    include: {
      registration: {
        include: {
          competitor: {
            select: { id: true, firstName: true, lastName: true, schoolDojang: true },
          },
        },
      },
    },
  });

  const competitorIds = assignments.map((a) => a.registration.competitorId);
  const eventType = division.eventType as 'patterns' | 'sparring';

  const ratings = await batchGetRatings(prisma, competitorIds, eventType);

  const result = assignments.map((a) => ({
    registrationId: a.registrationId,
    competitorId: a.registration.competitorId,
    name: `${a.registration.competitor.firstName} ${a.registration.competitor.lastName}`,
    school: a.registration.competitor.schoolDojang,
    skillRating: ratings.get(a.registration.competitorId) || 1000,
    seedPosition: a.seedPosition,
  }));

  // Sort by skill rating descending
  result.sort((a, b) => b.skillRating - a.skillRating);

  res.json({
    divisionId,
    divisionName: division.name,
    eventType,
    competitors: result,
  });
});

export default router;
