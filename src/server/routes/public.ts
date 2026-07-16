// Public registration routes - no authentication required
import { Router } from 'express';
import type { Request, Response } from 'express-serve-static-core';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { calculateAge } from '../../shared/constants/age-groups.js';
import { normalizeBelt } from '../../shared/constants/belts.js';
import { sendEmail, isEmailConfigured } from '../services/email.js';
import { escapeHtml } from '../services/email-templates.js';

const router = Router();

// In dev/test, set RATE_LIMIT_DISABLED=1 to bypass rate limiters entirely.
// (Mirrors the same flag used in routes/auth.ts — keeps the e2e suite
// fast and lets the dev server absorb self-imposed traffic without
// hitting the cap.)
const rateLimitDisabled = process.env.RATE_LIMIT_DISABLED === '1';

// Rate limit public registration to prevent abuse: 10 submissions per 15 minutes per IP
const registrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many registration attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => rateLimitDisabled,
});

// School portal share-link reads can dump a school's full roster and
// match history, but they're public-by-design so parents don't need to
// log in. Limit to 30 per minute per IP — the SchoolPortal.tsx page
// polls every 15s when a school is selected (4 polls/minute per
// browser) so this leaves headroom for a handful of concurrent viewers
// while blocking scripted scrapes that enumerate schoolNames.
const schoolPortalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => rateLimitDisabled,
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
    },
    select: {
      id: true,
      name: true,
      date: true,
      location: true,
      sportProfileSlug: true,
      // Settings carries registrationFee (free-text), which the public
      // register page surfaces next to the tournament name. Don't expose
      // anything else from settings — most of it is director-only.
      settings: true,
      _count: {
        select: { registrations: true },
      },
    },
    orderBy: { date: 'asc' },
  });

  res.json(tournaments);
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
      settings: true,
      sportProfileSlug: true,
    },
  });

  if (!tournament) {
    return res.status(404).json({ error: 'Tournament not found' });
  }

  // Previously gated to status === 'registration' which broke the public
  // scoreboard during in_progress / brackets / completed events. The scoreboard
  // needs the tournament name + date to render its header, and that's not
  // sensitive. Status is exposed so the client can show "Registration closed"
  // on its own if it wants — the server no longer hard-blocks.
  res.json(tournament);
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
  } = req.body;

  // Validation
  const errors: string[] = [];

  if (!tournamentId) errors.push('Tournament is required');
  if (!firstName?.trim()) errors.push('First name is required');
  if (!lastName?.trim()) errors.push('Last name is required');
  if (!gender || !['M', 'F'].includes(gender)) errors.push('Gender is required (M or F)');
  if (!dateOfBirth) errors.push('Date of birth is required');
  if (!belt?.trim()) errors.push('Belt level is required');
  if (!patterns && !sparring) errors.push('Please select at least one event (Patterns or Sparring)');

  if (sparring && !weightLbs) {
    errors.push('Weight is required for sparring registration');
  }

  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  try {
    // Check tournament is open for registration
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
    });

    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    if (tournament.status !== 'registration') {
      return res.status(400).json({ error: 'Tournament is not open for registration' });
    }

    // Normalize belt
    const normalizedBelt = normalizeBelt(belt);

    // Calculate age at tournament
    const dob = new Date(dateOfBirth);
    const ageAtTournament = calculateAge(dob, tournament.date);

    if (ageAtTournament < 4) {
      return res.status(400).json({ error: 'Competitors must be at least 4 years old' });
    }

    // Check for existing competitor by name + DOB.
    // Closes B7: the previous query was case-sensitive, so a parent
    // re-registering as "MINHO KIM" after registering as "Minho Kim"
    // created a new competitor row. The auto-categorization engine
    // then put the same person in two divisions.
    let competitor = await prisma.competitor.findFirst({
      where: {
        firstName: { equals: firstName.trim(), mode: 'insensitive' },
        lastName: { equals: lastName.trim(), mode: 'insensitive' },
        dateOfBirth: dob,
      },
    });

    if (competitor) {
      // Existing competitor found - use their existing data, don't overwrite
    } else {
      // Create new competitor
      competitor = await prisma.competitor.create({
        data: {
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
      });
    }

    // Check for existing registration
    const existingRegistration = await prisma.registration.findUnique({
      where: {
        tournamentId_competitorId: {
          tournamentId,
          competitorId: competitor.id,
        },
      },
    });

    if (existingRegistration) {
      return res.status(409).json({
        error: 'Already registered',
        message: `${firstName} ${lastName} is already registered for this tournament`,
      });
    }

    // Create registration
    const registration = await prisma.registration.create({
      data: {
        tournamentId,
        competitorId: competitor.id,
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
      },
      include: {
        competitor: true,
        tournament: {
          select: { name: true, date: true, location: true },
        },
      },
    });

    const responseData = {
      success: true,
      message: 'Registration successful!',
      registration: {
        id: registration.id,
        // First 8 chars of the UUID. The /api/public/check-registration
        // endpoint uses the same field for parent lookups — "did my
        // registration go through?" The parent should see this number
        // on the success screen AND in the confirmation email so they
        // can match the two if needed.
        confirmationCode: registration.id.slice(0, 8),
        competitorName: `${competitor.firstName} ${competitor.lastName}`,
        tournamentName: registration.tournament.name,
        tournamentDate: registration.tournament.date,
        events: {
          patterns: registration.patterns,
          sparring: registration.sparring,
        },
        ageGroup: getAgeGroupLabel(ageAtTournament),
      },
    };

    res.status(201).json(responseData);

    // Send confirmation email if parent email is provided and email is configured
    if (parentEmail && isEmailConfigured()) {
      const eventList = [
        patterns && 'Patterns',
        sparring && 'Sparring',
      ].filter(Boolean).join(' & ');
      const tournamentDate = new Date(registration.tournament.date).toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      });
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #4F46E5;">Registration Confirmed!</h2>
          <p>Hello${parentName ? ` ${escapeHtml(parentName)}` : ''},</p>
          <p><strong>${escapeHtml(competitor.firstName)} ${escapeHtml(competitor.lastName)}</strong> has been successfully registered for:</p>
          <div style="background: #F3F4F6; border-radius: 8px; padding: 16px; margin: 16px 0;">
            <p style="margin: 4px 0;"><strong>Tournament:</strong> ${escapeHtml(registration.tournament.name)}</p>
            <p style="margin: 4px 0;"><strong>Date:</strong> ${escapeHtml(tournamentDate)}</p>
            ${registration.tournament.location ? `<p style="margin: 4px 0;"><strong>Location:</strong> ${escapeHtml(registration.tournament.location)}</p>` : ''}
            <p style="margin: 4px 0;"><strong>Events:</strong> ${escapeHtml(eventList)}</p>
            <p style="margin: 4px 0;"><strong>Age Group:</strong> ${escapeHtml(getAgeGroupLabel(ageAtTournament))}</p>
          </div>
          <p style="color: #6B7280; font-size: 14px;">Please keep this email for your records. You may be asked to provide registration confirmation at check-in.</p>
        </div>
      `;
      sendEmail(parentEmail, `Registration Confirmed - ${escapeHtml(registration.tournament.name)}`, html).catch(() => {});
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
const scoreboardLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,             // 30 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => rateLimitDisabled,
});

router.get('/scoreboard/:publicSlug', scoreboardLimiter, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { publicSlug } = req.params;

  const tournament = await prisma.tournament.findUnique({
    where: { publicSlug },
  });

  if (!tournament) {
    // Identical response for "no such slug" and "no such tournament" so
    // an attacker can't tell whether a slug exists.
    return res.status(404).json({ error: 'Scoreboard not found' });
  }

  const divisions = await prisma.division.findMany({
    where: {
      tournamentId: tournament.id,
      // Only show divisions whose bracket is actually published —
      // prevents leaking competitor lists of in-progress brackets.
    },
    include: {
      bracket: {
        include: {
          matches: {
            include: {
              competitor1: {
                include: {
                  competitor: {
                    select: { firstName: true, lastName: true, schoolDojang: true },
                  },
                },
              },
              competitor2: {
                include: {
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
    orderBy: { displayOrder: 'asc' },
  });

  res.json(divisions);
});

// Back-compat shim: the OLD public scoreboard route was
// /api/public/tournaments/:id/scoreboard (UUID-based, unauthenticated).
// The client (PublicScoreboard.tsx) still calls that path. Rather than
// rewiring the client AND adding a "Get share link" UI in
// TournamentSettings to make the new slug-based route useful, we
// resolve the old UUID to the tournament, look up or lazily-generate
// the publicSlug, and internally call the new handler. This keeps
// the public scoreboard working without code changes to the client
// and without exposing all tournaments to anonymous enumeration
// (the slug is generated on first access, the ID-to-slug mapping
// is not exposed).
//
// If a future migration moves the client to slug-based URLs, this
// shim can be deleted. The new slug-based route is the canonical
// API.
router.get('/tournaments/:id/scoreboard', scoreboardLimiter, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const id = req.params.id;

  const tournament = await prisma.tournament.findUnique({
    where: { id },
  });
  if (!tournament) {
    return res.status(404).json({ error: 'Tournament not found' });
  }

  // Lazily generate the publicSlug if missing. Same entropy as the
  // director-triggered path (see POST /api/tournaments/:id/public-slug).
  let slug = tournament.publicSlug;
  if (!slug) {
    slug = crypto.randomBytes(10).toString('base64url').slice(0, 16);
    await prisma.tournament.update({
      where: { id },
      data: { publicSlug: slug },
    });
  }

  // Director-controlled display mode + featured match override (M8).
  // The director can pin the venue TV to a specific match (e.g. the
  // finals) or filter to a single ring. Settings live in the
  // tournament.settings JSON string under `display`.
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

  // Reuse the slug-handler's logic by setting the param and recursing.
  // (Express doesn't have a clean way to forward a request to another
  // handler in the same router, so we just call the underlying query
  // directly here — duplicates a few lines but keeps the routes
  // independent.)
  const divisions = await prisma.division.findMany({
    where: { tournamentId: id },
    include: {
      bracket: {
        include: {
          matches: {
            include: {
              competitor1: {
                include: {
                  competitor: {
                    select: { firstName: true, lastName: true, schoolDojang: true },
                  },
                },
              },
              competitor2: {
                include: {
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
    orderBy: { displayOrder: 'asc' },
  });

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
const checkRegistrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                  // 20 lookups per 15 min per IP
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => rateLimitDisabled,
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
const manageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many lookups. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => rateLimitDisabled,
});

router.get('/registrations/:code', manageLimiter, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const code = String(req.params.code || '').slice(0, 8);
  const lastName = String(req.query.lastName || '').trim();
  const dob = String(req.query.dateOfBirth || '');

  if (code.length < 6 || !lastName || !dob) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  // Match by registration.id prefix (first 8 chars)
  const registration = await prisma.registration.findFirst({
    where: {
      id: { startsWith: code },
      competitor: { lastName, dateOfBirth: new Date(dob) },
    },
    include: {
      competitor: true,
      tournament: { select: { id: true, name: true, date: true, status: true } },
    },
  });

  if (!registration) {
    return res.status(404).json({ error: 'No matching registration found.' });
  }

  res.json({
    registration: {
      confirmationCode: registration.id.slice(0, 8),
      firstName: registration.competitor.firstName,
      lastName: registration.competitor.lastName,
      dateOfBirth: registration.competitor.dateOfBirth,
      gender: registration.competitor.gender,
      belt: registration.competitor.belt,
      weight: registration.weightAtRegistration,
      school: registration.competitor.schoolDojang,
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

const manageUpdateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many updates. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => rateLimitDisabled,
});

// Update a registration by confirmation code. Parents can fix typos,
// change belts, toggle which events they're entered in. Director-side
// changes go through /api/tournaments/:id/registrations/:id.
router.patch('/registrations/:code', manageUpdateLimiter, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const code = String(req.params.code || '').slice(0, 8);
  const lastName = String(req.body?.lastName || '').trim();
  const dob = String(req.body?.dateOfBirth || '');

  if (code.length < 6 || !lastName || !dob) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  const registration = await prisma.registration.findFirst({
    where: {
      id: { startsWith: code },
      competitor: { lastName, dateOfBirth: new Date(dob) },
    },
    include: { tournament: { select: { status: true, date: true } } },
  });

  if (!registration) {
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

  // Build the patch object. Only allow fields the parent can change.
  const data: Record<string, unknown> = {};

  if (req.body?.firstName !== undefined) {
    const v = String(req.body.firstName).trim();
    if (!v) return res.status(400).json({ error: 'First name cannot be empty.' });
    data.firstName = v;
  }
  if (req.body?.gender !== undefined) {
    data.gender = String(req.body.gender).trim();
  }
  if (req.body?.belt !== undefined) {
    data.belt = String(req.body.belt).trim();
  }
  if (req.body?.school !== undefined) {
    data.schoolDojang = String(req.body.school).trim() || null;
  }
  if (req.body?.specialNeeds !== undefined) {
    data.specialNeeds = String(req.body.specialNeeds).trim() || null;
  }
  if (req.body?.competeWithOlder !== undefined) {
    data.competeWithOlder = !!req.body.competeWithOlder;
  }

  // Registration-level changes
  const regData: Record<string, unknown> = {};
  if (req.body?.patterns !== undefined) regData.patterns = !!req.body.patterns;
  if (req.body?.sparring !== undefined) regData.sparring = !!req.body.sparring;
  if (req.body?.weight !== undefined) {
    const w = parseFloat(String(req.body.weight));
    if (!isNaN(w) && w > 0) regData.weightAtRegistration = w;
  }

  if (Object.keys(data).length === 0 && Object.keys(regData).length === 0) {
    return res.status(400).json({ error: 'No editable fields supplied.' });
  }

  // Use a transaction so competitor + registration stay consistent.
  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) {
      await tx.competitor.update({ where: { id: registration.competitorId }, data });
    }
    if (Object.keys(regData).length > 0) {
      await tx.registration.update({ where: { id: registration.id }, data: regData });
    }
  });

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
router.delete('/registrations/:code', manageUpdateLimiter, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const code = String(req.params.code || '').slice(0, 8);
  const lastName = String(req.body?.lastName || '').trim();
  const dob = String(req.body?.dateOfBirth || '');

  if (code.length < 6 || !lastName || !dob) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  const registration = await prisma.registration.findFirst({
    where: {
      id: { startsWith: code },
      competitor: { lastName, dateOfBirth: new Date(dob) },
    },
    include: { tournament: { select: { status: true } } },
  });

  if (!registration) {
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

  res.json({ success: true, message: 'Registration withdrawn.' });
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

    const tournament = await prisma.tournament.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, deletedAt: true },
    });

    if (!tournament || tournament.deletedAt) {
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

    const tournament = await prisma.tournament.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, date: true, location: true, status: true, sportProfileSlug: true, deletedAt: true },
    });

    if (!tournament || tournament.deletedAt) {
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



export default router;

