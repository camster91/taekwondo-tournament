import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 5180);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: { baseURL: BASE_URL, trace: 'retain-on-failure', screenshot: 'only-on-failure', headless: true },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  webServer: {
    command: 'npm run build && node scripts/e2e-production-server.mjs',
    env: {
      ...process.env,
      PORT: String(PORT),
      ENABLE_DEMO_LOGIN: '1',
      DEMO_ISOLATED_DATA: '1',
      RATE_LIMIT_DISABLED: '1',
      JWT_SECRET: process.env.JWT_SECRET || 'e2e-only-production-shell-secret-never-deploy',
      OFFLINE_CAPABILITY_PRIVATE_KEY_BASE64: process.env.OFFLINE_CAPABILITY_PRIVATE_KEY_BASE64
        || 'MC4CAQAwBQYDK2VwBCIEIF+AFB+3Z5O46eyYKsjJexVLlARghFYReMMzRp6ig6sO',
      VITE_OFFLINE_CAPABILITY_PUBLIC_KEY_BASE64: process.env.VITE_OFFLINE_CAPABILITY_PUBLIC_KEY_BASE64
        || 'MCowBQYDK2VwAyEAM2/f3OtCJAsUi8fnEaUwbZLXH8y+yTEJ5mkuWc8v5Jw=',
    },
    url: `${BASE_URL}/api/health/ready`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
