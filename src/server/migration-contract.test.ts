import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

describe('production migration contract', () => {
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
});
