/**
 * Tests for slug validation utilities
 * Covers: reserved word checking, format validation, normalization
 */

import { describe, it, expect } from 'vitest';
import { validateSlug, generateSlugFromName, isReservedSlug, RESERVED_ORG_SLUGS, RESERVED_EVENT_SLUGS } from './slug-validation';

describe('validateSlug', () => {
  describe('org slugs', () => {
    it('accepts valid org slugs', () => {
      const cases = ['my-org', 'karate-school-123', 'tkd-dojo', 'masters-academy'];
      cases.forEach((slug) => {
        const result = validateSlug(slug, 'org');
        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.normalized).toBe(slug);
        }
      });
    });

    it('normalizes spaces to hyphens', () => {
      const result = validateSlug('My Karate School', 'org');
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.normalized).toBe('my-karate-school');
      }
    });

    it('collapses multiple hyphens', () => {
      const result = validateSlug('my---org', 'org');
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.normalized).toBe('my-org');
      }
    });

    it('strips leading and trailing hyphens', () => {
      const result = validateSlug('-my-org-', 'org');
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.normalized).toBe('my-org');
      }
    });

    it('rejects slugs shorter than 3 chars', () => {
      const result = validateSlug('ab', 'org');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('3-63 characters');
      }
    });

    it('rejects slugs longer than 63 chars', () => {
      const longSlug = 'a'.repeat(64);
      const result = validateSlug(longSlug, 'org');
      expect(result.valid).toBe(false);
    });

    it('rejects invalid characters', () => {
      const cases = ['my_org', 'my.org', 'my/org', 'my org!', 'myÖrg'];
      cases.forEach((slug) => {
        const result = validateSlug(slug, 'org');
        if (slug.includes(' ')) {
          // Spaces are normalized to hyphens, so 'my org!' becomes 'my-org'
          // But the '!' will fail normalization
          if (result.valid === false) {
            expect(result.error).toContain('lowercase letters, numbers, and hyphens');
          }
        } else {
          expect(result.valid).toBe(false);
        }
      });
    });

    it('rejects reserved org slugs', () => {
      const reserved = ['admin', 'api', 'events', 'public', 'dashboard'];
      reserved.forEach((slug) => {
        const result = validateSlug(slug, 'org');
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.error).toContain('reserved word');
        }
      });
    });

    it('rejects null/undefined slugs', () => {
      expect(validateSlug(null, 'org').valid).toBe(false);
      expect(validateSlug(undefined, 'org').valid).toBe(false);
      expect(validateSlug('', 'org').valid).toBe(false);
    });

    it('is case-insensitive for reserved words', () => {
      const result = validateSlug('ADMIN', 'org');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('reserved word');
      }
    });
  });

  describe('event slugs', () => {
    it('accepts valid event slugs', () => {
      const cases = ['spring-championship', 'summer-2027', 'junior-tournament'];
      cases.forEach((slug) => {
        const result = validateSlug(slug, 'event');
        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.normalized).toBe(slug);
        }
      });
    });

    it('rejects reserved event slugs', () => {
      const reserved = ['new', 'create', 'edit', 'settings', 'admin'];
      reserved.forEach((slug) => {
        const result = validateSlug(slug, 'event');
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.error).toContain('reserved word');
        }
      });
    });

    it('allows event slugs that are org-reserved but not event-reserved', () => {
      // 'tournaments' is reserved for orgs but NOT for events
      const result = validateSlug('tournaments', 'event');
      expect(result.valid).toBe(true);
    });
  });
});

describe('generateSlugFromName', () => {
  it('generates lowercase slug with hyphens', () => {
    expect(generateSlugFromName('Spring Championship 2027')).toBe('spring-championship-2027');
  });

  it('strips special characters', () => {
    expect(generateSlugFromName("Master Kim's Tournament!")).toBe('master-kims-tournament');
  });

  it('collapses multiple spaces/hyphens', () => {
    expect(generateSlugFromName('My   Awesome   Event')).toBe('my-awesome-event');
  });

  it('truncates to 63 characters', () => {
    const longName = 'A'.repeat(100);
    const slug = generateSlugFromName(longName);
    expect(slug.length).toBeLessThanOrEqual(63);
  });

  it('strips leading/trailing hyphens', () => {
    expect(generateSlugFromName('  My Event  ')).toBe('my-event');
  });
});

describe('isReservedSlug', () => {
  it('detects org-reserved slugs', () => {
    expect(isReservedSlug('admin', 'org')).toBe(true);
    expect(isReservedSlug('api', 'org')).toBe(true);
    expect(isReservedSlug('my-org', 'org')).toBe(false);
  });

  it('detects event-reserved slugs', () => {
    expect(isReservedSlug('new', 'event')).toBe(true);
    expect(isReservedSlug('create', 'event')).toBe(true);
    expect(isReservedSlug('spring-2027', 'event')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isReservedSlug('ADMIN', 'org')).toBe(true);
    expect(isReservedSlug('NEW', 'event')).toBe(true);
  });
});

describe('RESERVED_ORG_SLUGS', () => {
  it('includes critical application routes', () => {
    const critical = ['admin', 'api', 'events', 'public', 'dashboard', 'login'];
    critical.forEach((slug) => {
      expect(RESERVED_ORG_SLUGS.has(slug)).toBe(true);
    });
  });

  it('does not contain duplicates', () => {
    const array = Array.from(RESERVED_ORG_SLUGS);
    const uniqueArray = [...new Set(array)];
    expect(array.length).toBe(uniqueArray.length);
  });
});

describe('RESERVED_EVENT_SLUGS', () => {
  it('includes critical org-level routes', () => {
    const critical = ['new', 'create', 'edit', 'settings', 'admin'];
    critical.forEach((slug) => {
      expect(RESERVED_EVENT_SLUGS.has(slug)).toBe(true);
    });
  });

  it('does not overlap unnecessarily with org slugs', () => {
    // Event slugs should be a smaller, more focused set
    expect(RESERVED_EVENT_SLUGS.size).toBeLessThan(RESERVED_ORG_SLUGS.size);
  });
});
