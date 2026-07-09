import { Router } from 'express';
import type { Response } from 'express-serve-static-core';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import {
  authenticate,
  requireRole,
  checkTournamentAccess,
  type AuthenticatedRequest,
} from '../middleware/auth.js';

const router = Router();

const createIncidentSchema = z.object({
  tournamentId: z.string().uuid(),
  matchId: z.string().uuid().optional().nullable(),
  registrationId: z.string().uuid().optional().nullable(),
  type: z.enum(['injury', 'disqualification', 'medical', 'equipment', 'conduct']),
  severity: z.enum(['minor', 'moderate', 'serious']),
  description: z.string().min(1),
  actionTaken: z.enum(['first_aid', 'withdrawn', 'continued', 'ambulance']).optional().nullable(),
});

const updateIncidentSchema = z.object({
  type: z.enum(['injury', 'disqualification', 'medical', 'equipment', 'conduct']).optional(),
  severity: z.enum(['minor', 'moderate', 'serious']).optional(),
  description: z.string().min(1).optional(),
  actionTaken: z.enum(['first_aid', 'withdrawn', 'continued', 'ambulance']).optional().nullable(),
});

// POST /api/incidents - Create incident
// Note: the parent tournamentId lives in the request body, so auth
// is checked inline after parsing to avoid a misroute where the
// middleware would otherwise read the wrong param.
router.post(
  '/',
  authenticate,
  requireRole('admin', 'director', 'scorekeeper'),
  async (req: AuthenticatedRequest, res: Response) => {
    const prisma: PrismaClient = req.app.locals.prisma;

    const parsed = createIncidentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    const data = parsed.data;

    const access = await checkTournamentAccess(req, prisma, data.tournamentId, 'scorekeeper');
    if (!access.ok) {
      return res.status(access.status || 403).json({ error: access.error });
    }

    const incident = await prisma.incident.create({
      data: {
        tournamentId: data.tournamentId,
        matchId: data.matchId ?? null,
        registrationId: data.registrationId ?? null,
        type: data.type,
        severity: data.severity,
        description: data.description,
        actionTaken: data.actionTaken ?? null,
        reportedBy: req.user?.id ?? null,
      },
    });

    res.status(201).json(incident);
  }
);

// GET /api/incidents/tournament/:tournamentId - List incidents for tournament
router.get(
  '/tournament/:id',
  authenticate,
  requireRole('admin', 'director'),
  async (req: AuthenticatedRequest, res: Response) => {
    const prisma: PrismaClient = req.app.locals.prisma;
    const tournamentId = req.params.id;

    const access = await checkTournamentAccess(req, prisma, tournamentId, 'director');
    if (!access.ok) {
      return res.status(access.status || 403).json({ error: access.error });
    }

    const incidents = await prisma.incident.findMany({
      where: { tournamentId },
      orderBy: { createdAt: 'desc' },
    });

    res.json(incidents);
  }
);

// GET /api/incidents/:id - Get incident detail
// `:id` here is the incident's id, not a tournament id — so we fetch
// the incident first and authorize against its parent tournamentId.
router.get(
  '/:id',
  authenticate,
  requireRole('admin', 'director'),
  async (req: AuthenticatedRequest, res: Response) => {
    const prisma: PrismaClient = req.app.locals.prisma;
    const incidentId = req.params.id;

    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
    });

    if (!incident) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    const access = await checkTournamentAccess(req, prisma, incident.tournamentId, 'director');
    if (!access.ok) {
      return res.status(access.status || 403).json({ error: access.error });
    }

    res.json(incident);
  }
);

// PUT /api/incidents/:id - Update incident
router.put(
  '/:id',
  authenticate,
  requireRole('admin', 'director'),
  async (req: AuthenticatedRequest, res: Response) => {
    const prisma: PrismaClient = req.app.locals.prisma;
    const incidentId = req.params.id;

    const parsed = updateIncidentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    const existing = await prisma.incident.findUnique({
      where: { id: incidentId },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    const access = await checkTournamentAccess(req, prisma, existing.tournamentId, 'director');
    if (!access.ok) {
      return res.status(access.status || 403).json({ error: access.error });
    }

    const incident = await prisma.incident.update({
      where: { id: incidentId },
      data: parsed.data,
    });

    res.json(incident);
  }
);

export default router;
