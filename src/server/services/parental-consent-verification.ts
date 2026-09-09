// P2-14: COPPA parental consent verification service
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const VERIFICATION_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours

/**
 * Generate a cryptographically secure 32-byte hex token for parental consent verification.
 */
export function generateVerificationToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate a 6-digit numeric code for SMS or manual entry fallback.
 */
export function generateVerificationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Create a parental consent verification record and return the token + code.
 * The verification link will be /verify-parent-consent?token=...
 */
export async function createParentalConsentVerification(
  prisma: PrismaClient,
  registrationId: string,
  parentEmail: string,
): Promise<{ token: string; code: string }> {
  const token = generateVerificationToken();
  const code = generateVerificationCode();
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);

  await prisma.parentalConsentVerification.create({
    data: {
      registrationId,
      parentEmail,
      token,
      code,
      expiresAt,
    },
  });

  return { token, code };
}

/**
 * Verify a parental consent token and mark the registration as verified.
 * Returns the registration if successful, null if token is invalid/expired.
 */
export async function verifyParentalConsent(
  prisma: PrismaClient,
  token: string,
): Promise<{ ok: true; registration: { id: string; competitorName: string; tournamentName: string } } | { ok: false; error: string }> {
  const verification = await prisma.parentalConsentVerification.findUnique({
    where: { token },
    include: {
      registration: {
        include: {
          competitor: { select: { firstName: true, lastName: true } },
          tournament: { select: { name: true } },
        },
      },
    },
  });

  if (!verification) {
    return { ok: false, error: 'Invalid verification link.' };
  }

  if (verification.verifiedAt) {
    // Already verified — return success (idempotent)
    return {
      ok: true,
      registration: {
        id: verification.registration.id,
        competitorName: `${verification.registration.competitor.firstName} ${verification.registration.competitor.lastName}`,
        tournamentName: verification.registration.tournament.name,
      },
    };
  }

  if (new Date() > verification.expiresAt) {
    return { ok: false, error: 'Verification link has expired. Please contact the tournament organizer.' };
  }

  // Mark as verified
  await prisma.$transaction([
    prisma.parentalConsentVerification.update({
      where: { id: verification.id },
      data: { verifiedAt: new Date() },
    }),
    prisma.registration.update({
      where: { id: verification.registrationId },
      data: {
        parentEmailVerified: true,
        parentEmailVerifiedAt: new Date(),
      },
    }),
  ]);

  return {
    ok: true,
    registration: {
      id: verification.registration.id,
      competitorName: `${verification.registration.competitor.firstName} ${verification.registration.competitor.lastName}`,
      tournamentName: verification.registration.tournament.name,
    },
  };
}

/**
 * Check if a registration requires parental consent verification (minor) and if it's verified.
 */
export async function checkParentalConsentStatus(
  prisma: PrismaClient,
  registrationId: string,
): Promise<{ required: boolean; verified: boolean }> {
  const registration = await prisma.registration.findUnique({
    where: { id: registrationId },
    select: {
      ageAtTournament: true,
      parentEmailVerified: true,
    },
  });

  if (!registration) {
    return { required: false, verified: false };
  }

  const isMinor = (registration.ageAtTournament ?? 18) < 18;
  return {
    required: isMinor,
    verified: registration.parentEmailVerified,
  };
}
