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
      DATABASE_URL: process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test_db',
      ...process.env,
    },
    include: ['src/**/*.test.{ts,tsx}'],
    // Several authentication tests deliberately change process.env and reload
    // auth.ts to exercise deployment gates and rate-limit configuration. Files
    // must not overlap or one test server can inherit another file's limiter
    // state, producing false 429s and timeouts in a full suite run.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/client/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
