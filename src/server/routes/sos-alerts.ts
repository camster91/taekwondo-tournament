import { Router } from 'express';
import type { Request, Response } from 'express-serve-static-core';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { validateRequest } from '../middleware/validate.js';
import {
  authenticate,
  checkTournamentAccess,
  type AuthenticatedRequest,
} from '../middleware/auth.js';

const router = Router();

// Helper to safely get string param
const getParam = (param: string | string[] | undefined): string => {
  if (Array.isArray(param)) return param[0];
  return param || '';
};

// P2-10: SOS Alert validation schemas
const createSOSAlertSchema = z.object({
  severity: z.enum(['info', 'warning', 'critical']).default('warning'),
  category: z.enum(['ring', 'division', 'equipment', 'medical', 'other']),
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  ringNumber: z.number().int().min(1).max(20).optional(),
  divisionId: z.string().uuid().optional(),
});

const updateSOSAlertSchema = z.object({
  resolved: z.boolean(),
});

// P2-10: List SOS alerts for a tournament
// Returns both unresolved and recently resolved (last 2 hours) for context
router.get('/tournament/:tournamentId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const tournamentId = getParam(req.params.tournamentId);

  // Check tournament access (viewer can see alerts)
  const access = await checkTournamentAccess(req, prisma, tournamentId, 'viewer');
  if (!access.ok) {
    return res.status(access.status || 403).json({ error: access.error || 'Forbidden' });
  }

  try {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    
    const alerts = await prisma.sOSAlert.findMany({
      where: {
        tournamentId,
        OR: [
          { resolved: false },
          { 
            resolved: true,
            resolvedAt: { gte: twoHoursAgo }
          }
        ]
      },
      orderBy: [
        { resolved: 'asc' },
        { severity: 'desc' },
        { createdAt: 'desc' }
      ],
    });

    res.json({ alerts });
  } catch (error) {
    console.error('[sos-alerts] list failed:', error);
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

// P2-10: Create SOS alert (requires director+ access)
router.post('/tournament/:tournamentId', authenticate, validateRequest(createSOSAlertSchema), async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const tournamentId = getParam(req.params.tournamentId);
  const user = req.user;

  // Require director+ access to raise alerts
  const access = await checkTournamentAccess(req, prisma, tournamentId, 'director');
  if (!access.ok) {
    return res.status(access.status || 403).json({ error: access.error || 'Forbidden' });
  }

  const { severity, category, title, description, ringNumber, divisionId } = req.body as z.infer<typeof createSOSAlertSchema>;

  try {
    const alert = await prisma.sOSAlert.create({
      data: {
        tournamentId,
        severity,
        category,
        title,
        description,
        ringNumber,
        divisionId,
        raisedBy: user?.id,
        raisedByName: user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : null,
      },
    });

    res.json({ alert });
  } catch (error) {
    console.error('[sos-alerts] create failed:', error);
    res.status(500).json({ error: 'Failed to create alert' });
  }
});

// P2-10: Update SOS alert (resolve/unresolve) (requires director+ access)
router.patch('/:alertId', authenticate, validateRequest(updateSOSAlertSchema), async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const alertId = getParam(req.params.alertId);
  const { resolved } = req.body as z.infer<typeof updateSOSAlertSchema>;

  // Find alert to get tournament ID
  const alert = await prisma.sOSAlert.findUnique({
    where: { id: alertId },
    select: { tournamentId: true },
  });

  if (!alert) {
    return res.status(404).json({ error: 'Alert not found' });
  }

  // Require director+ access
  const access = await checkTournamentAccess(req, prisma, alert.tournamentId, 'director');
  if (!access.ok) {
    return res.status(access.status || 403).json({ error: access.error || 'Forbidden' });
  }

  try {
    const updated = await prisma.sOSAlert.update({
      where: { id: alertId },
      data: {
        resolved,
        resolvedAt: resolved ? new Date() : null,
      },
    });

    res.json({ alert: updated });
  } catch (error) {
    console.error('[sos-alerts] update failed:', error);
    res.status(500).json({ error: 'Failed to update alert' });
  }
});

// P2-10: Delete SOS alert (requires director+ access)
router.delete('/:alertId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const alertId = getParam(req.params.alertId);

  // Find alert to get tournament ID
  const alert = await prisma.sOSAlert.findUnique({
    where: { id: alertId },
    select: { tournamentId: true },
  });

  if (!alert) {
    return res.status(404).json({ error: 'Alert not found' });
  }

  // Require director+ access
  const access = await checkTournamentAccess(req, prisma, alert.tournamentId, 'director');
  if (!access.ok) {
    return res.status(access.status || 403).json({ error: access.error || 'Forbidden' });
  }

  try {
    await prisma.sOSAlert.delete({
      where: { id: alertId },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('[sos-alerts] delete failed:', error);
    res.status(500).json({ error: 'Failed to delete alert' });
  }
});

export default router;
