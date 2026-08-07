import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

describe('production migration contract', () => {
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
});
