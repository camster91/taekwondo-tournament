/**
 * Public portal routes for tenant-branded event discovery.
 * No authentication required — organizers share these URLs with competitors/parents.
 * 
 * Routing:
 *   GET  /api/public/portal/:orgSlug              - List org's published events
 *   GET  /api/public/portal/:orgSlug/:eventSlug   - Event portal landing (register, schedule, results)
 */

import { Router } from 'express';
import type { Request, Response } from 'express-serve-static-core';
import { PrismaClient } from '@prisma/client';
import rateLimit from 'express-rate-limit';
import { calculateAge } from '../../shared/constants/age-groups.js';
import { normalizeBelt } from '../../shared/constants/belts.js';
import {
  buildRegistrationPatch,
  buildRegistrationConsent,
  registrationLegalConfigFromEnv,
  type RegistrationConsentResult,
} from './public-validation.js';
import { sendEmail, isEmailConfigured } from '../services/email.js';
import {
  createPublicRegistration,
  entryFeeLineItems,
  parseTournamentFeeCents,
  publicRegistrationErrorResponse,
  type CreatePublicRegistrationResult,
} from '../services/public-registration.js';

const router = Router();

const legalConfig = () => registrationLegalConfigFromEnv(
  process.env,
  process.env.NODE_ENV === 'production',
);

// Rate limit portal routes to prevent enumeration attacks and scraping
const portalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,             // 60 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.RATE_LIMIT_DISABLED === '1' && process.env.NODE_ENV !== 'production',
});

// Stricter rate limit for registration submissions (same as public.ts registrationLimiter)
const registrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                  // 10 submissions per 15 min per IP
  message: { error: 'Too many registration attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.RATE_LIMIT_DISABLED === '1' && process.env.NODE_ENV !== 'production',
});

/**
 * GET /api/public/portal/:orgSlug
 * 
 * List published events for an organization.
 * Returns only portalPublished=true && status='registration' events.
 * Fail-closed: wrong org slug returns empty list, not 404 (prevents enumeration).
 */
router.get('/:orgSlug', portalLimiter, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { orgSlug } = req.params;

  // Validate orgSlug format
  if (!orgSlug || !/^[a-z0-9-]{3,63}$/.test(orgSlug)) {
    // Fail closed: wrong format gets empty list, not an error that leaks existence
    return res.json({ organization: null, events: [] });
  }

  // Find organization by slug
  const organization = await prisma.organization.findUnique({
    where: { slug: orgSlug },
    select: {
      id: true,
      name: true,
      slug: true,
      brandName: true,
      brandPrimaryColor: true,
      brandLogoUrl: true,
    },
  });

  if (!organization) {
    // Fail closed: wrong org slug gets empty list, not 404
    return res.json({ organization: null, events: [] });
  }

  // Fetch published events for this org
  const events = await prisma.tournament.findMany({
    where: {
      organizationId: organization.id,
      portalPublished: true,
      deletedAt: null,
      date: {
        gte: new Date(), // Only future/current events
      },
    },
    select: {
      id: true,
      name: true,
      eventSlug: true,
      date: true,
      location: true,
      status: true,
      brandName: true,
      brandPrimaryColor: true,
      brandLogoUrl: true,
      sportProfileSlug: true,
      _count: {
        select: { registrations: true },
      },
    },
    orderBy: { date: 'asc' },
  });

  res.json({
    organization: {
      name: organization.brandName || organization.name,
      slug: organization.slug,
      brandPrimaryColor: organization.brandPrimaryColor || '#DC2626',
      brandLogoUrl: organization.brandLogoUrl || null,
    },
    events: events.map((e) => ({
      id: e.id,
      slug: e.eventSlug,
      name: e.name,
      date: e.date,
      location: e.location,
      status: e.status,
      registrationCount: e._count.registrations,
      // Event-level branding overrides org branding
      brandName: e.brandName || organization.brandName || e.name,
      brandPrimaryColor: e.brandPrimaryColor || organization.brandPrimaryColor || '#DC2626',
      brandLogoUrl: e.brandLogoUrl || organization.brandLogoUrl || null,
    })),
  });
});

/**
 * GET /api/public/portal/:orgSlug/:eventSlug
 * 
 * Event portal landing page data.
 * Returns event details + org context for branded display.
 * Fail-closed: wrong slug returns 404 (indistinguishable from "not found").
 */
