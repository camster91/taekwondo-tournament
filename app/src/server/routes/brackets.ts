import { Router } from 'express';
import type { Request, Response } from 'express-serve-static-core';
import { PrismaClient } from '@prisma/client';
import { generateBracket, type BracketStructure } from '../services/bracket-generator.js';
import { advanceWinner, handleByeMatches, getBracketPlacements } from '../services/match-advancement.js';
import {
  generateBracketPDF,
  generateBatchBracketsPDF,
  generateResultsPDF,
  type BracketMatch,
  type DivisionInfo,
  type TournamentInfo,
} from '../services/pdf-export.js';

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

  // Handle BYE matches automatically
  await handleByeMatches(prisma, bracket.id);

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
      bracket: true,
    },
  });

  // If winner set, advance to next match
  if (winnerId && status === 'completed') {
    const advanceResult = await advanceWinner(prisma, match);
    console.log('Match advancement:', advanceResult.message);
  }

  // Return updated match without bracket relation
  const { bracket: _, ...matchWithoutBracket } = match;
  res.json(matchWithoutBracket);
});

// Get bracket placements
router.get('/division/:divisionId/placements', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  const bracket = await prisma.bracket.findUnique({
    where: { divisionId: getParam(req.params.divisionId) },
  });

  if (!bracket) {
    return res.status(404).json({ error: 'Bracket not found' });
  }

  const placements = await getBracketPlacements(prisma, bracket.id);

  // Get competitor details
  const placementsWithDetails = await Promise.all(
    placements.map(async (p) => {
      const registration = await prisma.registration.findUnique({
        where: { id: p.competitorId },
        include: { competitor: true },
      });
      return {
        place: p.place,
        competitorId: p.competitorId,
        name: registration
          ? `${registration.competitor.firstName} ${registration.competitor.lastName}`
          : 'Unknown',
        school: registration?.competitor.schoolDojang || '',
      };
    })
  );

  res.json(placementsWithDetails);
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

    // Handle BYE matches
    await handleByeMatches(prisma, bracket.id);

    generated++;
  }

  res.json({ generated, skipped, total: divisions.length });
});

// ============ PDF Export Endpoints ============

// Export single bracket PDF
router.get('/division/:divisionId/pdf', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const showResults = req.query.results === 'true';

  const division = await prisma.division.findUnique({
    where: { id: getParam(req.params.divisionId) },
    include: {
      tournament: true,
      bracket: {
        include: {
          matches: {
            include: {
              competitor1: { include: { competitor: true } },
              competitor2: { include: { competitor: true } },
              winner: { include: { competitor: true } },
            },
          },
        },
      },
    },
  });

  if (!division || !division.bracket) {
    return res.status(404).json({ error: 'Bracket not found' });
  }

  const tournamentInfo: TournamentInfo = {
    name: division.tournament.name,
    date: division.tournament.date.toLocaleDateString(),
    location: division.tournament.location,
  };

  const divisionInfo: DivisionInfo = {
    name: division.name,
    beltLevel: division.beltLevel,
    gender: division.gender,
    eventType: division.eventType,
    ageMin: division.ageMin,
    ageMax: division.ageMax,
    weightClass: division.weightClass,
  };

  const matches: BracketMatch[] = division.bracket.matches.map((m: any) => ({
    matchNumber: m.matchNumber,
    round: m.roundNumber,
    bracketType: m.bracketType as 'winners' | 'losers' | 'finals',
    competitor1: m.competitor1
      ? {
          id: m.competitor1.id,
          name: `${m.competitor1.competitor.firstName} ${m.competitor1.competitor.lastName}`,
          school: m.competitor1.competitor.schoolDojang || '',
        }
      : null,
    competitor2: m.competitor2
      ? {
          id: m.competitor2.id,
          name: `${m.competitor2.competitor.firstName} ${m.competitor2.competitor.lastName}`,
          school: m.competitor2.competitor.schoolDojang || '',
        }
      : null,
    winner: m.winner
      ? {
          id: m.winner.id,
          name: `${m.winner.competitor.firstName} ${m.winner.competitor.lastName}`,
          school: m.winner.competitor.schoolDojang || '',
        }
      : null,
    score1: m.score1,
    score2: m.score2,
    status: m.status,
  }));

  const pdf = generateBracketPDF({
    tournament: tournamentInfo,
    division: divisionInfo,
    matches,
    showResults,
  });

  const pdfBuffer = pdf.output('arraybuffer');

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${division.name.replace(/[^a-z0-9]/gi, '_')}_bracket.pdf"`
  );
  res.send(Buffer.from(pdfBuffer));
});

