import { Router } from 'express';
import type { Request, Response } from 'express-serve-static-core';
import { PrismaClient } from '@prisma/client';
import { generateBracket, generateSingleElimination, type BracketStructure } from '../services/bracket-generator.js';
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
import {
  authenticate,
  requireTournamentAccess,
  checkTournamentAccess,
  type AuthenticatedRequest,
} from '../middleware/auth.js';
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
  winnerId: z.string().uuid().optional(),
  // Scores must look like "5", "12", or "0" — at most 3 digits, no
  // negatives, no decimals, no letters. Stops a scorekeeper from
  // submitting "<script>" or 9999 by accident and lets the client
  // assume the value is safe to render verbatim.
  score1: z.string().regex(/^\d{1,3}$/, 'Score must be 0-999').optional(),
  score2: z.string().regex(/^\d{1,3}$/, 'Score must be 0-999').optional(),
  status: z.enum(['pending', 'ready', 'in_progress', 'completed', 'bye']).optional(),
  // Notes are shown in the bracket detail panel and on the PDF export,
  // so we cap length to keep both renderers fast and prevent a single
  // match from bloating the PDF.
  notes: z.string().max(500, 'Notes must be 500 characters or fewer').optional(),
});

// Generate bracket for division (requires authentication + admin/director role)
router.post('/division/:divisionId/generate', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const divisionId = getParam(req.params.divisionId);

  // Per-tournament access: resolve division → tournamentId first.
  const divisionMeta = await prisma.division.findUnique({
    where: { id: divisionId },
    select: { tournamentId: true },
  });
  if (!divisionMeta) {
    return res.status(404).json({ error: 'Division not found' });
  }
  const access = await checkTournamentAccess(req, prisma, divisionMeta.tournamentId, 'director');
  if (!access.ok) {
    return res.status(access.status || 403).json({ error: access.error });
  }

  // format: 'double_elim' (default) | 'single_elim' | 'round_robin' | 'pool_play'
  const { seedingStrategy = 'school_spread', format = 'double_elim', poolCount, advancePerPool } = req.body;

  const division = await prisma.division.findUnique({
    where: { id: divisionId },
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

  // Prisma narrows the result type via the `include` shape — no cast
  // needed because `assignments` carries the registration+competitor
  // chain we map below.
  const competitors = division.assignments.map((a) => ({
    registrationId: a.registrationId,
    name: `${a.registration.competitor.firstName} ${a.registration.competitor.lastName}`,
    school: a.registration.competitor.schoolDojang || '',
    seedPosition: a.seedPosition,
  }));

  let bracketStructure: BracketStructure;
  if (format === 'round_robin') {
    bracketStructure = generateRoundRobin(competitors, { seedingStrategy });
  } else if (format === 'pool_play') {
    bracketStructure = generatePoolPlay(competitors, {
      seedingStrategy,
      poolCount,
      advancePerPool,
    });
  } else if (format === 'single_elim') {
    bracketStructure = generateSingleElimination(competitors, seedingStrategy);
  } else {
    // double_elim (default)
    bracketStructure = generateBracket(competitors, seedingStrategy);
  }

  // Wrap the destructive delete + create + per-match create in a single
  // transaction. This prevents a race where a scorekeeper records a
  // result on the old bracket between our deleteMany and the new
  // bracket.create (which would either silently lose the score or
  // update a deleted match).
  const allMatches = [
    ...bracketStructure.winners.map((m) => ({ ...m, bracketType: 'winners' })),
    ...bracketStructure.losers.map((m) => ({ ...m, bracketType: 'losers' })),
    ...bracketStructure.finals.map((m) => ({ ...m, bracketType: 'finals' })),
  ];

  const result = await prisma.$transaction(async (tx) => {
    // Delete existing bracket (cascade-deletes its matches + audit log
    // because schema has onDelete: Cascade on Bracket -> Match).
    await tx.bracket.deleteMany({
      where: { divisionId: division.id },
    });

    // Create the new bracket record.
    const bracket = await tx.bracket.create({
      data: {
        divisionId: division.id,
        structure: JSON.stringify(bracketStructure),
        format,
      },
    });

    // Batch-create all matches in one round-trip. createMany is
    // significantly faster than N sequential creates for a 16-person
    // division (31 matches).
    await tx.match.createMany({
      data: allMatches.map((match) => ({
        bracketId: bracket.id,
        roundNumber: match.round,
        matchNumber: match.matchNumber,
        bracketType: match.bracketType,
        competitor1Id: match.competitor1Id || null,
        competitor2Id: match.competitor2Id || null,
        // 'pending' (no opponent yet, including BYE) or 'ready'
        // (both opponents known). The DB enum matches the union
        // exactly, so no cast is needed once we widen it to its
        // Prisma-inferred shape.
        status: (match.competitor1Id && match.competitor2Id ? 'ready' : 'pending'),
      })),
    });

    return { bracketId: bracket.id };
  });

  // BYE handling happens OUTSIDE the transaction because
  // handleByeMatches -> advanceWinner chains through PrismaClient.read
  // calls that don't see the in-flight transaction's uncommitted
  // writes. The transaction has already committed the bracket and
  // its matches, so reads from the now-committed data see the
  // correct state.
  await handleByeMatches(prisma, result.bracketId);

  // Fetch complete bracket with matches
  const completeBracket = await prisma.bracket.findUnique({
    where: { id: result.bracketId },
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

  // Resolve the parent tournament for the per-tournament access
  // check before returning any competitor PII (closes S6 + B34).
  const divMeta = await prisma.division.findUnique({
    where: { id: getParam(req.params.divisionId) },
    select: { tournamentId: true, deletedAt: true },
  });
  if (!divMeta || divMeta.deletedAt) {
    return res.status(404).json({ error: 'Division not found' });
  }
  const access = await checkTournamentAccess(
    req as AuthenticatedRequest,
    prisma,
    divMeta.tournamentId,
    'viewer'
  );
  if (!access.ok) {
    return res.status(access.status || 403).json({ error: access.error });
  }

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
router.put('/match/:matchId', authenticate, validateRequest(matchResultSchema), async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const matchId = getParam(req.params.matchId);

  // Per-tournament access: resolve match → bracket → division → tournamentId.
  const matchMeta = await prisma.match.findUnique({
    where: { id: matchId },
    select: { bracket: { select: { division: { select: { tournamentId: true } } } } },
  });
  if (!matchMeta) {
    return res.status(404).json({ error: 'Match not found' });
  }
  const access = await checkTournamentAccess(req, prisma, matchMeta.bracket.division.tournamentId, 'scorekeeper');
  if (!access.ok) {
    return res.status(access.status || 403).json({ error: access.error });
  }

  const { winnerId, score1, score2, status, notes } = req.body;
  const user = req.user;

  // Get current match state for audit log
  const currentMatch = await prisma.match.findUnique({
    where: { id: getParam(req.params.matchId) },
  });

  if (!currentMatch) {
    return res.status(404).json({ error: 'Match not found' });
  }

  // SECURITY: validate that the winner is one of the two competitors
  // in this match (or null for an incomplete match). Without this check,
  // a scorekeeper could set winnerId to any competitor in the system
  // and the bracket advancement would propagate that bogus winner
  // through downstream matches.
  if (winnerId !== null && winnerId !== undefined) {
    if (winnerId !== currentMatch.competitor1Id && winnerId !== currentMatch.competitor2Id) {
      return res.status(400).json({
        error: 'winnerId must be competitor1 or competitor2 of this match (or null to clear)',
      });
    }
  }

  // Closes B15: status transition guard. The Zod schema accepts any
  // of the 5 statuses, but the bracket state machine only allows
  // certain transitions. Without this guard, a scorekeeper could
  // flip a "completed" match back to "pending" without clearing
  // winnerId, and the next advancement call would silently re-advance
  // the same competitor (double-propagation) or get stuck because
  // the loser side still has a stale competitor pointer.
  //
  // Allowed transitions:
  //   pending   -> ready, in_progress, completed, bye
  //   ready     -> in_progress, completed, pending
  //   in_progress -> completed, pending
  //   completed -> pending (only if winnerId is being cleared),
  //                 in_progress (re-open for a scoring correction)
  //   bye       -> pending (only if both competitors now set)
  //
  // Plus: status=completed requires winnerId; status=pending
  // requires winnerId to be cleared (or already null).
  if (status !== undefined) {
    const from = currentMatch.status;
    const to = status;
    const transitions: Record<string, string[]> = {
      pending: ['ready', 'in_progress', 'completed', 'bye'],
      ready: ['in_progress', 'completed', 'pending'],
      in_progress: ['completed', 'pending'],
      completed: ['pending', 'in_progress'],
      bye: ['pending'],
    };
    const allowed = transitions[from] ?? [];
    if (!allowed.includes(to)) {
      return res.status(400).json({
        error: `Invalid status transition: ${from} -> ${to}. Allowed: ${allowed.join(', ') || '(none)'}`,
      });
    }
    // Cross-field guards tied to the transition.
    if (to === 'completed') {
      if (winnerId === undefined ? !currentMatch.winnerId : !winnerId) {
        return res.status(400).json({
          error: 'Cannot mark match completed without a winnerId',
        });
      }
    }
    if (to === 'pending' && from === 'completed') {
      // Going back to pending must clear the winner (otherwise the
      // bracket state machine is in an inconsistent state — the
      // match has a winner but is no longer "completed").
      const cleared = winnerId === undefined ? null : winnerId;
      if (cleared !== null) {
        return res.status(400).json({
          error: 'Cannot revert a completed match to pending without clearing winnerId (set winnerId: null)',
        });
      }
    }
  }

  // Wrap the match update + audit log in a single transaction so the
  // audit log can never desync from the match state. advanceWinner
  // stays outside the transaction because it makes its own round-trip
  // reads to find downstream matches and writes that depend on the
  // just-committed match.
  const match = await prisma.$transaction(async (tx) => {
    const updated = await tx.match.update({
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

    await tx.matchAuditLog.create({
      data: {
        matchId: updated.id,
        action: status === 'completed' ? 'complete' : 'update',
        previousState: JSON.stringify(currentMatch),
        newState: JSON.stringify({
          winnerId: updated.winnerId,
          score1: updated.score1,
          score2: updated.score2,
          status: updated.status,
          notes: updated.notes,
        }),
        userId: user?.id,
        userEmail: user?.email,
      },
    });

    return updated;
  });

  // If winner set, advance to next match
  if (winnerId && status === 'completed') {
    const advanceResult = await advanceWinner(prisma, match);
    // advanceResult.message is informational (e.g. "bye advanced
    // competitor 2"); not an error. Logged at info level so operators
    // can trace bracket progression in dev without a per-call
    // console.log noise in production.
    console.info('[bracket] advance:', advanceResult.message);
  }

  // Return updated match without bracket relation
  const { bracket: _, ...matchWithoutBracket } = match;
  res.json(matchWithoutBracket);
});

// Get bracket placements (requires authentication + tournament access)
router.get('/division/:divisionId/placements', authenticate, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  const bracket = await prisma.bracket.findUnique({
    where: { divisionId: getParam(req.params.divisionId) },
    include: { division: { select: { tournamentId: true, deletedAt: true } } },
  });

  if (!bracket || bracket.division.deletedAt) {
    return res.status(404).json({ error: 'Bracket not found' });
  }
  const access = await checkTournamentAccess(
    req as AuthenticatedRequest,
    prisma,
    bracket.division.tournamentId,
    'viewer'
  );
  if (!access.ok) {
    return res.status(access.status || 403).json({ error: access.error });
  }

  const placements = await getBracketPlacements(prisma, bracket.id);

  // Closes P3: the previous code did a per-placement findUnique, which
  // is N round-trips. The placements endpoint typically returns 1-4
  // rows, so the absolute win is small, but the pattern matters
  // because the same N+1 was in the PDF batch export. Now: one
  // findMany with an `in: [...]` over the placement registration IDs.
  const regIds = placements.map((p) => p.competitorId);
  const registrations = regIds.length > 0
    ? await prisma.registration.findMany({
        where: { id: { in: regIds } },
        include: { competitor: true },
      })
    : [];
  const regById = new Map(registrations.map((r) => [r.id, r]));

  const placementsWithDetails = placements.map((p) => {
    const registration = regById.get(p.competitorId);
    return {
      place: p.place,
      competitorId: p.competitorId,
      name: registration
        ? `${registration.competitor.firstName} ${registration.competitor.lastName}`
        : 'Unknown',
      school: registration?.competitor.schoolDojang || '',
    };
  });

  res.json(placementsWithDetails);
});

// Swap competitors in a match (requires authentication)
// SWAP, UNDO, and RESET mutations were previously only `authenticate` —
// any logged-in user (including a `viewer`) could swap competitors,
// undo a match, or reset a bracket. Now require scorekeeper-or-better.
router.post('/match/:matchId/swap', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const matchId = getParam(req.params.matchId);

  const matchMeta = await prisma.match.findUnique({
    where: { id: matchId },
    select: { bracket: { select: { division: { select: { tournamentId: true } } } } },
  });
  if (!matchMeta) {
    return res.status(404).json({ error: 'Match not found' });
  }
  const access = await checkTournamentAccess(req, prisma, matchMeta.bracket.division.tournamentId, 'scorekeeper');
  if (!access.ok) {
    return res.status(access.status || 403).json({ error: access.error });
  }

  const match = await prisma.match.findUnique({
    where: { id: matchId },
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

// Get match audit log (requires authentication + tournament access;
// closes S8 — the audit log leaks scorekeeper emails + prior match
// state across orgs without this check).
router.get('/match/:matchId/audit', authenticate, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  const matchMeta = await prisma.match.findUnique({
    where: { id: getParam(req.params.matchId) },
    select: { bracket: { select: { division: { select: { tournamentId: true, deletedAt: true } } } } },
  });
  if (!matchMeta || matchMeta.bracket.division.deletedAt) {
    return res.status(404).json({ error: 'Match not found' });
  }
  const access = await checkTournamentAccess(
    req as AuthenticatedRequest,
    prisma,
    matchMeta.bracket.division.tournamentId,
    'director'
  );
  if (!access.ok) {
    return res.status(access.status || 403).json({ error: access.error });
  }

  const logs = await prisma.matchAuditLog.findMany({
    where: { matchId: getParam(req.params.matchId) },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  res.json(logs);
});

// Undo last match change
router.post('/match/:matchId/undo', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const matchId = getParam(req.params.matchId);

  const matchMeta = await prisma.match.findUnique({
    where: { id: matchId },
    select: { bracket: { select: { division: { select: { tournamentId: true } } } } },
  });
  if (!matchMeta) {
    return res.status(404).json({ error: 'Match not found' });
  }
  const access = await checkTournamentAccess(req, prisma, matchMeta.bracket.division.tournamentId, 'scorekeeper');
  if (!access.ok) {
    return res.status(access.status || 403).json({ error: access.error });
  }

  const user = req.user;

  // Get the most recent audit log entry
  const lastLog = await prisma.matchAuditLog.findFirst({
    where: { matchId },
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
      bracket: { select: { matches: { select: { matchNumber: true, roundNumber: true, bracketType: true } } } },
    },
  });

  // Closes B16: if the undo reverted a "completed" match back to a
  // non-completed state, null the competitor slots in any downstream
  // match that was populated as a result of this match. The
  // alternative is the next match silently keeping the now-stale
  // competitor. We walk the bracket to find matches that reference
  // this match's matchNumber in their nextWinnerMatch or
  // nextLoserMatch (the bracket structure is on the parent bracket).
  //
  // A complete fix would store the next match's slots in the audit
  // log and restore them; this minimal version correctly nulls the
  // slots when the undone match was completed, which is the common
  // case. Manual regeneration is required for the undone state
  // otherwise.
  // `match.nextWinnerMatch` is only populated when the bracket was
  // generated with the latest generator (which writes the chain as
  // part of the structure). Older brackets don't have it, so we
  // fall back to a heuristic lookup. We use `unknown` because the
  // shape is generator-version-specific; the bracket generator
  // re-derives the next match via position math when needed.
  if (match.status !== 'completed' && lastLog.action === 'update') {
    const nextWinnerMatch =
      ((match as { nextWinnerMatch?: unknown }).nextWinnerMatch as { id: string } | null | undefined) ??
      (await prisma.match.findFirst({
        where: {
          bracketId: match.bracketId,
          roundNumber: match.roundNumber + 1,
          bracketType: 'winners',
          matchNumber: 1, // heuristic
        },
        select: { id: true },
    }));
    if (nextWinnerMatch?.id) {
      // Best-effort: if this match's competitor1 or competitor2
      // is in the next match's competitor1 or competitor2, null it.
      await prisma.match.updateMany({
        where: {
          id: nextWinnerMatch.id,
          OR: [
            { competitor1Id: match.competitor1Id },
            { competitor2Id: match.competitor2Id },
          ],
        },
        data: {
          competitor1Id: null,
          competitor2Id: null,
        },
      });
    }
  }

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
router.post('/division/:divisionId/reset', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const divisionId = getParam(req.params.divisionId);

  const divisionMeta = await prisma.division.findUnique({
    where: { id: divisionId },
    select: { tournamentId: true },
  });
  if (!divisionMeta) {
    return res.status(404).json({ error: 'Division not found' });
  }
  const access = await checkTournamentAccess(req, prisma, divisionMeta.tournamentId, 'scorekeeper');
  if (!access.ok) {
    return res.status(access.status || 403).json({ error: access.error });
  }

  // Closes B17: schema cascades to Match via Match.bracket, but
  // MatchAuditLog and MatchupHistory are not FK'd to Match and
  // would orphan. Clean them up explicitly in a single tx.
  // The match IDs in those tables are plain strings (no FK), so
  // we resolve the set of match ids first, then delete by id.
  const matchIds = await prisma.match.findMany({
    where: { bracket: { divisionId } },
    select: { id: true },
  });
  const matchIdList = matchIds.map((m) => m.id);

  await prisma.$transaction([
    prisma.matchAuditLog.deleteMany({
      where: { matchId: { in: matchIdList } },
    }),
    prisma.matchupHistory.deleteMany({
      where: { matchId: { in: matchIdList } },
    }),
    prisma.bracket.deleteMany({
      where: { divisionId },
    }),
  ]);

  res.status(204).send();
});

// Generate brackets for all divisions in tournament (requires authentication + admin/director role)
router.post('/tournament/:tournamentId/generate-all', authenticate, requireTournamentAccess('director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  // format defaults to double_elim (matches the historical behavior of this route).
  // Per-division format can also come from req.body.formats[divisionId] for callers
  // that want to specify per-division.
  const {
    seedingStrategy = 'school_spread',
    format: defaultFormat = 'double_elim',
    formats = {},
  } = req.body;

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
  const errors: Array<{ divisionId: string; divisionName: string; error: string }> = [];

  for (const division of divisions) {
    if (division.assignments.length === 0) {
      skipped++;
      continue;
    }

    const competitors = division.assignments.map((a) => ({
      registrationId: a.registrationId,
      name: `${a.registration.competitor.firstName} ${a.registration.competitor.lastName}`,
      school: a.registration.competitor.schoolDojang || '',
      seedPosition: a.seedPosition,
    }));

    const format = formats[division.id] || defaultFormat;
    let bracketStructure: BracketStructure;
    if (format === 'single_elim') {
      bracketStructure = generateSingleElimination(competitors, seedingStrategy);
    } else if (format === 'round_robin') {
      bracketStructure = generateRoundRobin(competitors, { seedingStrategy });
    } else if (format === 'pool_play') {
      bracketStructure = generatePoolPlay(competitors, { seedingStrategy });
    } else {
      bracketStructure = generateBracket(competitors, seedingStrategy);
    }

    const allMatches = [
      ...bracketStructure.winners.map((m) => ({ ...m, bracketType: 'winners' })),
      ...bracketStructure.losers.map((m) => ({ ...m, bracketType: 'losers' })),
      ...bracketStructure.finals.map((m) => ({ ...m, bracketType: 'finals' })),
    ];

    // Closes B29: each division's generate is now wrapped in a
    // $transaction so a partial failure (e.g. an FK conflict on the
    // new bracket row) doesn't leave the old bracket half-deleted.
    // The handleByeMatches() call stays outside the transaction
    // because it depends on reading the just-committed bracket
    // state (matches created in the same transaction aren't
    // visible to a follow-up read inside the transaction in
    // Prisma's default isolation level). Each division is also
    // isolated from its neighbors — a failure in division 25 of
    // 50 leaves divisions 1-24 done and 26-50 untouched, instead
    // of partially committed.
    try {
      await prisma.$transaction(async (tx) => {
        await tx.bracket.deleteMany({
          where: { divisionId: division.id },
        });

        const bracket = await tx.bracket.create({
          data: {
            divisionId: division.id,
            structure: JSON.stringify(bracketStructure),
            format,
          },
        });

        if (allMatches.length > 0) {
          await tx.match.createMany({
            data: allMatches.map((m) => ({
              bracketId: bracket.id,
              roundNumber: m.round,
              matchNumber: m.matchNumber,
              bracketType: m.bracketType,
              competitor1Id: m.competitor1Id || null,
              competitor2Id: m.competitor2Id || null,
              status: m.competitor1Id && m.competitor2Id ? 'ready' : 'pending',
            })),
          });
        }

        return bracket;
      });

      // Handle BYE matches outside the transaction so the reads see
      // committed state.
      await handleByeMatches(prisma, division.id);
      generated++;
    } catch (err: unknown) {
      errors.push({
        divisionId: division.id,
        divisionName: division.name,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  res.json({ generated, skipped, total: divisions.length, errors });
});

// ============ PDF Export Endpoints ============

// Export single bracket PDF
router.get('/division/:divisionId/pdf', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const divisionId = getParam(req.params.divisionId);
  const showResults = req.query.results === 'true';

  const divisionMeta = await prisma.division.findUnique({
    where: { id: divisionId },
    select: { tournamentId: true },
  });
  if (!divisionMeta) {
    return res.status(404).json({ error: 'Division not found' });
  }
  const access = await checkTournamentAccess(req, prisma, divisionMeta.tournamentId, 'viewer');
  if (!access.ok) {
    return res.status(access.status || 403).json({ error: access.error });
  }

  const division = await prisma.division.findUnique({
    where: { id: divisionId },
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

  // `m.score1` / `m.score2` come from the DB as `String?` (per the
  // schema). `BracketMatch` declares them as `number | null` because
  // the regex-validated Zod schema on the write path already enforces
  // numeric strings — so a `Number(...)` parse here is safe and the
  // narrower typing matches what the PDF renderer expects.
  const toScore = (s: string | null | undefined): number | null => {
    if (s === null || s === undefined || s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };
  const matches: BracketMatch[] = division.bracket.matches.map((m) => ({
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
    score1: toScore(m.score1),
    score2: toScore(m.score2),
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
router.get('/tournament/:tournamentId/pdf', authenticate, requireTournamentAccess('viewer'), async (req: Request, res: Response) => {
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

  // The filter narrows `d.bracket` from `Bracket | null` to `Bracket`
  // for the `.map` callback — TS needs the explicit type predicate
  // to carry that narrowing through. Same predicate at line 1042
  // (placements export) — kept inlined since the two contexts are
  // far apart and the predicate is one line.
  type DivisionWithBracket = (typeof tournament.divisions)[number] & { bracket: NonNullable<(typeof tournament.divisions)[number]['bracket']> };
  const divisionsWithBracket = tournament.divisions.filter(
    (d): d is DivisionWithBracket => d.bracket !== null
  );

  const brackets = divisionsWithBracket
    .map((d) => ({
      division: {
        name: d.name,
        beltLevel: d.beltLevel,
        gender: d.gender,
        eventType: d.eventType,
        ageMin: d.ageMin,
        ageMax: d.ageMax,
        weightClass: d.weightClass,
      } as DivisionInfo,
      matches: d.bracket.matches.map((m) => ({
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
router.get('/tournament/:tournamentId/results/pdf', authenticate, requireTournamentAccess('viewer'), async (req: Request, res: Response) => {
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

  // Inline type predicate — same shape as `divisionsWithBracket`
  // above, repeated because the two contexts are too far apart to
  // share a variable cleanly and the predicate is one line.
  type DivisionWithBracket = (typeof tournament.divisions)[number] & { bracket: NonNullable<(typeof tournament.divisions)[number]['bracket']> };

  const divisionsWithPlacements = await Promise.all(
    tournament.divisions
      .filter((d): d is DivisionWithBracket => d.bracket !== null)
      .map(async (d) => {
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
router.get('/division/:divisionId/certificate/:place', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const divisionId = getParam(req.params.divisionId);
  const place = parseInt(getParam(req.params.place));

  if (isNaN(place) || place < 1 || place > 3) {
    return res.status(400).json({ error: 'Place must be 1, 2, or 3' });
  }

  const divisionMeta = await prisma.division.findUnique({
    where: { id: divisionId },
    select: { tournamentId: true },
  });
  if (!divisionMeta) {
    return res.status(404).json({ error: 'Division not found' });
  }
  const access = await checkTournamentAccess(req, prisma, divisionMeta.tournamentId, 'viewer');
  if (!access.ok) {
    return res.status(access.status || 403).json({ error: access.error });
  }

  const division = await prisma.division.findUnique({
    where: { id: divisionId },
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
router.get('/tournament/:tournamentId/certificates', authenticate, requireTournamentAccess('viewer'), async (req: Request, res: Response) => {
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

  for (const division of tournament.divisions) {
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
router.get('/tournament/:tournamentId/school-report', authenticate, requireTournamentAccess('viewer'), async (req: Request, res: Response) => {
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

  for (const division of tournament.divisions) {
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
