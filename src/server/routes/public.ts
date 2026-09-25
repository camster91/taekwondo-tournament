// Public registration routes - no authentication required
import { Router } from 'express';
import type { Request, Response } from 'express-serve-static-core';
import { PrismaClient } from '@prisma/client';
import { calculateAge } from '../../shared/constants/age-groups.js';
import { normalizeBelt } from '../../shared/constants/belts.js';
import {
  buildRegistrationPatch,
  buildRegistrationConsent,
  registrationLegalConfigFromEnv,
  validateLookupParams,
  PUBLIC_REGISTRATION_LIMITS,
} from './public-validation.js';
import { sendEmail, isEmailConfigured } from '../services/email.js';
import {
  optionalAuthenticate,
  checkTournamentAccess,
  type AuthenticatedRequest,
} from '../middleware/auth.js';
import {
  hashManagementToken,
  isValidManagementToken,
  validateManagementTokenStatus,
} from '../utils/registration-management-token.js';
import { recordPublicDisplayHeartbeat } from '../services/public-display-heartbeat.js';
import {
  CHECKOUT_ALLOWED_PAYMENT_STATUSES,
  createPublicRegistration,
  entryFeeLineItems,
  isCompetitorOwnedByRegistration,
  parseTournamentFeeCents,
  publicRegistrationErrorResponse,
  type CreatePublicRegistrationResult,
} from '../services/public-registration.js';
import { promoteNextWaitlisted } from '../services/waitlist.js';
import { expireCheckoutSessionBestEffort } from '../services/stripe-billing.js';
import { publicScoreboardDivisionArgs } from './public-scoreboard-query.js';

const router = Router();

const legalConfig = () => registrationLegalConfigFromEnv(
  process.env,
  process.env.NODE_ENV === 'production',
);

import { createRateLimiter } from '../middleware/rate-limit.js';

/** Expose only public-safe fields from tournament.settings JSON. */
function publicRegistrationSettings(raw: string | null): { registrationFee?: string } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const fee = parsed.registrationFee;
    if (typeof fee === 'string' && fee.trim()) return { registrationFee: fee };
    return null;
  } catch {
    return null;
  }
}

// Rate limit public registration to prevent abuse: 10 submissions per 15 minutes per IP
const registrationLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many registration attempts. Please try again later.' },
});

// School portal share-link reads can dump a school's full roster and
// match history, but they're public-by-design so parents don't need to
// log in. Limit to 30 per minute per IP — the SchoolPortal.tsx page
// polls every 15s when a school is selected (4 polls/minute per
// browser) so this leaves headroom for a handful of concurrent viewers
// while blocking scripted scrapes that enumerate schoolNames.
const schoolPortalLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many requests. Please try again later.' },
});

router.get('/legal-config', (_req: Request, res: Response) => {
  res.json(legalConfig());
});

// Get open tournaments (status = 'registration')
router.get('/tournaments', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  const tournaments = await prisma.tournament.findMany({
    where: {
      status: 'registration',
      date: {
        gte: new Date(), // Only future tournaments
      },
      deletedAt: null, // Exclude soft-deleted tournaments
    },
    select: {
      id: true,
      name: true,
      date: true,
      location: true,
      sportProfileSlug: true,
      // Settings carries director-only config; only registrationFee
      // is safe for the public register page.
      settings: true,
      brandName: true,
      brandPrimaryColor: true,
      brandLogoUrl: true,
      organizationId: true,
      organization: {
        select: {
          brandName: true,
          brandPrimaryColor: true,
          brandLogoUrl: true,
        },
      },
      _count: {
        select: { registrations: true },
      },
    },
    orderBy: { date: 'asc' },
  });

  // Resolve branding with org fallback before sending to client
  res.json(
    tournaments.map((t) => ({
      ...t,
      settings: publicRegistrationSettings(t.settings),
      // Resolve effective branding: tournament overrides org, org overrides defaults
      brandName: t.brandName || t.organization?.brandName || t.name,
      brandPrimaryColor: t.brandPrimaryColor || t.organization?.brandPrimaryColor || '#DC2626',
      brandLogoUrl: t.brandLogoUrl || t.organization?.brandLogoUrl || null,
      // Don't expose organization object to public API
      organization: undefined,
      organizationId: undefined,
    })),
  );
});

// Get tournament details for registration
router.get('/tournaments/:id', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  // Accept either a tournament UUID or a publicSlug. The slug path is
  // needed by the share-link client-side resolver (PublicScoreboardBySlug)
  // which redirects /scoreboard/:slug -> /display/:tournamentId. Looking
  // up by slug here means we don't need a separate route.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id);
  const tournament = await prisma.tournament.findUnique({
    where: isUuid ? { id: req.params.id } : { publicSlug: req.params.id },
    select: {
      id: true,
      name: true,
      date: true,
      location: true,
      status: true,
      deletedAt: true,
      settings: true,
      sportProfileSlug: true,
      brandName: true,
      brandPrimaryColor: true,
      brandLogoUrl: true,
      organizationId: true,
      publicScoreboardRefreshMs: true,
      maxCapacity: true,
      waitlistEnabled: true,
      organization: {
        select: {
          brandName: true,
          brandPrimaryColor: true,
          brandLogoUrl: true,
        },
      },
    },
  });

  if (!tournament || tournament.deletedAt) {
    return res.status(404).json({ error: 'Tournament not found' });
  }

  // Get capacity status for public display (if capacity limit set)
  let capacityStatus = null;
  if (tournament.maxCapacity && tournament.status === 'registration') {
    const { getTournamentCapacityStatus } = await import('../services/waitlist.js');
    capacityStatus = await getTournamentCapacityStatus(prisma, tournament.id);
  }

  // Previously gated to status === 'registration' which broke the public
  // scoreboard during in_progress / brackets / completed events. The scoreboard
  // needs the tournament name + date to render its header, and that's not
  // sensitive. Status is exposed so the client can show "Registration closed"
  // on its own if it wants — the server no longer hard-blocks.
  res.json({
    ...tournament,
    settings: publicRegistrationSettings(tournament.settings),
    // Resolve effective branding with org fallback
    brandName: tournament.brandName || tournament.organization?.brandName || tournament.name,
    brandPrimaryColor: tournament.brandPrimaryColor || tournament.organization?.brandPrimaryColor || '#DC2626',
    brandLogoUrl: tournament.brandLogoUrl || tournament.organization?.brandLogoUrl || null,
    // Capacity status (no PII exposed - just counts)
    capacityStatus,
    // Don't expose organization object to public API
    organization: undefined,
    organizationId: undefined,
  });
});

