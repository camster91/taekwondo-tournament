// One rule for what a match score may look like, shared by the
// Scorekeeper, the match-result API and standings. Scores are 0-999 with
// up to two decimal places, so judged events (patterns / forms) can record
// 8.7 or 8.75 while combat scores stay whole numbers. No signs, spaces or
// exponents, so a stored score is always safe to render as-is.

export const SCORE_PATTERN = /^\d{1,3}(\.\d{1,2})?$/;

export const SCORE_FORMAT_MESSAGE = 'Scores must be numbers from 0 to 999, with up to two decimal places.';

export function isValidScore(value: string): boolean {
  return SCORE_PATTERN.test(value);
}

/** The numeric value of a valid score string, otherwise null. */
export function parseScore(value: string | null | undefined): number | null {
  return value != null && SCORE_PATTERN.test(value) ? Number(value) : null;
}
