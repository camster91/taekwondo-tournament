import { Router } from 'express';
import type { Request, Response } from 'express-serve-static-core';
import { PrismaClient } from '@prisma/client';
import { generateBracket, type BracketStructure } from '../services/bracket-generator.js';

const router = Router();

// Helper to safely get string param
const getParam = (param: string | string[] | undefined): string => {
  if (Array.isArray(param)) return param[0];
  return param || '';
};

// Generate bracket for division
router.post('/division/:divisionId/generate', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { seedingStrategy = 'school_spread' } = req.body;

  const division = await prisma.division.findUnique({
    where: { id: getParam(req.params.divisionId) },
    include: {
      assignments: {
        include: {
          registration: {
            include: { competitor: true },
          },
        },
        orderBy: { seedPosition: 'asc' },
      },
    },
  });

  if (!division) {
    return res.status(404).json({ error: 'Division not found' });
  }

  // Delete existing bracket if any
  await prisma.bracket.deleteMany({
    where: { divisionId: division.id },
  });

  const competitors = (division as any).assignments.map((a: any) => ({
    registrationId: a.registrationId,
    name: `${a.registration.competitor.firstName} ${a.registration.competitor.lastName}`,
    school: a.registration.competitor.schoolDojang || '',
    seedPosition: a.seedPosition,
  }));

  const bracketStructure = generateBracket(competitors, seedingStrategy);

  // Save bracket
  const bracket = await prisma.bracket.create({
    data: {
      divisionId: division.id,
      structure: JSON.stringify(bracketStructure),
    },
  });

  // Create matches
  const allMatches = [
    ...bracketStructure.winners.map((m) => ({ ...m, bracketType: 'winners' })),
    ...bracketStructure.losers.map((m) => ({ ...m, bracketType: 'losers' })),
    ...bracketStructure.finals.map((m) => ({ ...m, bracketType: 'finals' })),
  ];

  for (const match of allMatches) {
    await prisma.match.create({
      data: {
        bracketId: bracket.id,
        roundNumber: match.round,
        matchNumber: match.matchNumber,
        bracketType: match.bracketType,
        competitor1Id: match.competitor1Id || null,
        competitor2Id: match.competitor2Id || null,
        status: match.competitor1Id && match.competitor2Id ? 'ready' : 'pending',
      },
    });
  }

  // Fetch complete bracket with matches
  const completeBracket = await prisma.bracket.findUnique({
    where: { id: bracket.id },
    include: {
      matches: {
        include: {
          competitor1: { include: { competitor: true } },
          competitor2: { include: { competitor: true } },
          winner: { include: { competitor: true } },
        },
        orderBy: [{ bracketType: 'asc' }, { roundNumber: 'asc' }, { matchNumber: 'asc' }],
      },
    },
  });

  res.json(completeBracket);
});

// Get bracket for division
router.get('/division/:divisionId', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  const bracket = await prisma.bracket.findUnique({
    where: { divisionId: getParam(req.params.divisionId) },
    include: {
      matches: {
        include: {
          competitor1: { include: { competitor: true } },
          competitor2: { include: { competitor: true } },
          winner: { include: { competitor: true } },
        },
        orderBy: [{ bracketType: 'asc' }, { roundNumber: 'asc' }, { matchNumber: 'asc' }],
      },
    },
  });

  if (!bracket) {
    return res.status(404).json({ error: 'Bracket not found' });
  }

  res.json(bracket);
});

// Update match result
router.put('/match/:matchId', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { winnerId, score1, score2, status, notes } = req.body;

  const match = await prisma.match.update({
    where: { id: getParam(req.params.matchId) },
    data: {
      winnerId,
      score1,
      score2,
      status,
      notes,
    },
    include: {
      competitor1: { include: { competitor: true } },
      competitor2: { include: { competitor: true } },
      winner: { include: { competitor: true } },
    },
  });

  // If winner set, update next match
  if (winnerId && status === 'completed') {
    await advanceWinner(prisma, match);
  }

  res.json(match);
});

// Swap competitors in a match
router.post('/match/:matchId/swap', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  const match = await prisma.match.findUnique({
    where: { id: getParam(req.params.matchId) },
  });

  if (!match) {
    return res.status(404).json({ error: 'Match not found' });
  }

  const updated = await prisma.match.update({
    where: { id: getParam(req.params.matchId) },
    data: {
      competitor1Id: match.competitor2Id,
      competitor2Id: match.competitor1Id,
    },
    include: {
      competitor1: { include: { competitor: true } },
      competitor2: { include: { competitor: true } },
    },
  });

  res.json(updated);
});

// Reset bracket
router.post('/division/:divisionId/reset', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  await prisma.bracket.deleteMany({
    where: { divisionId: getParam(req.params.divisionId) },
  });

  res.status(204).send();
});

// Generate brackets for all divisions in tournament
router.post('/tournament/:tournamentId/generate-all', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { seedingStrategy = 'school_spread' } = req.body;

  const divisions = await prisma.division.findMany({
    where: { tournamentId: getParam(req.params.tournamentId) },
    include: {
      assignments: {
        include: {
          registration: {
            include: { competitor: true },
          },
        },
      },
    },
  });

  let generated = 0;
  let skipped = 0;

  for (const division of divisions as any[]) {
    if (division.assignments.length === 0) {
      skipped++;
      continue;
    }

    // Delete existing bracket
    await prisma.bracket.deleteMany({
      where: { divisionId: division.id },
    });

    const competitors = division.assignments.map((a: any) => ({
      registrationId: a.registrationId,
      name: `${a.registration.competitor.firstName} ${a.registration.competitor.lastName}`,
      school: a.registration.competitor.schoolDojang || '',
      seedPosition: a.seedPosition,
    }));

    const bracketStructure = generateBracket(competitors, seedingStrategy);

    const bracket = await prisma.bracket.create({
      data: {
        divisionId: division.id,
        structure: JSON.stringify(bracketStructure),
      },
    });

    const allMatches = [
      ...bracketStructure.winners.map((m) => ({ ...m, bracketType: 'winners' })),
      ...bracketStructure.losers.map((m) => ({ ...m, bracketType: 'losers' })),
      ...bracketStructure.finals.map((m) => ({ ...m, bracketType: 'finals' })),
    ];

    for (const match of allMatches) {
      await prisma.match.create({
        data: {
          bracketId: bracket.id,
          roundNumber: match.round,
          matchNumber: match.matchNumber,
          bracketType: match.bracketType,
          competitor1Id: match.competitor1Id || null,
          competitor2Id: match.competitor2Id || null,
          status: match.competitor1Id && match.competitor2Id ? 'ready' : 'pending',
        },
      });
    }

    generated++;
  }

  res.json({ generated, skipped, total: divisions.length });
});

// Helper function to advance winner to next match
async function advanceWinner(prisma: PrismaClient, match: any) {
  // This is a simplified version - full implementation would need bracket structure
  // to determine which match the winner goes to next
  const bracket = await prisma.bracket.findUnique({
    where: { id: match.bracketId },
  });

  if (!bracket) return;

  const structure: BracketStructure = JSON.parse(bracket.structure);

  // Find the next match based on bracket type and round
  // This would need to be implemented based on the bracket structure
  // For now, we just mark the match as complete
}

export default router;
