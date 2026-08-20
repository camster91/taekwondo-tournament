import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // auth.ts hard-exits when JWT_SECRET is unset. Provide a
    // throwaway value for the test process so the module loads.
    env: {
      JWT_SECRET: 'test-secret-32-characters-min-for-tests',
      ...process.env,
    },
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      // Exclude client code (covered by E2E), test files, and the
      // service modules that are integration-tested rather than
      // unit-tested (DB / external API / file IO). These files
      // show up as 0% in vitest because the unit harness has no
      // Postgres / Mailgun / filesystem fixture; coverage of them
      // belongs to the integration / e2e suite, not this gate.
      exclude: [
        'src/**/*.test.ts',
        'src/client/**',
        'src/server/services/email.ts',
        'src/server/services/email-templates.ts',
        'src/server/services/excel-import.ts',
        'src/server/services/excel-template.ts',
        'src/server/services/backup-recovery.ts',
        'src/shared/constants/sport-profiles.ts',
      ],
      // Staged coverage thresholds — see #19.
      //
      // Two layers:
      //   1. Global floor (lines 28, statements 28, functions 32,
      //      branches 24). Catches accidental large-scale drops in
      //      unit-testable code without making the gate flaky
      //      during routine work. Raise incrementally in follow-up
      //      PRs (28 -> 35 -> 45 ...).
      //   2. Per-file thresholds for the named critical modules.
      //      These are pure utilities, validation middleware, and
      //      business-logic primitives. A meaningful drop on any
      //      of these fails the build. Routes and Prisma-touching
      //      services are deliberately NOT gated here — they are
      //      covered by E2E.
      //
      // Don't try to leap-frog the numbers with throwaway tests in
      // a single PR — a slow, honest climb is the goal.
      thresholds: {
        // Global floor. Started just below the current baseline
        // (~30% lines, 31% statements, 35% functions, 26%
        // branches) so the gate ships without breaking the build.
        lines: 28,
        statements: 28,
        functions: 32,
        branches: 24,
        // Per-file thresholds for unit-testable critical modules.
        // auth.ts and route files are intentionally excluded — they
        // need integration tests, which are out of scope for the
        // vitest harness.
        'src/server/middleware/validation.ts': {
          lines: 95, statements: 95, functions: 95, branches: 90,
        },
        'src/server/utils/registration-management-token.ts': {
          // The bearer capability for parent-facing registration
          // management. Branches cover the four failure modes
          // (expired / revoked / malformed / not_found) plus the
          // legacy null-expiry path; the threshold is set below
          // the current 68% to leave headroom but still well above
          // the global floor.
          lines: 95, statements: 95, functions: 95, branches: 60,
        },
        'src/server/utils/token-hash.ts': {
          lines: 70, statements: 70, functions: 70, branches: 50,
        },
        'src/server/services/bracket-formats.ts': {
          lines: 90, statements: 90, functions: 90, branches: 70,
        },
        'src/server/services/categorization-config.ts': {
          lines: 90, statements: 90, functions: 85, branches: 85,
        },
        'src/server/services/notification-policy.ts': {
          lines: 90, statements: 90, functions: 85, branches: 85,
        },
        'src/server/services/stripe-billing.ts': {
          lines: 90, statements: 90, functions: 90, branches: 85,
        },
        'src/server/services/schedule-generator.ts': {
          lines: 85, statements: 85, functions: 85, branches: 75,
        },
        'src/server/services/observability.ts': {
          lines: 95, statements: 95, functions: 95, branches: 90,
        },
        'src/shared/constants/belts.ts': {
          lines: 90, statements: 90, functions: 90, branches: 90,
        },
        'src/shared/constants/age-groups.ts': {
          lines: 90, statements: 90, functions: 90, branches: 85,
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
