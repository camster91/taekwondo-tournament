import { Router } from 'express';
import type { Request, Response } from 'express-serve-static-core';
import { PrismaClient } from '@prisma/client';
import { generateBracket, type BracketStructure } from '../services/bracket-generator.js';
import { generateRoundRobin, generatePoolPlay } from '../services/bracket-formats.js';
import { advanceWinner, handleByeMatches, getBracketPlacements } from '../services/match-advancement.js';
import {
  generateBracketPDF,
  generateBatchBracketsPDF,
  generateResultsPDF,
  generateCertificatePDF,
  generateBatchCertificatesPDF,
  generateSchoolReportPDF,
  type BracketMatch,
  type DivisionInfo,
  type TournamentInfo,
} from '../services/pdf-export.js';
import { authenticate, requireRole, type AuthenticatedRequest } from '../middleware/auth.js';
import { z } from 'zod';
import { validateRequest } from '../middleware/validate.js';

const router = Router();

// Helper to safely get string param
const getParam = (param: string | string[] | undefined): string => {
  if (Array.isArray(param)) return param[0];
  return param || '';
};

// Validation schemas
const matchResultSchema = z.object({
  winnerId: z.string().optional(),
  score1: z.string().optional(),
  score2: z.string().optional(),
  status: z.enum(['pending', 'ready', 'in_progress', 'completed', 'bye']).optional(),
  notes: z.string().optional(),
});