// Public self-registration
router.post('/register', registrationLimiter, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  const {
    tournamentId,
    firstName,
    lastName,
    gender,
    dateOfBirth,
    belt,
    danRank,
    heightInches,
    weightLbs,
    schoolDojang,
    specialNeeds,
    patterns,
    sparring,
    parentName,
    parentEmail,
    parentPhone,
    competeWithOlder,
    privacyAccepted,
    rulesAccepted,
    guardianAttested,
  } = req.body;

  // Validation
  const errors: string[] = [];

  // Length caps on every free-text field. The previous validation
  // checked required + format but not length, so a malicious or
  // buggy client could push a 10 MB parentName and we'd write it
  // to the DB. The caps below match the column widths in
  // schema.prisma (Competitor.firstName/lastName varchar(100),
  // Competitor.specialNeeds text, Registration.parentName
  // varchar(200), etc).
  if (!tournamentId) errors.push('Tournament is required');
  if (!firstName?.trim()) errors.push('First name is required');
  else if (firstName.length > 100) errors.push('First name must be 100 characters or fewer');
  if (!lastName?.trim()) errors.push('Last name is required');
  else if (lastName.length > 100) errors.push('Last name must be 100 characters or fewer');
  if (!gender || !['M', 'F'].includes(gender)) errors.push('Gender is required (M or F)');
  if (!dateOfBirth) errors.push('Date of birth is required');
  if (!belt?.trim()) errors.push('Belt level is required');
  if (!patterns && !sparring) errors.push('Please select at least one event (Patterns or Sparring)');
  if (schoolDojang && schoolDojang.length > 200) errors.push('School/dojang name must be 200 characters or fewer');
  if (specialNeeds && specialNeeds.length > 2000) errors.push('Special needs must be 2000 characters or fewer');
  if (parentName && parentName.length > 200) errors.push('Parent name must be 200 characters or fewer');
  if (parentEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail)) errors.push('Parent email is not a valid email');
  if (parentEmail && parentEmail.length > 200) errors.push('Parent email must be 200 characters or fewer');
  if (parentPhone && parentPhone.length > 50) errors.push('Parent phone must be 50 characters or fewer');

  if (sparring && !weightLbs) {
    errors.push('Weight is required for sparring registration');
  }
  if (weightLbs != null) {
    const w = Number(weightLbs);
    if (!Number.isFinite(w) || w < 0 || w > 500) {
      errors.push('Weight must be a number between 0 and 500');
    }
  }
  if (heightInches != null) {
    const h = Number(heightInches);
    if (!Number.isFinite(h) || h < 0 || h > 108) {
      errors.push('Height must be a number between 0 and 108 inches');
    }
  }
  if (danRank != null) {
    const d = Number(danRank);
    if (!Number.isInteger(d) || d < 0 || d > 9) {
      errors.push('Dan rank must be an integer between 0 and 9');
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  try {
    // Check tournament is open for registration
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: { organization: { select: { plan: true } } },
    });

    if (!tournament || tournament.deletedAt) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    if (tournament.status !== 'registration') {
      return res.status(400).json({ error: 'Tournament is not open for registration' });
    }

    // The plan limit is enforced inside createPublicRegistration under the
    // tournament row lock (a pre-check here would race).
    const plan = tournament.organization?.plan ?? 'free';

    // Normalize belt
    const normalizedBelt = normalizeBelt(belt);

    // Calculate age at tournament
    const dob = new Date(dateOfBirth);
    const ageAtTournament = calculateAge(dob, tournament.date);
    const isMinor = calculateAge(dob, new Date()) < 18;

    // P1.1: Require parent contact for minors when guardianAttested
    if (isMinor && guardianAttested) {
      if (!parentName?.trim()) {
        return res.status(400).json({ error: 'Parent/Guardian name is required for competitors under 18' });
      }
      if (!parentEmail?.trim()) {
        return res.status(400).json({ error: 'Parent/Guardian email is required for competitors under 18' });
      }
    }

    const consent = buildRegistrationConsent(
      { privacyAccepted, rulesAccepted, guardianAttested },
      isMinor,
      legalConfig().consentVersion,
      new Date(),
    );
    if (!consent.ok) {
      return res.status(400).json({ error: 'Validation failed', details: [consent.error] });
    }

    if (ageAtTournament < 4) {
      return res.status(400).json({ error: 'Competitors must be at least 4 years old' });
    }

    // P2-2: Parse tournament fee settings
    const tournamentFeeCents = parseTournamentFeeCents(tournament.settings);
    const feeRequired = tournamentFeeCents > 0;

    // Competitor lookup/creation, plan limit, capacity/waitlist and the
    // insert all run in one transaction under a tournament row lock.
    // Closes B7 (case-insensitive name + DOB match) but only re-uses an
    // existing competitor from the same tenant, and never modifies it.
    // The raw management token is returned/sent once; only its digest
    // is persisted.
    let created: CreatePublicRegistrationResult;
    try {
      created = await createPublicRegistration(prisma, {
        tournamentId,
        organizationId: tournament.organizationId,
        plan,
        competitor: {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          gender,
          dateOfBirth: dob,
          belt: normalizedBelt,
          danRank: normalizedBelt === 'Black' ? (danRank || 1) : null,
          heightInches: heightInches || null,
          weightLbs: weightLbs || null,
          schoolDojang: schoolDojang?.trim() || null,
          specialNeeds: specialNeeds?.trim() || null,
        },
        registration: {
          patterns: patterns || false,
          sparring: sparring || false,
          weightAtRegistration: weightLbs || null,
          ageAtTournament,
          parentName: parentName?.trim() || null,
          parentEmail: parentEmail?.trim() || null,
          parentPhone: parentPhone?.trim() || null,
          // v2: parent opt-in fields
          competeWithOlder: competeWithOlder === true,
          specialNeeds: specialNeeds?.trim() || null,
          // P2-2: Payment status
          paymentStatus: feeRequired ? 'pending' : 'not_required',
          paymentAmountCents: feeRequired ? tournamentFeeCents : null,
          ...consent.data,
        },
      });
    } catch (error) {
      const handled = publicRegistrationErrorResponse(error, `${firstName} ${lastName}`, 'tournament');
      if (handled) return res.status(handled.status).json(handled.body);
      throw error;
    }

    const { managementToken, competitor } = created;
    const registration = {
      ...created.registration,
      tournament: { name: tournament.name, date: tournament.date, location: tournament.location },
    };

    // P2-2: If payment is required, generate checkout URL
    let checkoutUrl: string | undefined;
    if (feeRequired && registration.paymentStatus === 'pending') {
      // Inline checkout session creation to avoid extra DB round-trip
      const stripeSecretKey = process.env.STRIPE_SECRET_KEY?.trim();
      if (stripeSecretKey) {
        try {
          const Stripe = (await import('stripe')).default;
          const stripe = new Stripe(stripeSecretKey);

          const publicUrl = process.env.PUBLIC_APP_URL || 'http://localhost:5173';
          const successUrl = `${publicUrl}/register?payment=success&registration=${registration.id}`;
          const cancelUrl = `${publicUrl}/register?payment=cancelled&registration=${registration.id}`;

          const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            payment_method_types: ['card'],
            line_items: entryFeeLineItems(registration.tournament.name, tournamentFeeCents),
            metadata: {
              registrationId: registration.id,
              tournamentId: registration.tournamentId,
              type: 'entry_fee',
            },
            success_url: successUrl,
            cancel_url: cancelUrl,
          });

          // Update registration with payment intent ID
          await prisma.registration.update({
            where: { id: registration.id },
            data: { paymentIntentId: session.id },
          });

          checkoutUrl = session.url ?? undefined;
        } catch (error) {
          // Log error but don't fail the registration; payment can be collected later
          console.error('Failed to create checkout session:', error);
        }
      }
    }

    const responseData = {
      success: true,
      message: registration.waitlistStatus === 'waitlisted' 
        ? 'Added to waitlist! You\'ll be notified if a spot opens up.'
        : feeRequired && checkoutUrl
          ? 'Registration created! Please complete payment to finalize.'
          : 'Registration successful!',
      registration: {
        id: registration.id,
        // First 8 chars of the UUID. The /api/public/check-registration
        // endpoint uses the same field for parent lookups — "did my
        // registration go through?" The parent should see this number
        // on the success screen AND in the confirmation email so they
        // can match the two if needed.
        confirmationCode: registration.id.slice(0, 8),
        managementToken,
        competitorName: `${competitor.firstName} ${competitor.lastName}`,
        tournamentName: registration.tournament.name,
        tournamentDate: registration.tournament.date,
        events: {
          patterns: registration.patterns,
          sparring: registration.sparring,
        },
        ageGroup: getAgeGroupLabel(ageAtTournament),
        waitlistStatus: registration.waitlistStatus,
        waitlistPosition: registration.waitlistPosition,
        paymentStatus: registration.paymentStatus,
        paymentAmountCents: registration.paymentAmountCents,
      },
      checkoutUrl,
    };

    res.status(201).json(responseData);

    // Send confirmation email if parent email is provided and email is configured
    if (parentEmail && isEmailConfigured()) {
      const eventList = [
        patterns && 'Patterns',
        sparring && 'Sparring',
      ].filter(Boolean).join(' & ');
      
      // Resolve tournament branding for email
      const tournamentForEmail = await prisma.tournament.findUnique({
        where: { id: tournamentId },
        select: {
          name: true,
          date: true,
          location: true,
          brandName: true,
          organization: {
            select: {
              brandName: true,
            },
          },
        },
      });
      
      const organizerBrandName = tournamentForEmail?.brandName || tournamentForEmail?.organization?.brandName || undefined;
      const managementUrl = `${process.env.PUBLIC_APP_URL || ''}/manage-registration?token=${encodeURIComponent(managementToken)}`;
      
      // P2-14: For minors, send parental consent verification email INSTEAD of confirmation
      if (isMinor) {
        const { createParentalConsentVerification } = await import('../services/parental-consent-verification.js');
        const { parentalConsentVerificationEmail } = await import('../services/email-templates.js');
        
        const { token: verificationToken, code: verificationCode } = await createParentalConsentVerification(
          prisma,
          registration.id,
          parentEmail,
        );
        
        const verificationUrl = `${process.env.PUBLIC_APP_URL || ''}/verify-parent-consent?token=${encodeURIComponent(verificationToken)}`;
        const { subject, html } = parentalConsentVerificationEmail({
          parentName,
          competitorName: `${competitor.firstName} ${competitor.lastName}`,
          tournamentName: tournamentForEmail?.name || registration.tournament.name,
          tournamentDate: tournamentForEmail?.date || registration.tournament.date,
          verificationUrl,
          code: verificationCode,
          organizerBrandName,
        });
        
        sendEmail(parentEmail, subject, html).catch((err) => {
          console.error('[public/register] parental consent verification email failed:', err);
        });
      } else {
        // Adult registration — send standard confirmation email
        if (registration.waitlistStatus === 'waitlisted') {
          // Waitlist notification email
          const { registrationConfirmationEmail, waitlistNotificationEmail } = await import('../services/email-templates.js');
          const { subject, html } = waitlistNotificationEmail({
            competitorName: `${competitor.firstName} ${competitor.lastName}`,
            tournamentName: tournamentForEmail?.name || registration.tournament.name,
            tournamentDate: tournamentForEmail?.date || registration.tournament.date,
            waitlistPosition: registration.waitlistPosition!,
            managementUrl,
            organizerBrandName,
          });
          sendEmail(parentEmail, subject, html).catch((err) => {
            console.error('[public/register] waitlist email failed:', err);
          });
        } else {
          // Active registration confirmation email
          const { registrationConfirmationEmail } = await import('../services/email-templates.js');
          const { subject, html } = registrationConfirmationEmail({
            competitorName: `${competitor.firstName} ${competitor.lastName}`,
            tournamentName: tournamentForEmail?.name || registration.tournament.name,
            tournamentDate: tournamentForEmail?.date || registration.tournament.date,
            tournamentLocation: tournamentForEmail?.location || registration.tournament.location,
            events: eventList,
            ageGroup: getAgeGroupLabel(ageAtTournament),
            parentName,
            confirmationCode: registration.id.slice(0, 8),
            managementUrl,
            organizerBrandName,
          });
          sendEmail(parentEmail, subject, html).catch((err) => {
            console.error('[public/register] confirmation email failed:', err);
          });
        }
      }
    }
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// Public scoreboard. Requires a per-tournament public slug so the
// endpoint can't be used to enumerate competitors across the whole
// platform. The slug is generated in the Tournament Settings UI
// (see tournaments.ts PUT handler) and the public scoreboard URL
// shape is `/scoreboard/:publicSlug` — a wrong/missing slug is
// indistinguishable from a non-existent tournament (404).
//
// Rate-limited so a leaked slug can't be scraped in bulk.
const scoreboardLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 30,             // 30 requests per minute per IP
});