router.get('/:orgSlug/:eventSlug', portalLimiter, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { orgSlug, eventSlug } = req.params;

  // Validate slug formats
  if (!orgSlug || !/^[a-z0-9-]{3,63}$/.test(orgSlug)) {
    return res.status(404).json({ error: 'Event not found' });
  }
  if (!eventSlug || !/^[a-z0-9-]{3,63}$/.test(eventSlug)) {
    return res.status(404).json({ error: 'Event not found' });
  }

  // Find organization + event in one query
  const organization = await prisma.organization.findUnique({
    where: { slug: orgSlug },
    select: {
      id: true,
      name: true,
      slug: true,
      brandName: true,
      brandPrimaryColor: true,
      brandLogoUrl: true,
      tournaments: {
        where: {
          eventSlug,
          portalPublished: true,
          deletedAt: null,
        },
        select: {
          id: true,
          name: true,
          eventSlug: true,
          date: true,
          location: true,
          status: true,
          brandName: true,
          brandPrimaryColor: true,
          brandLogoUrl: true,
          sportProfileSlug: true,
          portalPublishedAt: true,
          publicSlug: true, // For scoreboard link
          settings: true,    // For registration fee parsing
          _count: {
            select: { registrations: true },
          },
        },
        take: 1,
      },
    },
  });

  if (!organization || organization.tournaments.length === 0) {
    // Fail closed: wrong slug returns 404, same shape as "not found"
    return res.status(404).json({ error: 'Event not found' });
  }

  const event = organization.tournaments[0];

  // Parse registration fee from settings (same logic as public.ts)
  let registrationFee: string | null = null;
  let tournamentFeeCents = 0; // P2.4: Expose fee amount for Stripe checkout UI
  try {
    if (event.settings) {
      const parsed = JSON.parse(event.settings) as Record<string, unknown>;
      const fee = parsed.registrationFee;
      if (typeof fee === 'string' && fee.trim()) {
        registrationFee = fee;
      }
      const feeCents = parsed.tournamentFeeCents;
      if (typeof feeCents === 'number' && feeCents > 0) {
        tournamentFeeCents = feeCents;
      }
    }
  } catch {
    // Ignore parse errors
  }

  res.json({
    organization: {
      name: organization.brandName || organization.name,
      slug: organization.slug,
      brandPrimaryColor: organization.brandPrimaryColor || '#DC2626',
      brandLogoUrl: organization.brandLogoUrl || null,
    },
    event: {
      id: event.id,
      slug: event.eventSlug,
      name: event.name,
      date: event.date,
      location: event.location,
      status: event.status,
      sportProfileSlug: event.sportProfileSlug, // P1.2: Required for PublicRegister sport-specific logic
      registrationCount: event._count.registrations,
      registrationFee,
      tournamentFeeCents, // P2.4: For Stripe checkout UI
      publicScoreboardSlug: event.publicSlug, // For linking to scoreboard
      // Event-level branding overrides org branding
      brandName: event.brandName || organization.brandName || event.name,
      brandPrimaryColor: event.brandPrimaryColor || organization.brandPrimaryColor || '#DC2626',
      brandLogoUrl: event.brandLogoUrl || organization.brandLogoUrl || null,
      portalUrl: `/events/${orgSlug}/${eventSlug}`,
      registerUrl: `/register/${event.id}`,
      scoreboardUrl: event.publicSlug ? `/scoreboard/${event.publicSlug}` : null,
    },
  });
});

/**
 * POST /api/public/portal/:orgSlug/:eventSlug/register
 * 
 * Portal-scoped registration endpoint (#213).
 * Validates that the event belongs to the specified organization before allowing registration.
 * 
 * Security:
 * - Fail-closed: wrong slugs return 404 (not 403, prevents enumeration)
 * - Tenant-isolated: cannot register for org B's event through org A's portal
 * - Rate-limited: 10 submissions per 15min per IP
 * 
 * Returns same response format as /api/public/register for consistency.
 */
