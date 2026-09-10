/**
 * Reserved words and slug validation for tenant-branded portal routes.
 * 
 * Reserved words prevent collision with application routes and ensure
 * fail-closed security (invalid/reserved slugs return 404, not enumeration clues).
 */

/**
 * Reserved organization slugs — cannot be used as organizer slugs.
 * These protect top-level application routes from collision.
 */
export const RESERVED_ORG_SLUGS = new Set([
  'admin',
  'api',
  'login',
  'register',
  'dashboard',
  'events',      // The portal prefix itself
  'public',
  'static',
  'assets',
  'health',
  'metrics',
  'docs',
  'help',
  'support',
  'about',
  'legal',
  'terms',
  'privacy',
  'tournaments',
  'competitors',
  'divisions',
  'brackets',
  'scoreboard',
  'results',
  'schedule',
  'checkin',
  'check-in',
  'scorekeeper',
  'director',
  'announcer',
  'waitlist',
  'profile',
  'users',
  'organization',
  'settings',
  'billing',
  'invites',
  'trash',
  'marketing',
  'display',
  'verify',
  'manage',
  'accept-invite',
  'check-registration',
  'manage-registration',
  'parent',
  'school',
]);

/**
 * Reserved event slugs — cannot be used as event slugs within an org.
 * These protect org-level routes from collision.
 */
export const RESERVED_EVENT_SLUGS = new Set([
  'new',
  'create',
  'edit',
  'settings',
  'dashboard',
  'admin',
  'api',
  'events',
  'all',
]);

/**
 * Slug validation regex: lowercase alphanumeric + hyphens, 3-63 chars.
 * Must start and end with alphanumeric (no leading/trailing hyphens).
 */
const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;

/**
 * Validate and normalize a slug string.
 * @param input Raw slug input
 * @param type 'org' or 'event' (determines which reserved list to check)
 * @returns { valid: boolean; normalized?: string; error?: string }
 */
export function validateSlug(
  input: string | null | undefined,
  type: 'org' | 'event'
): { valid: true; normalized: string } | { valid: false; error: string } {
  if (!input) {
    return { valid: false, error: 'Slug is required' };
  }

  // Normalize: trim, lowercase, collapse multiple hyphens
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')      // spaces → hyphens
    .replace(/-+/g, '-')        // collapse multiple hyphens
    .replace(/^-+|-+$/g, '');   // strip leading/trailing hyphens

  if (!SLUG_REGEX.test(normalized)) {
    return {
      valid: false,
      error: 'Slug must be 3-63 characters, lowercase letters, numbers, and hyphens only',
    };
  }

  const reservedSet = type === 'org' ? RESERVED_ORG_SLUGS : RESERVED_EVENT_SLUGS;
  if (reservedSet.has(normalized)) {
    return {
      valid: false,
      error: `"${normalized}" is a reserved word and cannot be used`,
    };
  }

  return { valid: true, normalized };
}

/**
 * Generate a slug suggestion from a name.
 * Does NOT check uniqueness — caller must verify against DB.
 */
export function generateSlugFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')  // strip non-alphanumeric except spaces/hyphens
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);  // enforce max length
}

/**
 * Check if a slug is reserved for the given type.
 */
export function isReservedSlug(slug: string, type: 'org' | 'event'): boolean {
  const normalized = slug.trim().toLowerCase();
  const reservedSet = type === 'org' ? RESERVED_ORG_SLUGS : RESERVED_EVENT_SLUGS;
  return reservedSet.has(normalized);
}
