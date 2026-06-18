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
    command: 'npm run dev',
    // ENABLE_E2E_AUTH_BYPASS lets the dev-mode magic-link endpoint
    // return `code` + `magicUrl` in the response so the e2e suite
    // can sign in without a real email round-trip. NEVER set in
    // production. The dev-mode branch in src/server/routes/auth.ts
    // is also gated on !isEmailConfigured(), so this is a no-op in
    // production regardless.
    env: {
      RATE_LIMIT_DISABLED: String(true),
      // See auth.ts for the gate; here we just need a truthy value
      // that survives the chat-layer redaction that mangles "=1".
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
