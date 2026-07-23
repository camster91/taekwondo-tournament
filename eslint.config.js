// ESLint flat config — locks in the Phase 1 'any' cleanup (PR #95)
// so future code can't silently introduce explicit `any` annotations.
//
// Only the `no-explicit-any` rule is enabled. Strict mode in tsconfig
// already catches implicit `any`; this rule guards the explicit form
// (`function foo(x: any)` / `as any` / `<any>x`) which the compiler
// tolerates. Other lint rules (unused-vars, prefer-const, etc.) are
// intentionally left to the typecheck step + code review — turning on
// the full typescript-eslint recommended set would surface ~100
// pre-existing issues unrelated to this task.
//
// jsonwebtoken's `SignOptions['expiresIn']` is the only known escape
// hatch — its declared type is a buggy `string | undefined` union even
// though the runtime accepts `string | number`. The cast in
// `src/server/middleware/auth.ts` (createToken) uses `as unknown as
// jwt.SignOptions['expiresIn']` rather than `as any`, so no rule
// disable is needed at the call site. If a future contributor reaches
// for `any` near the jsonwebtoken boundary, suppress the rule on that
// line with a justifying comment (`// eslint-disable-next-line
// @typescript-eslint/no-explicit-any -- jsonwebtoken SignOptions type bug`).

import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-server/**',
      'node_modules/**',
      'prisma/generated/**',
      'public/**',
      'scripts/**',
      'tests/**',
      'playwright-report/**',
      'coverage/**',
      'src/**/__tests__/**',
    ],
  },
  // Register the @typescript-eslint plugin + parser globally. Without
  // this, ESLint 10 rejects `@typescript-eslint/*` rules with
  // "plugin not defined". `tseslint.configs.recommended` would do this
  // too, but it pulls in ~50 extra rules we don't want.
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    languageOptions: {
      parser: tseslint.parser,
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      // PR #95 replaced 112 explicit `any` usages with proper types. Lock
      // that in: any new explicit `any` is a build failure, not a warning.
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // Tests and config files are out of scope — `any` in a test fixture
    // (e.g. `as any` to bypass a type the test doesn't care about) is
    // a different decision than `any` in production code.
    files: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.config.{js,ts,mjs,cjs}',
      'vite.config.ts',
      'vitest.config.ts',
      'playwright.config.ts',
      'postcss.config.js',
      'tailwind.config.js',
      'prisma.config.ts',
      'eslint.config.js',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
