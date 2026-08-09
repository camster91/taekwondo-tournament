import { Router } from 'express';
import type { Response } from 'express-serve-static-core';
import type { PrismaClient } from '@prisma/client';
import { authenticate, checkTournamentAccess, type AuthenticatedRequest } from '../middleware/auth.js';
import { approveRecommendation, rejectRecommendation } from '../services/recommendation-contract.js';
import { getRecommendationValidator } from '../services/recommendation-validators.js';
import { createDivisionRecommendation } from '../services/division-recommendations.js';

const router = Router();
const param = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value || '';

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
  const recommendations = await prisma.recommendation.findMany({ where: { tournamentId }, orderBy: { createdAt: 'desc' } });
  res.json(recommendations.map((item) => ({
    ...item,
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

export default router;