router.get('/scoreboard/:publicSlug', scoreboardLimiter, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { publicSlug } = req.params;

  const tournament = await prisma.tournament.findUnique({
    where: { publicSlug },
  });

  if (!tournament || tournament.deletedAt) {
    // Identical response for "no such slug" and "no such tournament" so
    // an attacker can't tell whether a slug exists.
    return res.status(404).json({ error: 'Scoreboard not found' });
  }

  // Explicit select only — Registration rows carry parent contact
  // details, medical notes, weights and token hashes (see
  // public-scoreboard-query.ts).
  const divisions = await prisma.division.findMany(publicScoreboardDivisionArgs(tournament.id));

  res.json(divisions);
});

router.post('/tournaments/:id/display-heartbeat', scoreboardLimiter, optionalAuthenticate, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const tournament = await prisma.tournament.findUnique({
    where: { id: req.params.id },
    select: { id: true, publicSlug: true, deletedAt: true },
  });
  if (!tournament || tournament.deletedAt || !tournament.publicSlug) {
    return res.status(404).json({ error: 'Scoreboard not found' });
  }

  const suppliedKey = typeof req.query.key === 'string' ? req.query.key : '';
  if (suppliedKey !== tournament.publicSlug) {
    const authenticatedReq = req as AuthenticatedRequest;
    const access = authenticatedReq.user
      ? await checkTournamentAccess(authenticatedReq, prisma, tournament.id, 'viewer')
      : { ok: false };
    if (!access.ok) {
      return res.status(404).json({ error: 'Scoreboard not found' });
    }
  }

  const heartbeat = await recordPublicDisplayHeartbeat(prisma, tournament.id);
  res.json(heartbeat);
});