router.post('/:orgSlug/:eventSlug/register', registrationLimiter, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { orgSlug, eventSlug } = req.params;

  // Validate slug formats
  if (!orgSlug || !/^[a-z0-9-]{3,63}$/.test(orgSlug)) {
    return res.status(404).json({ error: 'Event not found' });
  }
  if (!eventSlug || !/^[a-z0-9-]{3,63}$/.test(eventSlug)) {
    return res.status(404).json({ error: 'Event not found' });
  }

  // Find organization + event (tenant-scoped lookup)
  const organization = await prisma.organization.findUnique({
    where: { slug: orgSlug },
    select: {
      id: true,
      plan: true,
      brandName: true, // P2.6: For email branding
      name: true, // P2.6: Fallback for email branding
      tournaments: {
        where: {
          eventSlug,
          portalPublished: true,
          deletedAt: null,
        },
        select: {
          id: true,
          name: true,
          date: true,
          location: true,
          status: true,
          settings: true,
          brandName: true,
          organizationId: true,
        },
        take: 1,
      },
    },
  });

  if (!organization || organization.tournaments.length === 0) {
    // Fail closed: wrong slug or unpublished event returns 404
    return res.status(404).json({ error: 'Event not found' });
  }

  const tournament = organization.tournaments[0];

  // Security: double-check that the tournament belongs to this org
  if (tournament.organizationId !== organization.id) {
    // This should never happen (the query already filters by org), but
    // defense-in-depth: if somehow a cross-tenant event leaked through,
    // fail closed with the same 404.
    return res.status(404).json({ error: 'Event not found' });
  }

  if (tournament.status !== 'registration') {
    return res.status(400).json({ error: 'Registration is not open for this event' });
  }

  // Parse registration body (same validation as public.ts /register)
  const {
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

  // Validation (same logic as public.ts)
  const errors: string[] = [];
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
    // The plan limit is enforced inside createPublicRegistration under the
    // tournament row lock (a pre-check here would race).
    const plan = organization.plan ?? 'free';

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

    // Parse tournament fee settings
    const tournamentFeeCents = parseTournamentFeeCents(tournament.settings);
    const feeRequired = tournamentFeeCents > 0;

    // Competitor lookup/creation (same-organization re-use only), plan
    // limit, capacity/waitlist and the insert run in one transaction
    // under a tournament row lock. See services/public-registration.ts.
    let created: CreatePublicRegistrationResult;
    try {
      created = await createPublicRegistration(prisma, {
        tournamentId: tournament.id,
        organizationId: organization.id,
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
          competeWithOlder: competeWithOlder === true,
          specialNeeds: specialNeeds?.trim() || null,
          paymentStatus: feeRequired ? 'pending' : 'not_required',
          paymentAmountCents: feeRequired ? tournamentFeeCents : null,
          ...consent.data,
        },
      });
    } catch (error) {
      const handled = publicRegistrationErrorResponse(error, `${firstName} ${lastName}`, 'event');
      if (handled) return res.status(handled.status).json(handled.body);
      throw error;
    }

    const { managementToken, competitor } = created;
    const registration = {
      ...created.registration,
      tournament: { name: tournament.name, date: tournament.date, location: tournament.location },
    };

    // Generate checkout URL if payment is required
    let checkoutUrl: string | undefined;
    if (feeRequired && registration.paymentStatus === 'pending') {
      const stripeSecretKey = process.env.STRIPE_SECRET_KEY?.trim();
      if (stripeSecretKey) {
        try {
          const Stripe = (await import('stripe')).default;
          const stripe = new Stripe(stripeSecretKey);

          const publicUrl = process.env.PUBLIC_APP_URL || 'http://localhost:5173';
          // P1.3: Return to PublicRegister with portal context so success handling can show confirmation + management token
          const successUrl = `${publicUrl}/register?portal=${orgSlug}/${eventSlug}&payment=success&registration=${registration.id}`;
          const cancelUrl = `${publicUrl}/register?portal=${orgSlug}/${eventSlug}&payment=cancelled&registration=${registration.id}`;

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

          await prisma.registration.update({
            where: { id: registration.id },
            data: { paymentIntentId: session.id },
          });

          checkoutUrl = session.url ?? undefined;
        } catch (error) {
          console.error('[portal/register] Failed to create checkout session:', error);
        }
      }
    }

    const responseData = {
      success: true,
      message: registration.waitlistStatus === 'waitlisted' 
        ? 'Added to waitlist! You will be notified if a spot opens up.'
        : feeRequired && checkoutUrl
          ? 'Registration created! Please complete payment to finalize.'
          : 'Registration successful!',
      registration: {
        id: registration.id,
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
      
      // P2.6: Use org brand/name, never UUID
      const organizerBrandName = tournament.brandName || organization.brandName || organization.name || tournament.name;
      const managementUrl = `${process.env.PUBLIC_APP_URL || ''}/manage-registration?token=${encodeURIComponent(managementToken)}`;
      
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
          tournamentName: tournament.name,
          tournamentDate: tournament.date,
          verificationUrl,
          code: verificationCode,
          organizerBrandName,
        });
        
        sendEmail(parentEmail, subject, html).catch((err) => {
          console.error('[portal/register] parental consent verification email failed:', err);
        });
      } else {
        if (registration.waitlistStatus === 'waitlisted') {
          const { waitlistNotificationEmail } = await import('../services/email-templates.js');
          const { subject, html } = waitlistNotificationEmail({
            competitorName: `${competitor.firstName} ${competitor.lastName}`,
            tournamentName: tournament.name,
            tournamentDate: tournament.date,
            waitlistPosition: registration.waitlistPosition!,
            managementUrl,
            organizerBrandName,
          });
          sendEmail(parentEmail, subject, html).catch((err) => {
            console.error('[portal/register] waitlist email failed:', err);
          });
        } else {
          const { registrationConfirmationEmail } = await import('../services/email-templates.js');
          const { subject, html } = registrationConfirmationEmail({
            competitorName: `${competitor.firstName} ${competitor.lastName}`,
            tournamentName: tournament.name,
            tournamentDate: tournament.date,
            tournamentLocation: tournament.location,
            events: eventList,
            ageGroup: getAgeGroupLabel(ageAtTournament),
            parentName,
            confirmationCode: registration.id.slice(0, 8),
            managementUrl,
            organizerBrandName,
          });
          sendEmail(parentEmail, subject, html).catch((err) => {
            console.error('[portal/register] confirmation email failed:', err);
          });
        }
      }
    }
  } catch (error) {
    console.error('[portal/register] Registration error:', error);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
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

export default router;