// Export all brackets for tournament
router.get('/tournament/:tournamentId/pdf', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const showResults = req.query.results === 'true';

  const tournament = await prisma.tournament.findUnique({
    where: { id: getParam(req.params.tournamentId) },
    include: {
      divisions: {
        include: {
          bracket: {
            include: {
              matches: {
                include: {
                  competitor1: { include: { competitor: true } },
                  competitor2: { include: { competitor: true } },
                  winner: { include: { competitor: true } },
                },
              },
            },
          },
        },
        orderBy: [{ eventType: 'asc' }, { beltLevel: 'asc' }, { gender: 'asc' }, { displayOrder: 'asc' }],
      },
    },
  });

  if (!tournament) {
    return res.status(404).json({ error: 'Tournament not found' });
  }

  const tournamentInfo: TournamentInfo = {
    name: tournament.name,
    date: tournament.date.toLocaleDateString(),
    location: tournament.location,
  };

  const brackets = tournament.divisions
    .filter((d: any) => d.bracket)
    .map((d: any) => ({
      division: {
        name: d.name,
        beltLevel: d.beltLevel,
        gender: d.gender,
        eventType: d.eventType,
        ageMin: d.ageMin,
        ageMax: d.ageMax,
        weightClass: d.weightClass,
      } as DivisionInfo,
      matches: d.bracket.matches.map((m: any) => ({
        matchNumber: m.matchNumber,
        round: m.roundNumber,
        bracketType: m.bracketType as 'winners' | 'losers' | 'finals',
        competitor1: m.competitor1
          ? {
              id: m.competitor1.id,
              name: `${m.competitor1.competitor.firstName} ${m.competitor1.competitor.lastName}`,
              school: m.competitor1.competitor.schoolDojang || '',
            }
          : null,
        competitor2: m.competitor2
          ? {
              id: m.competitor2.id,
              name: `${m.competitor2.competitor.firstName} ${m.competitor2.competitor.lastName}`,
              school: m.competitor2.competitor.schoolDojang || '',
            }
          : null,
        winner: m.winner
          ? {
              id: m.winner.id,
              name: `${m.winner.competitor.firstName} ${m.winner.competitor.lastName}`,
              school: m.winner.competitor.schoolDojang || '',
            }
          : null,
        score1: m.score1,
        score2: m.score2,
        status: m.status,
      })) as BracketMatch[],
    }));

  if (brackets.length === 0) {
    return res.status(404).json({ error: 'No brackets found for tournament' });
  }

  const pdf = generateBatchBracketsPDF(tournamentInfo, brackets, showResults);

  const pdfBuffer = pdf.output('arraybuffer');

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${tournament.name.replace(/[^a-z0-9]/gi, '_')}_all_brackets.pdf"`
  );
  res.send(Buffer.from(pdfBuffer));
});

// Export tournament results PDF
router.get('/tournament/:tournamentId/results/pdf', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  const tournament = await prisma.tournament.findUnique({
    where: { id: getParam(req.params.tournamentId) },
    include: {
      divisions: {
        include: {
          bracket: {
            include: {
              matches: true,
            },
          },
        },
        orderBy: [{ eventType: 'asc' }, { beltLevel: 'asc' }, { gender: 'asc' }, { displayOrder: 'asc' }],
      },
    },
  });

  if (!tournament) {
    return res.status(404).json({ error: 'Tournament not found' });
  }

  const tournamentInfo: TournamentInfo = {
    name: tournament.name,
    date: tournament.date.toLocaleDateString(),
    location: tournament.location,
  };

  const divisionsWithPlacements = await Promise.all(
    tournament.divisions
      .filter((d: any) => d.bracket)
      .map(async (d: any) => {
        const placements = await getBracketPlacements(prisma, d.bracket.id);

        const placementsWithDetails = await Promise.all(
          placements.map(async (p) => {
            const registration = await prisma.registration.findUnique({
              where: { id: p.competitorId },
              include: { competitor: true },
            });
            return {
              place: p.place,
              name: registration
                ? `${registration.competitor.firstName} ${registration.competitor.lastName}`
                : 'Unknown',
              school: registration?.competitor.schoolDojang || '',
            };
          })
        );

        return {
          division: {
            name: d.name,
            beltLevel: d.beltLevel,
            gender: d.gender,
            eventType: d.eventType,
            ageMin: d.ageMin,
            ageMax: d.ageMax,
            weightClass: d.weightClass,
          } as DivisionInfo,
          placements: placementsWithDetails,
        };
      })
  );

  const pdf = generateResultsPDF(tournamentInfo, divisionsWithPlacements);

  const pdfBuffer = pdf.output('arraybuffer');

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${tournament.name.replace(/[^a-z0-9]/gi, '_')}_results.pdf"`
  );
  res.send(Buffer.from(pdfBuffer));
});

export default router;
