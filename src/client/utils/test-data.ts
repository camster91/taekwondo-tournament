// Pattern-matches the data left behind by Playwright e2e tests in
// tests/e2e/. The demo DB and the e2e DB are the same, so e2e tests
// like `public-register.spec.ts` and `tournament-create.spec.ts`
// create real rows that the demo account then sees.
//
// This helper flags those rows so the UI can render a "TEST DATA" badge
// next to them — the rows are still real and still functional, but the
// operator/visitor can tell at a glance which ones are not seed data.
//
// If a new e2e test creates new fixture data, add the new pattern here
// and the badges will pick it up everywhere.

const TEST_NAME_PREFIX = /^E2E\b/i; // "E2E Open 2026", "E2E Test Tournament …", "E2E1781…"
const TEST_FIRST_NAMES = new Set(['TestKid']); // public-register.spec.ts L21
const TEST_SCHOOL_PREFIX = /^E2E\b/i; // "E2E Test Dojang", "E2E Arena"

export interface TestDataShape {
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  schoolDojang?: string | null;
}

export function isTestData(item: TestDataShape): boolean {
  // Tournaments use `name`; competitors use `firstName`/`lastName`/`schoolDojang`.
  // The prefix is intentionally broad (case-insensitive "E2E") because both
  // e2e tournaments (`E2E Open 2026`, `E2E Test Tournament …`) and the
  // e2e-generated lastName (`E2E1781225213537`) start with it.
  if (typeof item.name === 'string' && TEST_NAME_PREFIX.test(item.name)) return true;
  if (typeof item.firstName === 'string' && TEST_FIRST_NAMES.has(item.firstName)) return true;
  if (typeof item.lastName === 'string' && TEST_NAME_PREFIX.test(item.lastName)) return true;
  if (typeof item.schoolDojang === 'string' && TEST_SCHOOL_PREFIX.test(item.schoolDojang)) return true;
  return false;
}
