/**
 * Shared validation helpers for free-text fields used across the
 * public registration flow + admin invite flow.
 *
 * Background: the public POST /register route and the admin
 * POST /invites/send route each had their own copy of an email
 * regex + length-cap checks. PR #105 (public) and PR #106
 * (invites) split those into pure helpers here so the rules stay
 * consistent across the codebase.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const FIELD_LIMITS = {
  MAX_WEIGHT_LBS: 500,
  MIN_DAN_RANK: 1,
  MAX_DAN_RANK: 9,
  MAX_FIRST_NAME: 100,
  MAX_LAST_NAME: 100,
  MAX_SCHOOL: 200,
  MAX_SPECIAL_NEEDS: 2000,
  MAX_PARENT_NAME: 200,
  MAX_PARENT_EMAIL: 200,
  MAX_PARENT_PHONE: 50,
} as const;

export const VALID_ROLES = ['admin', 'director', 'scorekeeper', 'viewer'] as const;
export type ValidRole = (typeof VALID_ROLES)[number];

/**
 * Validate an email string. Returns null when valid, an error
 * message otherwise. The regex is intentionally loose — strict
 * validation happens at email-delivery time (Mailgun rejects
 * unrouteable addresses). The goal here is to reject obviously
 * broken input, not to enforce RFC 5322.
 */
export function validateEmail(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return 'Email is required';
  if (typeof value !== 'string') return 'Email must be a string';
  if (value.length > 200) return 'Email must be 200 characters or fewer';
  if (!EMAIL_RE.test(value)) return 'Email is not a valid email';
  return null;
}

/**
 * Validate a length-capped string field. Returns null when valid,
 * an error message otherwise. Allows undefined (treated as "not
 * provided" — caller decides whether that's an error).
 */
export function validateBoundedString(
  value: unknown,
  fieldName: string,
  maxLength: number,
  required: boolean = false
): string | null {
  if (value === undefined || value === null) {
    return required ? `${fieldName} is required` : null;
  }
  if (typeof value !== 'string') return `${fieldName} must be a string`;
  if (value.length > maxLength) return `${fieldName} must be ${maxLength} characters or fewer`;
  return null;
}

/**
 * Validate a role field. Returns null when valid or absent (the
 * invite defaults to 'viewer' in that case), an error message
 * when present and not in the whitelist.
 */
export function validateRole(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !VALID_ROLES.includes(value as ValidRole)) {
    return 'Invalid role';
  }
  return null;
}
