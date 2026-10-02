// Family portal: a parent types the email they registered with and gets a
// short-lived link listing every registration made with it (tournament
// details, events, divisions, next match, results). No account or password.
//
// Privacy: the request endpoint answers the same way whether or not the
// email has registrations, and the list is only ever shown through the
// emailed link, so knowing an email address reveals nothing.
import { Router } from 'express';
import type { Request, Response } from 'express-serve-static-core';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { createRateLimiter } from '../middleware/rate-limit.js';
import { isEmailConfigured, sendEmail } from '../services/email.js';
import { familyAccessEmail } from '../services/email-templates.js';
import { getBracketPlacementsFromLoaded } from '../services/match-advancement.js';
import { getEventTypeLabel } from '../../shared/constants/sport-profiles.js';
import {
  generateManagementToken,
  getManagementTokenExpiry,
  hashManagementToken,
  isValidManagementToken,
} from '../utils/registration-management-token.js';
import {
  FAMILY_LINK_TTL_MS,
  familyRegistrationWhere,
  nextMatchFor,
  normalizeFamilyEmail,
  registrationStatusFor,
} from '../services/family-portal.js';

const router = Router();

const requestLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many requests. Please try again in a few minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const viewLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Too many requests. Please try again in a few minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const requestSchema = z.object({ email: z.string().trim().email().max(254) });
const tokenSchema = z.object({ token: z.string() });

const GENERIC_REPLY = {
  message: 'If we have registrations for that email, a link to them is on its way.',
};

async function emailForToken(prisma: PrismaClient, token: unknown): Promise<string | null> {
  if (typeof token !== 'string' || !isValidManagementToken(token)) return null;
  const link = await prisma.familyAccessLink.findUnique({ where: { tokenHash: hashManagementToken(token) } });
  if (!link || link.expiresAt < new Date()) return null;
  return link.email;
}

router.post('/request-link', requestLimiter, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email address.' });
  const email = normalizeFamilyEmail(parsed.data.email);

  const count = await prisma.registration.count({ where: familyRegistrationWhere(email) });
  if (count === 0) return res.json(GENERIC_REPLY);

  // Tidy up expired links as we go; the table stays tiny.
  await prisma.familyAccessLink.deleteMany({ where: { expiresAt: { lt: new Date() } } });

  const token = generateManagementToken();
  await prisma.familyAccessLink.create({
    data: { email, tokenHash: hashManagementToken(token), expiresAt: new Date(Date.now() + FAMILY_LINK_TTL_MS) },
  });
  const accessUrl = `${process.env.PUBLIC_APP_URL || ''}/my-registrations?token=${encodeURIComponent(token)}`;

  if (isEmailConfigured()) {
    const { subject, html } = familyAccessEmail({ accessUrl, registrationCount: count });
    // Not awaited: the reply takes the same time whether or not we send.
    void sendEmail(email, subject, html).then((sent) => {
      if (!sent.success) console.error('[family-portal] access link email failed');
    });
    return res.json(GENERIC_REPLY);
  }

  // Dev mode (no email set up): log the link, never return it — except for
  // the e2e suite, which reads it from the response.
  console.log(`[dev-auth] family portal link for ${email}: ${accessUrl}`);
  if (process.env.ENABLE_E2E_AUTH_BYPASS === '1' && process.env.NODE_ENV !== 'production') {
    return res.json({ ...GENERIC_REPLY, devAccessUrl: accessUrl });
  }
  res.json(GENERIC_REPLY);
});

