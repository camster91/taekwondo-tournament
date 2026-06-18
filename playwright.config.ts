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
  globalTeardown: './tests/e2e/global-teardown.ts',
  webServer: {
    command: ['npm run dev'],
    // ENABLE_E2E_AUTH_BYPASS lets the dev-mode magic-link endpoint
    // return `code` + `magicUrl` in the response so the e2e suite
    // can sign in without a real email round-trip. NEVER set in
    // production. The dev-mode branch in src/server/routes/auth.ts
    // is also gated on !isEmailConfigured(), so this is a no-op in
    // production regardless.
    env: {
      RATE_LIMIT_DISABLED: String(true),
      ENABLE_E2E_AUTH_BYPASS: String(true),
      ...process.env,
    },
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
