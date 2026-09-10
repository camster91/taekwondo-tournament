import rateLimit, { type RateLimitRequestHandler, type Options } from 'express-rate-limit';

/**
 * Test-aware rate limiter factory.
 * 
 * In test environments (vitest, Playwright e2e), rate limiting is automatically
 * disabled to keep tests fast and deterministic. Production always enforces limits.
 * 
 * Replaces the previous pattern of:
 *   skip: () => process.env.RATE_LIMIT_DISABLED === '1' && process.env.NODE_ENV !== 'production'
 * 
 * With a centralized, test-aware approach that detects test contexts:
 *   - vitest (process.env.VITEST === 'true')
 *   - Playwright (process.env.TEST_ENV === 'e2e')
 *   - Manual override (process.env.RATE_LIMIT_DISABLED === '1' in non-production)
 * 
 * Usage:
 *   const authLimiter = createRateLimiter({
 *     windowMs: 15 * 60 * 1000,
 *     max: 5,
 *     message: { error: 'Too many attempts' },
 *   });
 */

/**
 * Detect if we're running in a test environment where rate limits should be bypassed.
 */
function isTestEnvironment(): boolean {
  // Production always enforces limits regardless of env vars
  if (process.env.NODE_ENV === 'production') {
    return false;
  }

  // Vitest unit/integration tests
  if (process.env.VITEST === 'true') {
    return true;
  }

  // Playwright e2e tests
  if (process.env.TEST_ENV === 'e2e') {
    return true;
  }

  // Manual override for local testing (only honored in non-production)
  if (process.env.RATE_LIMIT_DISABLED === '1') {
    return true;
  }

  return false;
}

/**
 * Create a test-aware rate limiter that automatically bypasses limits in test environments.
 * 
 * @param options - Standard express-rate-limit options
 * @returns Rate limit middleware
 */
export function createRateLimiter(options: Partial<Options>): RateLimitRequestHandler {
  const shouldSkip = isTestEnvironment();

  return rateLimit({
    ...options,
    skip: options.skip || (() => shouldSkip),
    standardHeaders: options.standardHeaders ?? true,
    legacyHeaders: options.legacyHeaders ?? false,
  });
}

/**
 * Legacy compatibility: export the test environment check for any code
 * that still uses the old pattern directly.
 */
export { isTestEnvironment };