// Public scoreboard by tournament UUID. Requires an existing publicSlug
// (director must have generated a share link). Does NOT auto-create a
// slug — that previously defeated revoke/rotation and exposed roster
// data to anyone who knew/guessed the UUID (e.g. from /register?tournament=).
router.get('/tournaments/:id/scoreboard', scoreboardLimiter, optionalAuthenticate, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const id = req.params.id;

  const tournament = await prisma.tournament.findUnique({
    where: { id },
    select: {
      id: true,
      publicSlug: true,
      settings: true,
      deletedAt: true,
    },
  });
  if (!tournament || tournament.deletedAt || !tournament.publicSlug) {
    // Identical 404 whether missing, soft-deleted, or unpublished.
    return res.status(404).json({ error: 'Scoreboard not found' });
  }

  const suppliedKey = typeof req.query.key === 'string' ? req.query.key : '';
  if (suppliedKey !== tournament.publicSlug) {
    const authenticatedReq = req as AuthenticatedRequest;
    if (!authenticatedReq.user) {
      return res.status(404).json({ error: 'Scoreboard not found' });
    }
    const access = await checkTournamentAccess(authenticatedReq, prisma, id, 'viewer');
    if (!access.ok) {
      return res.status(404).json({ error: 'Scoreboard not found' });
    }
  }

  // Director-controlled display mode + featured match override (M8).
  let displaySettings: { mode?: string; ringNumber?: number; featuredMatchId?: string } = {};
  try {
    if (tournament.settings) {
      const parsed = JSON.parse(tournament.settings);
      if (parsed && typeof parsed === 'object' && parsed.display && typeof parsed.display === 'object') {
        displaySettings = parsed.display as typeof displaySettings;
      }
    }
  } catch {
    // settings JSON corrupt — fall through with empty displaySettings
  }

  const divisions = await prisma.division.findMany(publicScoreboardDivisionArgs(id));

  res.json({ divisions, displaySettings });
});

// Check existing registration. Returns ONLY a boolean + a minimal
// confirmation code (the first 6 chars of the registration ID) so
// a parent can confirm "yes I'm registered" without the response
// being useful for competitor enumeration. No name, school, belt,
// or date of birth is echoed back — those are still PII.
//
// Rate-limited: an attacker who guesses a name + DOB combo should
// not be able to iterate the whole roster.
const checkRegistrationLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                  // 20 lookups per 15 min per IP
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/check-registration', checkRegistrationLimiter, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  const { tournamentId, firstName, lastName, dateOfBirth } = req.query;

  if (!tournamentId || !firstName || !lastName || !dateOfBirth) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  const registration = await prisma.registration.findFirst({
    where: {
      tournamentId: String(tournamentId),
      competitor: {
        firstName: String(firstName).trim(),
        lastName: String(lastName).trim(),
        dateOfBirth: new Date(String(dateOfBirth)),
      },
    },
    select: {
      id: true,
      // intentionally do NOT select competitor.firstName / lastName /
      // school / belt / dob — those would make this endpoint a
      // competitor-enumeration API for anyone with a name + DOB guess.
    },
  });

  if (!registration) {
    // Return identical 404 for "no such registration" so an attacker
    // can't distinguish "I got the name wrong" from "I got the DOB
    // wrong". The boolean is the only information leaked.
    return res.status(404).json({ registered: false });
  }

  // The "confirmation code" is the first 8 chars of the registration
  // UUID — enough for the parent's eyes to match against the email
  // they received, not enough to be a useful identifier externally.
  res.json({
    registered: true,
    confirmationCode: registration.id.slice(0, 8),
  });
});

