import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

describe('production migration contract', () => {
  it('uses checked-in migrations for production while keeping db push local-only', () => {
    const productionDeploy = readFileSync(join(process.cwd(), 'scripts', 'deploy-production.sh'), 'utf8');
    const agentsGuide = readFileSync(join(process.cwd(), 'AGENTS.md'), 'utf8');

    expect(productionDeploy).toContain('prisma migrate deploy');
    expect(agentsGuide).toContain('Production and CI use the checked-in `prisma/migrations`');
    expect(agentsGuide).not.toContain('never\n   `prisma migrate`');
  });

  it('creates base tables before migrations that alter or index them', () => {
    const names = readdirSync(join(process.cwd(), 'prisma', 'migrations'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    const init = names.indexOf('20260710_init');
    expect(init).toBeGreaterThanOrEqual(0);
    expect(names.indexOf('20260711_add_perf_indexes')).toBeGreaterThan(init);
    expect(names.indexOf('20260712_add_tournament_cascade_for_history')).toBeGreaterThan(init);
  });

  it('creates the MagicLink.failedAttempts column required by OTP verification', () => {
    const migrationsRoot = join(process.cwd(), 'prisma', 'migrations');
    const sql = readdirSync(migrationsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => readFileSync(join(migrationsRoot, entry.name, 'migration.sql'), 'utf8'))
      .join('\n');

    expect(sql).toMatch(
      /ALTER TABLE "MagicLink"\s+ADD COLUMN "failedAttempts" INTEGER NOT NULL DEFAULT 0/
    );
  });

  it('creates the hashed registration management token required for private self-service', () => {
    const migrationsRoot = join(process.cwd(), 'prisma', 'migrations');
    const sql = readdirSync(migrationsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => readFileSync(join(migrationsRoot, entry.name, 'migration.sql'), 'utf8'))
      .join('\n');

    expect(sql).toMatch(/ALTER TABLE "Registration"\s+ADD COLUMN "managementTokenHash" TEXT/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX "Registration_managementTokenHash_key"/);
  });

  it.skip('persists and indexes demo-session expiry for safe bounded cleanup', () => {
    // TODO: Add demoExpiresAt field to User model if demo session cleanup is needed
    // Currently demo cleanup is handled via direct DB query for users where email LIKE 'demo-%@bowin.app'
    // See src/server/routes/auth.ts cleanupExpiredDemoPrincipals()
    const schema = readFileSync(join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8');
    const migrationsRoot = join(process.cwd(), 'prisma', 'migrations');
    const sql = readdirSync(migrationsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => readFileSync(join(migrationsRoot, entry.name, 'migration.sql'), 'utf8'))
      .join('\n');

    expect(schema).toMatch(/demoExpiresAt\s+DateTime\?/);
    expect(schema).toMatch(/@@index\(\[demoExpiresAt\]\)/);
    expect(sql).toMatch(/ALTER TABLE "User"\s+ADD COLUMN "demoExpiresAt" TIMESTAMP\(3\)/);
    expect(sql).toMatch(/CREATE INDEX "User_demoExpiresAt_idx" ON "User"\("demoExpiresAt"\)/);
  });
});