router.post('/registrations', viewLimiter, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const parsed = tokenSchema.safeParse(req.body);
  const email = parsed.success ? await emailForToken(prisma, parsed.data.token) : null;
  if (!email) return res.status(401).json({ error: 'This link has expired. Ask for a new one below.' });

  const registrations = await prisma.registration.findMany({
    where: familyRegistrationWhere(email),
    orderBy: [{ tournament: { date: 'asc' } }, { createdAt: 'asc' }],
    select: {
      id: true,
      patterns: true,
      sparring: true,
      checkedIn: true,
      waitlistStatus: true,
      waitlistPosition: true,
      paymentStatus: true,
      managementTokenRevokedAt: true,
      competitor: { select: { firstName: true, lastName: true } },
      tournament: {
        select: {
          id: true,
          name: true,
          date: true,
          location: true,
          status: true,
          sportProfileSlug: true,
          publicSlug: true,
          brandName: true,
          organization: { select: { name: true, brandName: true } },
        },
      },
      assignments: {
        where: { division: { deletedAt: null } },
        select: {
          division: {
            select: {
              id: true,
              name: true,
              eventType: true,
              bracket: {
                select: {
                  structure: true,
                  matches: {
                    select: {
                      matchNumber: true,
                      bracketType: true,
                      status: true,
                      winnerId: true,
                      competitor1Id: true,
                      competitor2Id: true,
                      score1: true,
                      score2: true,
                      ringNumber: true,
                      scheduledTime: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  res.json({
    email,
    registrations: registrations.map((reg) => {
      const t = reg.tournament;
      const slug = t.sportProfileSlug;
      return {
        id: reg.id,
        confirmationCode: reg.id.slice(0, 8),
        competitorName: `${reg.competitor.firstName} ${reg.competitor.lastName}`.trim(),
        status: registrationStatusFor(reg),
        waitlistPosition: reg.waitlistStatus === 'waitlisted' ? reg.waitlistPosition : null,
        paymentStatus: reg.paymentStatus,
        checkedIn: reg.checkedIn,
        canManage: !reg.managementTokenRevokedAt,
        events: [
          reg.patterns ? getEventTypeLabel(slug, 'patterns') : null,
          reg.sparring ? getEventTypeLabel(slug, 'sparring') : null,
        ].filter((e): e is string => Boolean(e)),
        tournament: {
          name: t.name,
          date: t.date,
          location: t.location,
          status: t.status,
          organizer: t.brandName || t.organization?.brandName || t.organization?.name || null,
          liveResultsUrl: t.publicSlug ? `/display/${t.id}?key=${encodeURIComponent(t.publicSlug)}` : null,
        },
        divisions: reg.assignments.map(({ division }) => {
          const matches = (division.bracket?.matches ?? []).map((m) => ({
            ...m,
            bracketType: m.bracketType as 'winners' | 'losers' | 'finals',
          }));
          const placements = division.bracket
            ? getBracketPlacementsFromLoaded(division.bracket.structure, matches)
            : [];
          const place = placements.find((p) => p.competitorId === reg.id)?.place ?? null;
          return {
            name: division.name,
            event: getEventTypeLabel(slug, division.eventType),
            place,
            nextMatch: nextMatchFor(reg.id, matches),
          };
        }),
      };
    }),
  });
});

// Opens the existing change/withdraw page for one registration. Issues a
// fresh management link (the older emailed one stops working) unless the
// organizer has locked it.
router.post('/registrations/:id/manage-link', viewLimiter, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const parsed = tokenSchema.safeParse(req.body);
  const email = parsed.success ? await emailForToken(prisma, parsed.data.token) : null;
  if (!email) return res.status(401).json({ error: 'This link has expired. Ask for a new one below.' });

  const registration = await prisma.registration.findFirst({
    where: { id: req.params.id, ...familyRegistrationWhere(email) },
    select: { id: true, managementTokenRevokedAt: true },
  });
  if (!registration) return res.status(404).json({ error: 'Registration not found.' });
  if (registration.managementTokenRevokedAt) {
    return res.status(403).json({ error: 'The organizer has locked changes to this registration. Please contact them.' });
  }

  const manageToken = generateManagementToken();
  await prisma.registration.update({
    where: { id: registration.id },
    data: { managementTokenHash: hashManagementToken(manageToken), managementTokenExpiresAt: getManagementTokenExpiry() },
  });
  res.json({ url: `/manage-registration?token=${encodeURIComponent(manageToken)}` });
});

export default router;