// Lookup a registration by confirmation code + last name + DOB (3-factor).
// Used by the parent-facing "Manage Registration" page so they can
// edit / withdraw their kid's entry without an account.
//
// Returns the FULL registration + competitor + tournament data when
// all three factors match. 404 if any factor is wrong (same shape as
// check-registration, no enumeration via differential responses).
const manageLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many lookups. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/registrations/:token', manageLimiter, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const token = String(req.params.token || '');
  if (!isValidManagementToken(token)) return res.status(404).json({ error: 'No matching registration found.' });

  // Match by registration.managementTokenHash
  const registration = await prisma.registration.findFirst({
    where: {
      managementTokenHash: hashManagementToken(token),
    },
    include: {
      competitor: {
        select: { firstName: true, lastName: true, dateOfBirth: true, gender: true, belt: true, schoolDojang: true },
      },
      tournament: { select: { id: true, name: true, date: true, status: true } },
    },
  });

  if (!registration) {
    return res.status(404).json({ error: 'No matching registration found.' });
  }

  // #118 acceptance: Expiration + revocation check. Use the same
  // 404 error shape as "token not found" (no enumeration).
  const statusCheck = validateManagementTokenStatus(
    registration.managementTokenExpiresAt,
    registration.managementTokenRevokedAt,
  );
  if (!statusCheck.valid) {
    return res.status(404).json({ error: 'No matching registration found.' });
  }

  // #118 acceptance: Audit log (non-sensitive: no raw token, no full PII)
  console.log(`[registration-manage-read] Registration ${registration.id.slice(0, 8)} accessed via management token`);

  // Competitor-profile fields (gender, belt, school) come from the shared
  // Competitor row. If this registration re-used a pre-existing competitor
  // (same tenant, matched by name + DOB) the token holder did not supply
  // that data and must not be able to read it back.
  const ownsProfile = await isCompetitorOwnedByRegistration(prisma, registration);

  res.json({
    registration: {
      confirmationCode: registration.id.slice(0, 8),
      firstName: registration.competitor.firstName,
      lastName: registration.competitor.lastName,
      dateOfBirth: registration.competitor.dateOfBirth,
      gender: ownsProfile ? registration.competitor.gender : null,
      belt: ownsProfile ? registration.competitor.belt : null,
      weight: registration.weightAtRegistration,
      school: ownsProfile ? registration.competitor.schoolDojang : null,
      profileEditable: ownsProfile,
      specialNeeds: registration.specialNeeds,
      competeWithOlder: registration.competeWithOlder,
      patterns: registration.patterns,
      sparring: registration.sparring,
      tournamentId: registration.tournamentId,
      tournamentName: registration.tournament.name,
      tournamentDate: registration.tournament.date,
      tournamentStatus: registration.tournament.status,
      checkedIn: registration.checkedIn,
    },
  });
});

const manageUpdateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many updates. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Update a registration by confirmation code. Parents can fix typos,
// change belts, toggle which events they're entered in. Director-side
// changes go through /api/tournaments/:id/registrations/:id.
router.patch('/registrations/:token', manageUpdateLimiter, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const token = String(req.params.token || '');
  if (!isValidManagementToken(token)) return res.status(404).json({ error: 'No matching registration found.' });

  const registration = await prisma.registration.findFirst({
    where: {
      managementTokenHash: hashManagementToken(token),
    },
    include: { tournament: { select: { status: true, date: true } } },
  });

  if (!registration) {
    return res.status(404).json({ error: 'No matching registration found.' });
  }

  // #118 acceptance: Expiration + revocation check
  const statusCheck = validateManagementTokenStatus(
    registration.managementTokenExpiresAt,
    registration.managementTokenRevokedAt,
  );
  if (!statusCheck.valid) {
    return res.status(404).json({ error: 'No matching registration found.' });
  }

  // Hard rules: can't edit a checked-in registration, can't edit a
  // tournament that's already in_progress or later.
  if (registration.checkedIn) {
    return res.status(409).json({ error: 'Cannot edit a checked-in registration. Talk to the director at the venue.' });
  }
  if (['in_progress', 'completed'].includes(registration.tournament.status)) {
    return res.status(409).json({ error: 'Cannot edit a registration once the tournament has started.' });
  }

  // Build the patch object via the shared validator. The validator
  // normalizes fields, applies length caps, and surfaces clear 400
  // errors for any out-of-range value. See public-validation.ts.
  //
  // GET hides competitor-profile fields (gender/belt/school) when the
  // token holder does not own the competitor row, so the client echoes
  // them back empty. Treat empty values for those fields as "unchanged"
  // rather than as validation errors.
  const body: Record<string, unknown> = { ...(req.body ?? {}) };
  for (const key of ['gender', 'belt', 'school', 'danRank'] as const) {
    if (body[key] === '' || body[key] === null) delete body[key];
  }
  const { ok, error, data, regData } = buildRegistrationPatch(body);
  if (!ok) {
    return res.status(400).json({ error: error ?? 'Invalid patch.' });
  }

  // specialNeeds and competeWithOlder are per-registration data (the
  // Registration row has both columns; Competitor has no competeWithOlder),
  // so they never touch the shared Competitor row.
  for (const key of ['specialNeeds', 'competeWithOlder'] as const) {
    if (key in data) {
      regData[key] = data[key];
      delete data[key];
    }
  }

  if (Object.keys(data).length === 0 && Object.keys(regData).length === 0) {
    return res.status(400).json({ error: 'No editable fields supplied.' });
  }

  // Use a transaction so competitor + registration stay consistent. The
  // management token only authorizes edits to the Competitor row when
  // that row was created by this registration and is not registered
  // anywhere else; otherwise it may be a record shared with other
  // tournaments (or entered by the organizer) and a token holder must
  // not overwrite it.
  const outcome = await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) {
      const current = await tx.competitor.findUnique({
        where: { id: registration.competitorId },
        select: { firstName: true, gender: true, belt: true, danRank: true, schoolDojang: true },
      });
      const changed = Object.fromEntries(
        Object.entries(data).filter(([key, value]) => current?.[key as keyof typeof current] !== value),
      );
      if (Object.keys(changed).length > 0) {
        const owned = await isCompetitorOwnedByRegistration(tx, registration);
        if (!owned) return 'profile_locked' as const;
        await tx.competitor.update({ where: { id: registration.competitorId }, data: changed });
      }
    }
    if (Object.keys(regData).length > 0) {
      await tx.registration.update({ where: { id: registration.id }, data: regData });
    }
    return 'ok' as const;
  });

  if (outcome === 'profile_locked') {
    return res.status(409).json({
      error: 'Name, gender, belt and school for this competitor are managed by the tournament organizer. Please contact them to change these details.',
      code: 'COMPETITOR_PROFILE_LOCKED',
    });
  }

  // #118 acceptance: Audit log (non-sensitive)
  console.log(`[registration-manage-update] Registration ${registration.id.slice(0, 8)} updated via management token`);

  // Invalidate bracket regeneration since the data changed.
  // Closes B4: the previous code did an unconditional
  //   bracket.deleteMany({ where: { division: { assignments: { some:
  //     { registrationId: thisRegistration.id } } } } })
  // which, because Bracket is 1:1 with Division, deleted the WHOLE
  // bracket for the division — wiping every other competitor's
  // match results when one parent fixed a typo. Now we delete
  // only the matches that involved the patching registration
  // (already done on the line above) and skip the bracket wipe
  // entirely. The next bracket regeneration will produce a fresh
  // structure that omits the changed registration.
  await prisma.divisionAssignment.deleteMany({ where: { registrationId: registration.id } });
  await prisma.match.deleteMany({ where: { OR: [{ competitor1Id: registration.id }, { competitor2Id: registration.id }] } });
  // NOTE: do not delete the bracket — see B4. The downstream
  // matches still reference the now-removed registration by
  // id, but the scorekeeper / match view shows them as TBD
  // until the director regenerates the bracket.

  res.json({ success: true, message: 'Registration updated. Your division assignment may change when brackets are regenerated.' });
});

