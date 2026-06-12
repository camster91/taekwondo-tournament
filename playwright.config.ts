import { defineConfig, devices } from '@playwright/test';

const PORT = 5173;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
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
  ],
  globalSetup: './tests/e2e/global-setup.ts',
  // globalTeardown wipes e2e-created records (TestKid, E2E Open 2026,
  // E2E Test Tournament …) after the suite finishes so the dev DB
  // — which doubles as the prod demo's source of truth — stays clean
  // between runs. See tests/e2e/global-teardown.ts.
  globalTeardown: './tests/e2e/global-teardown.ts',
  webServer: {
    // RATE_LIMIT_DISABLED skips the in-memory rate limiters on /api/auth/*
    // so a tight test loop doesn't bump into the 5-per-15min cap. Only
    // applies when Playwright spawns the dev server (reuseExistingServer
    // case inherits the operator's own env). Safe in dev: this is a
    // development affordance, not a bypass for production.
    command: 'RATE_LIMIT_DISABLED=1 npm run dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
