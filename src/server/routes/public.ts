// Public registration routes - no authentication required
import { Router } from 'express';
import type { Request, Response } from 'express-serve-static-core';
import { PrismaClient } from '@prisma/client';
import rateLimit from 'express-rate-limit';
import { calculateAge } from '../../shared/constants/age-groups.js';
import { normalizeBelt } from '../../shared/constants/belts.js';
import { sendEmail, isEmailConfigured } from '../services/email.js';

const router = Router();

// Rate limit public registration to prevent abuse: 10 submissions per 15 minutes per IP
const registrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many registration attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
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

  const tournament = await prisma.tournament.findUnique({
    where: { id: req.params.id },
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

  if (tournament.status !== 'registration') {
    return res.status(400).json({ error: 'Tournament is not open for registration' });
  }

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

    // Check for existing competitor by name + DOB
    let competitor = await prisma.competitor.findFirst({
      where: {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
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
          <p>Hello${parentName ? ` ${parentName}` : ''},</p>
          <p><strong>${competitor.firstName} ${competitor.lastName}</strong> has been successfully registered for:</p>
          <div style="background: #F3F4F6; border-radius: 8px; padding: 16px; margin: 16px 0;">
            <p style="margin: 4px 0;"><strong>Tournament:</strong> ${registration.tournament.name}</p>
            <p style="margin: 4px 0;"><strong>Date:</strong> ${tournamentDate}</p>
            ${registration.tournament.location ? `<p style="margin: 4px 0;"><strong>Location:</strong> ${registration.tournament.location}</p>` : ''}
            <p style="margin: 4px 0;"><strong>Events:</strong> ${eventList}</p>
            <p style="margin: 4px 0;"><strong>Age Group:</strong> ${getAgeGroupLabel(ageAtTournament)}</p>
          </div>
          <p style="color: #6B7280; font-size: 14px;">Please keep this email for your records. You may be asked to provide registration confirmation at check-in.</p>
        </div>
      `;
      sendEmail(parentEmail, `Registration Confirmed - ${registration.tournament.name}`, html).catch(() => {});
    }
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// Public scoreboard data (no auth required)
router.get('/tournaments/:id/scoreboard', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  const tournament = await prisma.tournament.findUnique({
    where: { id: req.params.id },
  });

  if (!tournament) {
    return res.status(404).json({ error: 'Tournament not found' });
  }

  const divisions = await prisma.division.findMany({
    where: { tournamentId: req.params.id },
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

// Check existing registration
router.get('/check-registration', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  const { tournamentId, firstName, lastName, dateOfBirth } = req.query;

  if (!tournamentId || !firstName || !lastName || !dateOfBirth) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  const competitor = await prisma.competitor.findFirst({
    where: {
      firstName: String(firstName).trim(),
      lastName: String(lastName).trim(),
      dateOfBirth: new Date(String(dateOfBirth)),
    },
    include: {
      registrations: {
        where: { tournamentId: String(tournamentId) },
        include: {
          tournament: {
            select: { name: true, date: true },
          },
        },
      },
    },
  });

  if (!competitor) {
    return res.json({ registered: false, competitor: null });
  }

  const registration = competitor.registrations[0];

  res.json({
    registered: !!registration,
    competitor: {
      id: competitor.id,
      firstName: competitor.firstName,
      lastName: competitor.lastName,
      belt: competitor.belt,
      schoolDojang: competitor.schoolDojang,
    },
    registration: registration
      ? {
          id: registration.id,
          patterns: registration.patterns,
          sparring: registration.sparring,
        }
      : null,
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

export default router;