// Withdraw a registration by confirmation code. Parents can do this
// when their kid is sick, has a schedule conflict, etc.
router.delete('/registrations/:token', manageUpdateLimiter, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const token = String(req.params.token || '');
  if (!isValidManagementToken(token)) return res.status(404).json({ error: 'No matching registration found.' });

  const registration = await prisma.registration.findFirst({
    where: {
      managementTokenHash: hashManagementToken(token),
    },
    include: { tournament: { select: { status: true } } },
  });

  if (!registration) {
    return res.status(404).json({ error: 'No matching registration found.' });
  }

  // #118 acceptance: Expiration + revocation check
  const statusCheck = validateManagementTokenStatus(
    registration.managementTokenExpiresAt,
    registration.managementTokenRevokedAt,
  );
  if (!statusCheck.valid) {
    return res.status(404).json({ error: 'No matching registration found.' });
  }

  if (registration.checkedIn) {
    return res.status(409).json({ error: 'Cannot withdraw a checked-in registration. Talk to the director at the venue.' });
  }
  if (['in_progress', 'completed'].includes(registration.tournament.status)) {
    return res.status(409).json({ error: 'Cannot withdraw once the tournament has started.' });
  }

  // Cascade-delete related rows before removing the registration.
  await prisma.$transaction(async (tx) => {
    await tx.divisionAssignment.deleteMany({ where: { registrationId: registration.id } });
    await tx.match.deleteMany({ where: { OR: [{ competitor1Id: registration.id }, { competitor2Id: registration.id }] } });
    await tx.registration.delete({ where: { id: registration.id } });
  });

  // #118 acceptance: Audit log (non-sensitive)
  console.log(`[registration-manage-withdraw] Registration ${registration.id.slice(0, 8)} withdrawn via management token`);

  // The withdrawal has committed; waitlist maintenance is best-effort and
  // must never turn a successful withdrawal into a 500. promoteNextWaitlisted
  // re-checks capacity under the tournament lock, promotes at most one
  // entry, and renumbers the remaining waitlist (also needed when the
  // withdrawn registration was itself waitlisted).
  if (registration.tournament.status === 'registration') {
    try {
      const { promotedRegistrationId } = await promoteNextWaitlisted(prisma, registration.tournamentId);
      if (promotedRegistrationId) {
        console.log(`[registration-manage-withdraw] Promoted waitlisted registration ${promotedRegistrationId.slice(0, 8)}`);
      }
    } catch (err) {
      console.error('[registration-manage-withdraw] waitlist promotion failed:', err);
    }
  }

  res.json({ success: true, message: 'Registration withdrawn.' });
});

// P2-14: Verify parental consent for minor registration
router.get('/verify-parent-consent', registrationLimiter, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { token } = req.query;

  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Verification token is required' });
  }

  const { verifyParentalConsent } = await import('../services/parental-consent-verification.js');
  const result = await verifyParentalConsent(prisma, token);

  if (!result.ok) {
    return res.status(400).json({ error: result.error });
  }

  res.json({
    success: true,
    message: 'Parental consent verified successfully!',
    registration: result.registration,
  });
});


function getAgeGroupLabel(age: number): string {
  if (age <= 5) return '4-5';
  if (age <= 7) return '6-7';
  if (age <= 9) return '8-9';
  if (age <= 11) return '10-11';
  if (age <= 14) return '12-14';
  if (age <= 17) return '15-17';
  if (age <= 35) return '18-35';
  return '36+';
}


// School portal — read-only data for /tournaments/:id/school and the
// SchoolPortal.tsx public page. Used by directors sharing a link with
// parents so they can see their school's brackets without needing to
// log in. Soft-delete aware (404s for soft-deleted tournaments with
// the same shape as "not found"). Rate-limited 30/min/IP to prevent
// scripted scrapes that enumerate schoolNames.
router.get(
  '/tournaments/:id/schools',
  schoolPortalLimiter,
  async (req: Request, res: Response) => {
    const prisma: PrismaClient = req.app.locals.prisma;
    const shareSlug = typeof req.query.slug === 'string' ? req.query.slug : '';

    const tournament = await prisma.tournament.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, deletedAt: true, publicSlug: true },
    });

    // Require the director-issued publicSlug so UUID-only links cannot
    // enumerate school rosters. Same 404 shape as "not found".
    if (
      !tournament ||
      tournament.deletedAt ||
      !tournament.publicSlug ||
      shareSlug !== tournament.publicSlug
    ) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const registrations = await prisma.registration.findMany({
      where: { tournamentId: req.params.id },
      select: { competitor: { select: { schoolDojang: true } } },
    });

    const schools = [
      ...new Set(
        registrations
          .map((r) => r.competitor.schoolDojang)
          .filter((s): s is string => !!s && s.trim().length > 0)
      ),
    ].sort((a, b) => a.localeCompare(b));

    res.json({ tournament: { id: tournament.id, name: tournament.name }, schools });
  }
);

