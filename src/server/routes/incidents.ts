import { Router } from 'express';
import type { Response } from 'express-serve-static-core';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

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

    try {
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
    } catch (error) {
      console.error('Failed to create incident:', error);
      res.status(500).json({ error: 'Failed to create incident' });
    }
  }
);

// GET /api/incidents/tournament/:id - List incidents for tournament
router.get(
  '/tournament/:id',
  authenticate,
  requireRole('admin', 'director'),
  async (req: AuthenticatedRequest, res: Response) => {
    const prisma: PrismaClient = req.app.locals.prisma;
    const tournamentId = req.params.id;

    try {
      const incidents = await prisma.incident.findMany({
        where: { tournamentId },
        orderBy: { createdAt: 'desc' },
      });

      res.json(incidents);
    } catch (error) {
      console.error('Failed to fetch incidents:', error);
      res.status(500).json({ error: 'Failed to fetch incidents' });
    }
  }
);

// GET /api/incidents/:id - Get incident detail
router.get(
  '/:id',
  authenticate,
  requireRole('admin', 'director'),
  async (req: AuthenticatedRequest, res: Response) => {
    const prisma: PrismaClient = req.app.locals.prisma;
    const incidentId = req.params.id;

    try {
      const incident = await prisma.incident.findUnique({
        where: { id: incidentId },
      });

      if (!incident) {
        return res.status(404).json({ error: 'Incident not found' });
      }

      res.json(incident);
    } catch (error) {
      console.error('Failed to fetch incident:', error);
      res.status(500).json({ error: 'Failed to fetch incident' });
    }
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

    try {
      const existing = await prisma.incident.findUnique({
        where: { id: incidentId },
      });

      if (!existing) {
        return res.status(404).json({ error: 'Incident not found' });
      }

      const incident = await prisma.incident.update({
        where: { id: incidentId },
        data: parsed.data,
      });

      res.json(incident);
    } catch (error) {
      console.error('Failed to update incident:', error);
      res.status(500).json({ error: 'Failed to update incident' });
    }
  }
);

export default router;