// Generate bracket for division (requires authentication + admin/director role)
router.post('/division/:divisionId/generate', authenticate, requireRole('admin', 'director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  // format: 'double_elim' (default) | 'single_elim' | 'round_robin' | 'pool_play'
  const { seedingStrategy = 'school_spread', format = 'double_elim', poolCount, advancePerPool } = req.body;

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

  let bracketStructure: BracketStructure;
  if (format === 'round_robin') {
    bracketStructure = generateRoundRobin(competitors, { seedingStrategy: seedingStrategy as any });
  } else if (format === 'pool_play') {
    bracketStructure = generatePoolPlay(competitors, {
      seedingStrategy: seedingStrategy as any,
      poolCount,
      advancePerPool,
    });
  } else {
    // double_elim and single_elim both use the existing double-elim generator
    // (single_elim is a single-elim variant but we ship double-elim for the common case)
    bracketStructure = generateBracket(competitors, seedingStrategy);
  }

  // Save bracket
  const bracket = await prisma.bracket.create({
    data: {
      divisionId: division.id,
      structure: JSON.stringify(bracketStructure),
      format,
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

// Get bracket for division (requires authentication)
router.get('/division/:divisionId', authenticate, async (req: Request, res: Response) => {
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

// Update match result (requires authentication + admin/director/scorekeeper role)
router.put('/match/:matchId', authenticate, requireRole('admin', 'director', 'scorekeeper'), validateRequest(matchResultSchema), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { winnerId, score1, score2, status, notes} = req.body;
  const user = (req as any).user;

  // Get current match state for audit log
  const currentMatch = await prisma.match.findUnique({
    where: { id: getParam(req.params.matchId) },
  });

  if (!currentMatch) {
    return res.status(404).json({ error: 'Match not found' });
  }

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

  // Create audit log entry
  await prisma.matchAuditLog.create({
    data: {
      matchId: match.id,
      action: status === 'completed' ? 'complete' : 'update',
      previousState: JSON.stringify(currentMatch),
      newState: JSON.stringify({
        winnerId: match.winnerId,
        score1: match.score1,
        score2: match.score2,
        status: match.status,
        notes: match.notes,
      }),
      userId: user?.id,
      userEmail: user?.email,
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

// Get bracket placements (requires authentication)
router.get('/division/:divisionId/placements', authenticate, async (req: Request, res: Response) => {
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

// Swap competitors in a match (requires authentication)
router.post('/match/:matchId/swap', authenticate, async (req: Request, res: Response) => {
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

// Get match audit log
router.get('/match/:matchId/audit', authenticate, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  const logs = await prisma.matchAuditLog.findMany({
    where: { matchId: getParam(req.params.matchId) },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  res.json(logs);
});

// Undo last match change
router.post('/match/:matchId/undo', authenticate, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const user = (req as any).user;

  // Get the most recent audit log entry
  const lastLog = await prisma.matchAuditLog.findFirst({
    where: { matchId: getParam(req.params.matchId) },
    orderBy: { createdAt: 'desc' },
  });

  if (!lastLog) {
    return res.status(404).json({ error: 'No changes to undo' });
  }

  const previousState = JSON.parse(lastLog.previousState);

  // Restore previous state
  const match = await prisma.match.update({
    where: { id: getParam(req.params.matchId) },
    data: {
      winnerId: previousState.winnerId,
      score1: previousState.score1,
      score2: previousState.score2,
      status: previousState.status,
      notes: previousState.notes,
    },
    include: {
      competitor1: { include: { competitor: true } },
      competitor2: { include: { competitor: true } },
      winner: { include: { competitor: true } },
    },
  });

  // Log the undo action
  await prisma.matchAuditLog.create({
    data: {
      matchId: match.id,
      action: 'undo',
      previousState: lastLog.newState,
      newState: lastLog.previousState,
      userId: user?.id,
      userEmail: user?.email,
      reason: `Undo of ${lastLog.action} from ${lastLog.createdAt.toISOString()}`,
    },
  });

  res.json(match);
});

// Reset bracket (requires authentication)
router.post('/division/:divisionId/reset', authenticate, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  await prisma.bracket.deleteMany({
    where: { divisionId: getParam(req.params.divisionId) },
  });

  res.status(204).send();
});

// Generate brackets for all divisions in tournament (requires authentication + admin/director role)
router.post('/tournament/:tournamentId/generate-all', authenticate, requireRole('admin', 'director'), async (req: Request, res: Response) => {
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

// Generate certificate for a single placement
router.get('/division/:divisionId/certificate/:place', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const place = parseInt(getParam(req.params.place));

  if (isNaN(place) || place < 1 || place > 3) {
    return res.status(400).json({ error: 'Place must be 1, 2, or 3' });
  }

  const division = await prisma.division.findUnique({
    where: { id: getParam(req.params.divisionId) },
    include: {
      tournament: true,
      bracket: true,
    },
  });

  if (!division || !division.bracket) {
    return res.status(404).json({ error: 'Division or bracket not found' });
  }

  const placements = await getBracketPlacements(prisma, division.bracket.id);
  const placement = placements.find((p) => p.place === place);

  if (!placement) {
    return res.status(404).json({ error: `No ${place}${place === 1 ? 'st' : place === 2 ? 'nd' : 'rd'} place winner found` });
  }

  const registration = await prisma.registration.findUnique({
    where: { id: placement.competitorId },
    include: { competitor: true },
  });

  if (!registration) {
    return res.status(404).json({ error: 'Competitor not found' });
  }

  const tournamentInfo: TournamentInfo = {
    name: division.tournament.name,
    date: division.tournament.date.toLocaleDateString(),
    location: division.tournament.location,
  };

  const pdf = generateCertificatePDF({
    competitorName: `${registration.competitor.firstName} ${registration.competitor.lastName}`,
    place,
    divisionName: division.name,
    eventType: division.eventType,
    tournament: tournamentInfo,
  });

  const pdfBuffer = pdf.output('arraybuffer');

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="certificate_${registration.competitor.lastName}_${place}.pdf"`
  );
  res.send(Buffer.from(pdfBuffer));
});

// Generate all certificates for tournament
router.get('/tournament/:tournamentId/certificates', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const placeFilter = req.query.place ? parseInt(req.query.place as string) : null;

  const tournament = await prisma.tournament.findUnique({
    where: { id: getParam(req.params.tournamentId) },
    include: {
      divisions: {
        include: {
          bracket: true,
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

  const winners: Array<{
    competitorName: string;
    place: number;
    divisionName: string;
    eventType: string;
  }> = [];

  for (const division of tournament.divisions as any[]) {
    if (!division.bracket) continue;

    const placements = await getBracketPlacements(prisma, division.bracket.id);

    for (const placement of placements) {
      // Only include 1st, 2nd, 3rd place
      if (placement.place > 3) continue;
      // Apply place filter if specified
      if (placeFilter && placement.place !== placeFilter) continue;

      const registration = await prisma.registration.findUnique({
        where: { id: placement.competitorId },
        include: { competitor: true },
      });

      if (registration) {
        winners.push({
          competitorName: `${registration.competitor.firstName} ${registration.competitor.lastName}`,
          place: placement.place,
          divisionName: division.name,
          eventType: division.eventType,
        });
      }
    }
  }

  if (winners.length === 0) {
    return res.status(404).json({ error: 'No medal winners found for this tournament' });
  }

  // Sort by division name, then by place
  winners.sort((a, b) => {
    if (a.divisionName !== b.divisionName) {
      return a.divisionName.localeCompare(b.divisionName);
    }
    return a.place - b.place;
  });

  const pdf = generateBatchCertificatesPDF(tournamentInfo, winners);

  const pdfBuffer = pdf.output('arraybuffer');

  const placeSuffix = placeFilter ? `_${placeFilter}${placeFilter === 1 ? 'st' : placeFilter === 2 ? 'nd' : 'rd'}` : '';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${tournament.name.replace(/[^a-z0-9]/gi, '_')}_certificates${placeSuffix}.pdf"`
  );
  res.send(Buffer.from(pdfBuffer));
});

// Generate school-specific results report
router.get('/tournament/:tournamentId/school-report', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const schoolName = req.query.school as string;

  if (!schoolName) {
    return res.status(400).json({ error: 'School name is required' });
  }

  const tournament = await prisma.tournament.findUnique({
    where: { id: getParam(req.params.tournamentId) },
    include: {
      divisions: {
        include: {
          bracket: true,
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

  const placements: Array<{
    competitorName: string;
    divisionName: string;
    eventType: string;
    place: number;
  }> = [];

  let gold = 0;
  let silver = 0;
  let bronze = 0;

  for (const division of tournament.divisions as any[]) {
    if (!division.bracket) continue;

    const divPlacements = await getBracketPlacements(prisma, division.bracket.id);

    for (const placement of divPlacements) {
      // Only include 1st, 2nd, 3rd place
      if (placement.place > 3) continue;

      const registration = await prisma.registration.findUnique({
        where: { id: placement.competitorId },
        include: { competitor: true },
      });

      if (!registration) continue;

      // Check if this competitor belongs to the requested school
      const competitorSchool = registration.competitor.schoolDojang || 'Independent';
      if (competitorSchool !== schoolName) continue;

      placements.push({
        competitorName: `${registration.competitor.firstName} ${registration.competitor.lastName}`,
        divisionName: division.name,
        eventType: division.eventType,
        place: placement.place,
      });

      if (placement.place === 1) gold++;
      else if (placement.place === 2) silver++;
      else if (placement.place === 3) bronze++;
    }
  }

  if (placements.length === 0) {
    return res.status(404).json({ error: `No medal placements found for ${schoolName}` });
  }

  const pdf = generateSchoolReportPDF({
    schoolName,
    tournament: tournamentInfo,
    placements,
    summary: {
      gold,
      silver,
      bronze,
      total: gold + silver + bronze,
    },
  });

  const pdfBuffer = pdf.output('arraybuffer');

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${schoolName.replace(/[^a-z0-9]/gi, '_')}_results.pdf"`
  );
  res.send(Buffer.from(pdfBuffer));
});

export default router;
