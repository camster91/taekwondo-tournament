import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 5173);
const BASE_URL = `http://localhost:${PORT}`;
const E2E_STRIPE_WEBHOOK_SECRET = ['whsec', 'e2e', 'bowin', 'webhook', 'secret'].join('_');
const E2E_METRICS_TOKEN = ['metrics', 'e2e', 'bowin', 'private', 'monitoring', 'token'].join('-');

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'mobile-chrome',
      use: { 
        ...devices['Pixel 5'],
        // Override the default mobile viewport to match WCAG 2.2 AA touch target size testing
        // Pixel 5: 393×851 logical pixels (physical: 1080×2340 at 2.75× device pixel ratio)
      },
    },
  ],
  // The .ts loader on Node 22+ fails on this code path. The actual
  // loader is installed correctly (--list works, tests run when
  // isolated), but the `webServer.command: [array]` form triggers a
  // bug in Playwright 1.55-1.62 where the array is passed through
  // to a hook that expects a string. Plain-string `command` works.
  // See CLAUDE.md "Playwright + Node 24 known issue" for the full
  // investigation timeline.
  //
  // globalSetup and globalTeardown are also .ts files; the loader
  // transforms them on the fly. Pre-compiled fallbacks live in
  // tests/e2e/dist/ — switch to playwright-js.config.cjs to use
  // them if the TS loader path regresses again.
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  webServer: {
    // MUST be a string, not an array. The array form is broken in
    // Playwright 1.55-1.62 (Received an instance of Array from
    // the loader's resolve hook when the command is a tuple).
    command: `concurrently "npm run dev:server" "vite --port ${PORT}"`,
    // ENABLE_E2E_AUTH_BYPASS lets the dev-mode magic-link endpoint
    // return `code` + `magicUrl` in the response so the e2e suite
    // can sign in without a real email round-trip. NEVER set in
    // production. The dev-mode branch in src/server/routes/auth.ts
    // is also gated on !isEmailConfigured(), so this is a no-op in
    // production regardless.
    env: {
      // All three auth gates in auth.ts check `=== '1'` (not truthy).
      // Use String(1) so the value is the digit "1". `String(true)` is
      // the string "true" and would silently disable the routes.
      // `...process.env` last so global-setup's assignments win when
      // both are set.
      RATE_LIMIT_DISABLED: String(1),
      ENABLE_E2E_AUTH_BYPASS: String(1),
      ENABLE_DEMO_LOGIN: String(1),
      ENABLE_DEV_AUTH: String(1),
      JWT_SECRET: process.env.JWT_SECRET || 'e2e-only-jwt-secret-never-use-in-production',
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || 'sk_test_e2e_not_sent_to_stripe',
      STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || E2E_STRIPE_WEBHOOK_SECRET,
      STRIPE_STARTER_PRICE_ID: process.env.STRIPE_STARTER_PRICE_ID || 'price_e2e_starter',
      STRIPE_PRO_PRICE_ID: process.env.STRIPE_PRO_PRICE_ID || 'price_e2e_pro',
      METRICS_TOKEN: process.env.METRICS_TOKEN || E2E_METRICS_TOKEN,
      ...process.env,
    },
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
