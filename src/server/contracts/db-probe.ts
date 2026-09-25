/**
 * Shared DB-availability probe for contract tests.
 *
 * With Prisma 7 driver adapters `prisma.$connect()` is lazy and succeeds even
 * when no database is reachable, so it cannot be used to decide whether to
 * skip. This probe runs a real query against a migrated table (with a short
 * connect timeout) and returns null when the DB is unreachable or unmigrated,
 * letting suites skip cleanly in CI without Postgres.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

export const contractDatabaseUrl =
  process.env.DATABASE_URL || 'postgresql://taekwondo:taekwondo@localhost:5432/taekwondo_tournament';

export async function connectContractDb(): Promise<PrismaClient | null> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: contractDatabaseUrl, connectionTimeoutMillis: 2_000 }),
  });
  try {
    await prisma.$queryRaw`SELECT 1`;
    // Also require the schema to be migrated.
    await prisma.tournament.findFirst({ select: { id: true } });
    return prisma;
  } catch {
    console.warn('[contract-tests] Database not available, skipping integration tests');
    await prisma.$disconnect().catch(() => undefined);
    return null;
  }
}