router.get(
  '/tournaments/:id/school/:schoolName',
  schoolPortalLimiter,
  async (req: Request, res: Response) => {
    const prisma: PrismaClient = req.app.locals.prisma;
    const schoolName = decodeURIComponent(req.params.schoolName);
    const shareSlug = typeof req.query.slug === 'string' ? req.query.slug : '';

    const tournament = await prisma.tournament.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        name: true,
        date: true,
        location: true,
        status: true,
        sportProfileSlug: true,
        deletedAt: true,
        publicSlug: true,
      },
    });

    if (
      !tournament ||
      tournament.deletedAt ||
      !tournament.publicSlug ||
      shareSlug !== tournament.publicSlug
    ) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    // Push the school filter into Prisma so we don't fetch every
    // registration for the tournament only to drop most of them in
    // JS. The `competitor` `select` is intentionally narrow to avoid
    // leaking parent contact fields (parentName / parentEmail /
    // parentPhone) on this public endpoint.
    const registrations = await prisma.registration.findMany({
      where: {
        tournamentId: req.params.id,
        competitor: {
          schoolDojang: { equals: schoolName, mode: 'insensitive' },
        },
      },
      select: {
        id: true,
        ageAtTournament: true,
        patterns: true,
        sparring: true,
        checkedIn: true,
        checkInTime: true,
        competitor: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            belt: true,
            danRank: true,
            gender: true,
            schoolDojang: true,
          },
        },
        assignments: {
          select: {
            seedPosition: true,
            division: {
              select: {
                id: true,
                name: true,
                eventType: true,
                bracket: {
                  select: {
                    matches: {
                      select: {
                        id: true,
                        matchNumber: true,
                        roundNumber: true,
                        bracketType: true,
                        status: true,
                        score1: true,
                        score2: true,
                        winnerId: true,
                        ringNumber: true,
                        scheduledTime: true,
                        competitor1Id: true,
                        competitor2Id: true,
                        competitor1: {
                          select: {
                            id: true,
                            competitorId: true,
                            competitor: {
                              select: { firstName: true, lastName: true, schoolDojang: true },
                            },
                          },
                        },
                        competitor2: {
                          select: {
                            id: true,
                            competitorId: true,
                            competitor: {
                              select: { firstName: true, lastName: true, schoolDojang: true },
                            },
                          },
                        },
                      },
                      orderBy: { matchNumber: 'asc' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const schoolRegistrations = registrations;

    // Build competitor data
    const competitors = schoolRegistrations.map((reg) => {
    const divisions = reg.assignments.map((a) => ({
      id: a.division.id,
      name: a.division.name,
      eventType: a.division.eventType,
      seedPosition: a.seedPosition,
    }));

    // Gather all matches this competitor is in
    const allMatches: Array<{
      id: string;
      matchNumber: number;
      roundNumber: number;
      bracketType: string;
      status: string;
      score1: string | null;
      score2: string | null;
      winnerId: string | null;
      ringNumber: number | null;
      scheduledTime: Date | null;
      divisionId: string;
      divisionName: string;
      competitor1Name: string | null;
      competitor1School: string | null;
      competitor2Name: string | null;
      competitor2School: string | null;
      isCompetitor1: boolean;
    }> = [];

    for (const assignment of reg.assignments) {
      if (!assignment.division.bracket) continue;
      for (const match of assignment.division.bracket.matches) {
        if (match.competitor1Id === reg.id || match.competitor2Id === reg.id) {
          allMatches.push({
            id: match.id,
            matchNumber: match.matchNumber,
            roundNumber: match.roundNumber,
            bracketType: match.bracketType,
            status: match.status,
            score1: match.score1,
            score2: match.score2,
            winnerId: match.winnerId,
            ringNumber: match.ringNumber,
            scheduledTime: match.scheduledTime,
            divisionId: assignment.division.id,
            divisionName: assignment.division.name,
            competitor1Name: match.competitor1
              ? `${match.competitor1.competitor.firstName} ${match.competitor1.competitor.lastName}`
              : null,
            competitor1School: match.competitor1?.competitor.schoolDojang || null,
            competitor2Name: match.competitor2
              ? `${match.competitor2.competitor.firstName} ${match.competitor2.competitor.lastName}`
              : null,
            competitor2School: match.competitor2?.competitor.schoolDojang || null,
            isCompetitor1: match.competitor1Id === reg.id,
          });
        }
      }
    }

    // Determine placement per division
    const placements: Array<{ divisionId: string; divisionName: string; placement: number | null }> = [];
    for (const assignment of reg.assignments) {
      if (!assignment.division.bracket) {
        placements.push({ divisionId: assignment.division.id, divisionName: assignment.division.name, placement: null });
        continue;
      }
      const bracketMatches = assignment.division.bracket.matches;
      const allCompleted = bracketMatches.length > 0 && bracketMatches.every((m) => m.status === 'completed' || m.status === 'bye');

      if (!allCompleted) {
        placements.push({ divisionId: assignment.division.id, divisionName: assignment.division.name, placement: null });
        continue;
      }

      // Find the finals match (highest match number in winners bracket)
      const finalsMatch = bracketMatches
        .filter((m) => m.bracketType === 'finals' || m.bracketType === 'winners')
        .sort((a, b) => b.matchNumber - a.matchNumber)[0];

      if (finalsMatch && finalsMatch.winnerId === reg.id) {
        placements.push({ divisionId: assignment.division.id, divisionName: assignment.division.name, placement: 1 });
      } else if (finalsMatch && (finalsMatch.competitor1Id === reg.id || finalsMatch.competitor2Id === reg.id)) {
        placements.push({ divisionId: assignment.division.id, divisionName: assignment.division.name, placement: 2 });
      } else {
        // Check if they lost in a losers bracket final (3rd place)
        const losersFinal = bracketMatches
          .filter((m) => m.bracketType === 'losers')
          .sort((a, b) => b.matchNumber - a.matchNumber)[0];
        if (losersFinal && losersFinal.winnerId === reg.id) {
          placements.push({ divisionId: assignment.division.id, divisionName: assignment.division.name, placement: 3 });
        } else {
          placements.push({ divisionId: assignment.division.id, divisionName: assignment.division.name, placement: null });
        }
      }
    }

    // Find the next upcoming match
    const upcomingMatches = allMatches
      .filter((m) => m.status === 'ready' || m.status === 'in_progress')
      .sort((a, b) => a.matchNumber - b.matchNumber);

    return {
      id: reg.competitor.id,
      registrationId: reg.id,
      firstName: reg.competitor.firstName,
      lastName: reg.competitor.lastName,
      belt: reg.competitor.belt,
      danRank: reg.competitor.danRank,
      age: reg.ageAtTournament,
      gender: reg.competitor.gender,
      patterns: reg.patterns,
      sparring: reg.sparring,
      checkedIn: reg.checkedIn,
      checkInTime: reg.checkInTime,
      divisions,
      matches: allMatches,
      placements,
      nextMatch: upcomingMatches[0] || null,
    };
  });

  // Collect all upcoming matches for the school across all competitors
  const upcomingMatches: Array<{
    id: string;
    matchNumber: number;
    status: string;
    ringNumber: number | null;
    divisionName: string;
    competitorName: string;
    opponentName: string | null;
    opponentSchool: string | null;
  }> = [];
  const seenMatchIds = new Set<string>();

  for (const comp of competitors) {
    for (const match of comp.matches) {
      if (match.status !== 'ready' && match.status !== 'in_progress') continue;
      if (seenMatchIds.has(match.id)) continue;
      seenMatchIds.add(match.id);

      const opponentName = match.isCompetitor1 ? match.competitor2Name : match.competitor1Name;
      const opponentSchool = match.isCompetitor1 ? match.competitor2School : match.competitor1School;
      upcomingMatches.push({
        id: match.id,
        matchNumber: match.matchNumber,
        status: match.status,
        ringNumber: match.ringNumber,
        divisionName: match.divisionName,
        competitorName: `${comp.firstName} ${comp.lastName}`,
        opponentName,
        opponentSchool,
      });
    }
  }

  upcomingMatches.sort((a, b) => a.matchNumber - b.matchNumber);

  // Stats
  const totalCompetitors = competitors.length;
  const checkedIn = competitors.filter((c) => c.checkedIn).length;
  const competingNow = competitors.filter((c) =>
    c.matches.some((m) => m.status === 'in_progress')
  ).length;
  const medalsWon = competitors.reduce((count, c) => {
    return count + c.placements.filter((p) => p.placement !== null && p.placement <= 3).length;
  }, 0);

  res.json({
    tournament,
    schoolName,
    stats: { totalCompetitors, checkedIn, competingNow, medalsWon },
    competitors,
    upcomingMatches,
  });
});

// P2-2: Public checkout for entry-fee payments
// Create a Stripe Checkout session for a registration's entry fee.
// The registration must already exist (created by /api/public/register
// with paymentStatus = 'pending'). This endpoint returns a Checkout URL
// that redirects the parent to Stripe to complete payment.
//
// Authorization: the caller must present the registration's management
// token (the bearer secret returned once at registration and emailed to
// the parent). A registration UUID alone is not a secret — its first 8
// characters are the printed confirmation code and it appears in Stripe
// redirect URLs — so it is not accepted on its own.
router.post('/checkout', registrationLimiter, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { managementToken, registrationId } = (req.body ?? {}) as {
    managementToken?: unknown;
    registrationId?: unknown;
  };

  if (typeof managementToken !== 'string' || !isValidManagementToken(managementToken)) {
    return res.status(400).json({ error: 'managementToken is required' });
  }

  // Load the registration + tournament to check fee config
  const registration = await prisma.registration.findUnique({
    where: { managementTokenHash: hashManagementToken(managementToken) },
    select: {
      id: true,
      paymentStatus: true,
      paymentIntentId: true,
      managementTokenExpiresAt: true,
      managementTokenRevokedAt: true,
      tournament: { select: { id: true, name: true, settings: true, deletedAt: true } },
    },
  });

  // Same 404 for unknown token, expired/revoked token, a registrationId
  // that doesn't match the token, or a deleted tournament.
  if (
    !registration
    || registration.tournament.deletedAt
    || !validateManagementTokenStatus(registration.managementTokenExpiresAt, registration.managementTokenRevokedAt).valid
    || (registrationId !== undefined && registrationId !== registration.id)
  ) {
    return res.status(404).json({ error: 'Registration not found' });
  }

  if (registration.paymentStatus === 'paid') {
    return res.status(409).json({ error: 'This registration has already been paid' });
  }

  // Only pending/failed registrations can start a checkout. waived /
  // not_required (or any unknown state) must not be flipped back to
  // pending by an anonymous caller.
  const paymentStatus = registration.paymentStatus ?? 'not_required';
  if (!(CHECKOUT_ALLOWED_PAYMENT_STATUSES as readonly string[]).includes(paymentStatus)) {
    return res.status(409).json({ error: 'No payment is due for this registration' });
  }

  const tournamentFeeCents = parseTournamentFeeCents(registration.tournament.settings);
  if (tournamentFeeCents <= 0) {
    return res.status(400).json({ error: 'This tournament has no entry fee configured' });
  }

  // Check if Stripe is configured
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!stripeSecretKey) {
    // Graceful degradation: return a 503 with a clear message that
    // payment is temporarily unavailable (not a hard error — the
    // registration still exists, payment is just not collectible yet).
    return res.status(503).json({
      error: 'Payment processing is temporarily unavailable. Please contact the tournament organizer.',
    });
  }

  if (paymentStatus === 'failed') {
    // Audit trail for retries (no PII, no token).
    console.log(
      `[public/checkout] Retrying payment for registration ${registration.id.slice(0, 8)} after failed status`
      + (registration.paymentIntentId ? ` (previous session ${registration.paymentIntentId})` : ''),
    );
  }

  // Create Stripe checkout session
  const Stripe = (await import('stripe')).default;
  const stripe = new Stripe(stripeSecretKey);

  const publicUrl = process.env.PUBLIC_APP_URL || 'http://localhost:5173';
  const successUrl = `${publicUrl}/register?payment=success&registration=${registration.id}`;
  const cancelUrl = `${publicUrl}/register?payment=cancelled&registration=${registration.id}`;

  // A pending registration may already have an open Checkout session
  // (e.g. the parent clicked "Pay" twice). Expire it so only the new
  // session can be paid. Best-effort: an already completed/expired
  // session errors and is ignored; a completed one is still honoured
  // by the webhook.
  if (registration.paymentIntentId) {
    await expireCheckoutSessionBestEffort(stripe, registration.paymentIntentId);
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: entryFeeLineItems(registration.tournament.name, tournamentFeeCents),
    metadata: {
      registrationId: registration.id,
      tournamentId: registration.tournament.id,
      type: 'entry_fee',
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  // Record the session id + expected amount; the webhook only marks the
  // registration paid when both match.
  await prisma.registration.update({
    where: { id: registration.id },
    data: {
      paymentStatus: 'pending',
      paymentIntentId: session.id,
      paymentAmountCents: tournamentFeeCents,
    },
  });

  return res.status(201).json({ url: session.url });
});

export default router;

