import { Router } from 'express';
import type { Response } from 'express-serve-static-core';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { authenticate, checkTournamentAccess, type AuthenticatedRequest } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validate.js';
import { approveRecommendation, rejectRecommendation } from '../services/recommendation-contract.js';
import { getRecommendationValidator } from '../services/recommendation-validators.js';
import {
  applyDivisionRecommendation,
  createDivisionRecommendation,
  DIVISION_RECOMMENDATION_TYPE,
} from '../services/division-recommendations.js';
import {
  applyScheduleOptimizationRecommendation,
  createScheduleOptimizationRecommendation,
  SCHEDULE_OPTIMIZATION_TYPE,
  saveScheduleDivisionLock,
  getScheduleOperationalConditions,
  saveScheduleOperationalConditions,
  undoScheduleOptimizationRecommendation,
} from '../services/schedule-optimization-recommendations.js';

const router = Router();
const param = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value || '';
export const scheduleConditionsSchema = z.object({
  restWindowMinutes: z.number().int().min(0).max(240),
  ringDelays: z.array(z.object({
    ring: z.number().int().min(1).max(100),
    delayMinutes: z.number().int().min(0).max(240),
  }).strict()).max(100),
  incidentBlocks: z.array(z.object({
    incidentId: z.string().uuid(), ring: z.number().int().min(1).max(100),
  })).max(100),
});
const scheduleLockSchema = z.object({ locked: z.boolean() }).strict();

async function authorize(req: AuthenticatedRequest, res: Response, prisma: PrismaClient, tournamentId: string) {
  const access = await checkTournamentAccess(req, prisma, tournamentId, 'director');
  if (!access.ok) {
    res.status(access.status || 403).json({ error: access.error || 'Forbidden' });
    return false;
  }
  return true;
}

async function findScoped(prisma: PrismaClient, tournamentId: string, recommendationId: string) {
  return prisma.recommendation.findFirst({ where: { id: recommendationId, tournamentId }, select: { id: true, recommendationType: true } });
}

router.get('/tournament/:tournamentId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const tournamentId = param(req.params.tournamentId);
  if (!await authorize(req, res, prisma, tournamentId)) return;
  const recommendations = await prisma.recommendation.findMany({
    where: { tournamentId },
    orderBy: { createdAt: 'desc' },
    include: { operationAudit: { select: { id: true, undoneAt: true, afterState: true } } },
  });
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { settings: true } });
  res.json(recommendations.map((item) => ({
    ...item,
    operationAudit: item.operationAudit ? {
      id: item.operationAudit.id,
      undoneAt: item.operationAudit.undoneAt,
      canUndo: !item.operationAudit.undoneAt && (() => {
        try { return JSON.parse(item.operationAudit!.afterState) === tournament?.settings; } catch { return false; }
      })(),
    } : null,
    inputSnapshot: JSON.parse(item.inputSnapshot), constraintsConsidered: JSON.parse(item.constraintsConsidered),
    warnings: JSON.parse(item.warnings), proposedDiff: JSON.parse(item.proposedDiff),
    validationResult: JSON.parse(item.validationResult), appliedResult: item.appliedResult ? JSON.parse(item.appliedResult) : null,
  })));
});

router.post('/tournament/:tournamentId/divisions/propose', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const tournamentId = param(req.params.tournamentId);
  if (!await authorize(req, res, prisma, tournamentId)) return;
  try {
    res.status(201).json(await createDivisionRecommendation(prisma, tournamentId, req.user!.id));
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : 'Division recommendation could not be created' });
  }
});

router.put('/tournament/:tournamentId/schedule/conditions', authenticate, validateRequest(scheduleConditionsSchema), async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const tournamentId = param(req.params.tournamentId);
  if (!await authorize(req, res, prisma, tournamentId)) return;
  try {
    await saveScheduleOperationalConditions(prisma, tournamentId, req.body);
    res.json({ ok: true });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : 'Schedule live conditions could not be saved' });
  }
});

router.get('/tournament/:tournamentId/schedule/conditions', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const tournamentId = param(req.params.tournamentId);
  if (!await authorize(req, res, prisma, tournamentId)) return;
  try {
    res.json(await getScheduleOperationalConditions(prisma, tournamentId));
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : 'Schedule live conditions could not be loaded' });
  }
});

