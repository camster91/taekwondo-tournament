/**
 * Pure validation helpers for the public registration endpoints.
 *
 * Lives in its own module so it can be unit-tested without spinning
 * up the Express app or mocking Prisma. The route handlers in
 * public.ts use these helpers to turn user-supplied patches into
 * safe DB writes.
 */

export interface PatchResult {
  ok: boolean;
  /** Error message for the 400 response, or null when ok. */
  error?: string;
  /** Normalized fields to apply to Competitor. */
  data: Record<string, unknown>;
  /** Normalized fields to apply to Registration. */
  regData: Record<string, unknown>;
}

export type RegistrationConsentResult =
  | { ok: false; error: string }
  | {
      ok: true;
      data: {
        consentVersion: string;
        consentAcceptedAt: Date;
        privacyAccepted: true;
        rulesAccepted: true;
        guardianAttested: boolean;
      };
    };

export function buildRegistrationConsent(
  body: Record<string, unknown>,
  isMinor: boolean,
  consentVersion: string,
  acceptedAt: Date,
): RegistrationConsentResult {
  if (!consentVersion.trim()) {
    throw new Error('Registration consent version is not configured');
  }
  if (body.privacyAccepted !== true) {
    return { ok: false, error: 'Privacy notice acceptance is required.' };
  }
  if (body.rulesAccepted !== true) {
    return { ok: false, error: 'Tournament rules acceptance is required.' };
  }
  if (isMinor && body.guardianAttested !== true) {
    return { ok: false, error: 'A parent or guardian must confirm their authority to register this minor.' };
  }
  return {
    ok: true,
    data: {
      consentVersion,
      consentAcceptedAt: acceptedAt,
      privacyAccepted: true,
      rulesAccepted: true,
      guardianAttested: body.guardianAttested === true,
    },
  };
}

export type RegistrationLegalConfig = {
  consentVersion: string;
  privacyNoticeUrl: string;
  tournamentTermsUrl: string;
};

export function registrationLegalConfigFromEnv(
  env: Record<string, string | undefined>,
  isProduction: boolean,
): RegistrationLegalConfig {
  // P0-6/P0-7: Legal pages are now published at /legal/privacy and /legal/terms.
  // Default to those paths; production deploys can override with env vars if needed.
  const consentVersion = isProduction
    ? (env.REGISTRATION_CONSENT_VERSION?.trim() || '2026-08-24')
    : (env.REGISTRATION_CONSENT_VERSION ?? 'development-draft-v0');
  
  const privacyNoticeUrl = env.PRIVACY_NOTICE_URL?.trim() || '/legal/privacy';
  const tournamentTermsUrl = env.TOURNAMENT_TERMS_URL?.trim() || '/legal/terms';
  
  if (isProduction) {
    // In production, validate that URLs are either absolute HTTPS or relative paths
    if (privacyNoticeUrl.startsWith('http://')) {
      throw new Error('PRIVACY_NOTICE_URL must be HTTPS or a relative path in production');
    }
    if (tournamentTermsUrl.startsWith('http://')) {
      throw new Error('TOURNAMENT_TERMS_URL must be HTTPS or a relative path in production');
    }
  }
  
  return { consentVersion, privacyNoticeUrl, tournamentTermsUrl };
}

const MAX_WEIGHT_LBS = 500;
const MIN_DAN_RANK = 1;
const MAX_DAN_RANK = 9;
const MAX_FIRST_NAME = 100;
const MAX_LAST_NAME = 100;
const MAX_SCHOOL = 200;
const MAX_SPECIAL_NEEDS = 2000;
const MAX_PARENT_NAME = 200;
const MAX_PARENT_EMAIL = 200;
const MAX_PARENT_PHONE = 50;

/**
 * Build a normalized patch from a request body for the PATCH
 * /api/public/registrations/:code endpoint.
 *
 * Returns `{ ok: true, data, regData }` when the body is acceptable,
 * or `{ ok: false, error, data: {}, regData: {} }` when the body has
 * an unprocessable field. The route surfaces the error message as
 * a 400 response.
 *
 * IMPORTANT: the body may be partially valid (e.g. weight is fine
 * but belt is malformed). Callers should:
 *   1. Run this helper.
 *   2. If !ok, return 400 with the error.
 *   3. If ok but both data + regData are empty, return 400 "no
 *      editable fields supplied" (matches existing behavior).
 */
