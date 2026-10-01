// P2-14: COPPA parental consent verification service
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { hashSecret } from '../utils/token-hash.js';

const VERIFICATION_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours

/** Raw consent tokens are 32 random bytes, hex encoded. */
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Generate a cryptographically secure 32-byte hex token for parental consent verification.
 */
export function generateVerificationToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Create a parental consent verification record and return the raw token.
 * The verification link will be /verify-parent-consent?token=...
 *
 * Only the SHA-256 digest of the token is stored (the raw token lives in
 * the parent's email). No manual-entry code is issued: there is no
 * endpoint to redeem one, so the `code` column is left empty.
 */
export async function createParentalConsentVerification(
  prisma: PrismaClient,
  registrationId: string,
  parentEmail: string,
): Promise<{ token: string }> {
  const token = generateVerificationToken();
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);

  await prisma.parentalConsentVerification.create({
    data: {
      registrationId,
      parentEmail,
      token: hashSecret(token),
      code: '',
      expiresAt,
    },
  });

  return { token };
}

/**
 * Verify a parental consent token and mark the registration as verified.
 * Must only run on an explicit parent action (POST), never on a GET that a
 * mail link scanner could prefetch. Lookup is by token digest only; legacy
 * plaintext rows are no longer matched and simply expire.
 */
export async function verifyParentalConsent(
  prisma: PrismaClient,
  token: string,
): Promise<{ ok: true; registration: { id: string; competitorName: string; tournamentName: string } } | { ok: false; error: string }> {
  if (!TOKEN_PATTERN.test(token)) {
    return { ok: false, error: 'Invalid verification link.' };
  }

  const verification = await prisma.parentalConsentVerification.findUnique({
    where: { token: hashSecret(token) },
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

  const registration = {
    id: verification.registration.id,
    competitorName: `${verification.registration.competitor.firstName} ${verification.registration.competitor.lastName}`,
    tournamentName: verification.registration.tournament.name,
  };

  if (verification.verifiedAt) {
    // Already verified — return success (idempotent)
    return { ok: true, registration };
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

  return { ok: true, registration };
}

/**
 * Whether a registration is still waiting for the parent to confirm consent:
 * a consent request was sent (minor self-registration) and not yet verified.
 * Registrations entered by staff never get a request, so they are not
 * flagged. Shown at check-in; it never blocks check-in.
 */
export function isParentalConsentPending(registration: {
  parentEmailVerified: boolean;
  parentalConsentVerification: { verifiedAt: Date | null } | null;
}): boolean {
  if (!registration.parentalConsentVerification) return false;
  return !registration.parentEmailVerified && !registration.parentalConsentVerification.verifiedAt;
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