router.put('/tournament/:tournamentId/schedule/divisions/:divisionId/lock', authenticate, validateRequest(scheduleLockSchema), async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const tournamentId = param(req.params.tournamentId);
  if (!await authorize(req, res, prisma, tournamentId)) return;
  try {
    res.json(await saveScheduleDivisionLock(prisma, tournamentId, param(req.params.divisionId), req.body.locked));
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : 'Schedule lock could not be saved' });
  }
});

router.post('/tournament/:tournamentId/schedule/propose', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const tournamentId = param(req.params.tournamentId);
  if (!await authorize(req, res, prisma, tournamentId)) return;
  try {
    // All authoritative schedule inputs are reloaded server-side. Request body
    // arrays are deliberately ignored.
    res.status(201).json(await createScheduleOptimizationRecommendation(prisma, tournamentId, req.user!.id));
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : 'Schedule recommendation could not be created' });
  }
});

router.post('/tournament/:tournamentId/:recommendationId/approve', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const tournamentId = param(req.params.tournamentId);
  const recommendationId = param(req.params.recommendationId);
  if (!await authorize(req, res, prisma, tournamentId)) return;
  const recommendation = await findScoped(prisma, tournamentId, recommendationId);
  if (!recommendation) return res.status(404).json({ error: 'Recommendation not found' });
  const validator = getRecommendationValidator(recommendation.recommendationType);
  if (!validator) return res.status(409).json({ error: 'No deterministic validator is registered for this recommendation type' });
  try {
    res.json(await approveRecommendation(prisma, recommendationId, req.user!.id, validator));
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : 'Recommendation cannot be approved' });
  }
});

router.post('/tournament/:tournamentId/:recommendationId/reject', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const tournamentId = param(req.params.tournamentId);
  const recommendationId = param(req.params.recommendationId);
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!await authorize(req, res, prisma, tournamentId)) return;
  if (!await findScoped(prisma, tournamentId, recommendationId)) return res.status(404).json({ error: 'Recommendation not found' });
  if (!reason || reason.length > 500) return res.status(400).json({ error: 'A rejection reason of 1 to 500 characters is required' });
  try {
    res.json(await rejectRecommendation(prisma, recommendationId, req.user!.id, reason));
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : 'Recommendation cannot be rejected' });
  }
});

router.post('/tournament/:tournamentId/:recommendationId/apply', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const tournamentId = param(req.params.tournamentId);
  const recommendationId = param(req.params.recommendationId);
  if (!await authorize(req, res, prisma, tournamentId)) return;
  const recommendation = await findScoped(prisma, tournamentId, recommendationId);
  if (!recommendation) return res.status(404).json({ error: 'Recommendation not found' });
  try {
    if (recommendation.recommendationType === DIVISION_RECOMMENDATION_TYPE) {
      return res.json(await applyDivisionRecommendation(prisma, recommendationId, req.user!.id));
    }
    if (recommendation.recommendationType === SCHEDULE_OPTIMIZATION_TYPE) {
      return res.json(await applyScheduleOptimizationRecommendation(prisma, recommendationId, req.user!.id));
    }
    return res.status(409).json({ error: 'Recommendation type has no supported application workflow' });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : 'Recommendation could not be applied' });
  }
});

router.post('/tournament/:tournamentId/:recommendationId/undo', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const tournamentId = param(req.params.tournamentId);
  const recommendationId = param(req.params.recommendationId);
  if (!await authorize(req, res, prisma, tournamentId)) return;
  const recommendation = await findScoped(prisma, tournamentId, recommendationId);
  if (!recommendation) return res.status(404).json({ error: 'Recommendation not found' });
  if (recommendation.recommendationType !== SCHEDULE_OPTIMIZATION_TYPE) {
    return res.status(409).json({ error: 'Recommendation does not support schedule undo' });
  }
  try {
    await undoScheduleOptimizationRecommendation(prisma, tournamentId, recommendationId, req.user!.id);
    res.json({ ok: true });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : 'Schedule optimization cannot be undone' });
  }
});

export default router;