export function buildRegistrationPatch(body: Record<string, unknown> | undefined): PatchResult {
  const data: Record<string, unknown> = {};
  const regData: Record<string, unknown> = {};
  const fail = (error: string): PatchResult => ({ ok: false, error, data: {}, regData: {} });

  if (!body) return { ok: true, data, regData };

  if (body.firstName !== undefined) {
    const v = String(body.firstName).trim();
    if (!v) return fail('First name cannot be empty.');
    if (v.length > MAX_FIRST_NAME) return fail(`First name must be ${MAX_FIRST_NAME} characters or fewer.`);
    data.firstName = v;
  }
  if (body.gender !== undefined) {
    const g = String(body.gender).trim();
    if (!['M', 'F'].includes(g)) return fail('Gender must be M or F.');
    data.gender = g;
  }
  if (body.school !== undefined) {
    const v = String(body.school).trim();
    if (v.length > MAX_SCHOOL) return fail(`School/dojang must be ${MAX_SCHOOL} characters or fewer.`);
    data.schoolDojang = v || null;
  }
  if (body.specialNeeds !== undefined) {
    const v = String(body.specialNeeds).trim();
    if (v.length > MAX_SPECIAL_NEEDS) return fail(`Special needs must be ${MAX_SPECIAL_NEEDS} characters or fewer.`);
    data.specialNeeds = v || null;
  }
  if (body.competeWithOlder !== undefined) {
    data.competeWithOlder = !!body.competeWithOlder;
  }
  if (body.patterns !== undefined) regData.patterns = !!body.patterns;
  if (body.sparring !== undefined) regData.sparring = !!body.sparring;

  // Belt handling is special — uses the shared normalizeBelt helper
  // from src/shared/constants/belts.ts so the alias table stays in
  // one place.
  if (body.belt !== undefined) {
    const normalizedBelt = normalizeBelt(String(body.belt));
    data.belt = normalizedBelt;
    // Switch off Black → clear danRank.
    if (normalizedBelt !== 'Black' && data.danRank === undefined) {
      data.danRank = null;
    }
    if (normalizedBelt === 'Black' && body.danRank !== undefined) {
      const d = parseInt(String(body.danRank), 10);
      data.danRank = Number.isInteger(d) && d >= MIN_DAN_RANK && d <= MAX_DAN_RANK ? d : 1;
    }
  }

  if (body.weight !== undefined) {
    const w = parseFloat(String(body.weight));
    // Match POST /register: weight range 0..500. Without this, a
    // parent could push weight = 99999 to break the bracket-by-weight
    // logic downstream.
    if (Number.isNaN(w) || w <= 0 || w > MAX_WEIGHT_LBS) {
      return fail(`Weight must be a number between 0 and ${MAX_WEIGHT_LBS}.`);
    }
    regData.weightAtRegistration = w;
  }

  return { ok: true, data, regData };
}

import { normalizeBelt } from '../../shared/constants/belts.js';

/**
 * Validate the GET-registration lookup parameters. Returns null when
 * ok, or an error message describing the missing/invalid field.
 */
export function validateLookupParams(
  code: unknown,
  lastName: unknown,
  dob: unknown
): string | null {
  if (typeof code !== 'string' || code.length < 6) return 'Confirmation code is required (minimum 6 characters).';
  if (typeof lastName !== 'string' || !lastName.trim()) return 'Last name is required.';
  if (typeof dob !== 'string' || !dob) return 'Date of birth is required.';
  // Verify dob parses to a valid Date (Prisma's findFirst with an
  // Invalid Date silently matches nothing, which masks client errors
  // as 404s).
  if (Number.isNaN(new Date(dob).getTime())) return 'Date of birth is not a valid date.';
  return null;
}

export const PUBLIC_REGISTRATION_LIMITS = {
  MAX_WEIGHT_LBS,
  MIN_DAN_RANK,
  MAX_DAN_RANK,
  MAX_FIRST_NAME,
  MAX_LAST_NAME,
  MAX_SCHOOL,
  MAX_SPECIAL_NEEDS,
  MAX_PARENT_NAME,
  MAX_PARENT_EMAIL,
  MAX_PARENT_PHONE,
} as const;
