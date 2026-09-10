-- =====================================================================
-- SH-4: Reconcile Match table to the shape defined in prisma/schema.prisma
-- =====================================================================
--
-- Background:
--   prisma/schema.prisma defines the Match model with these columns:
--     scores (TEXT/JSON), scheduledAt (TIMESTAMP), ring (TEXT),
--     roundName (TEXT), startedAt, completedAt.
--   It does NOT have: score1, score2, notes, scheduledTime, ringNumber.
--
--   The 20260710_init migration that pre-dated the schema refactor
--   still created the Match table with the legacy column names
--   (score1, score2, notes, scheduledTime, ringNumber) and
--   (roundNumber, bracketType) instead of roundName.
--
--   This migration brings an existing (legacy-shape) Match table up to
--   the schema-defined shape. It is idempotent so it is safe to run
--   multiple times and safe to run on a database that already has the
--   new shape (no-op).
--
--   Scope (SH-4):
--     Drops:   score1, score2, notes, scheduledTime, ringNumber
--     Adds:    scores, scheduledAt, ring
--
--   NOT in scope (separate drift, tracked separately):
--     roundNumber, bracketType  -> still present in the legacy init
--     migration; the schema has roundName only. A future migration will
--     resolve that drift. This migration intentionally leaves
--     roundNumber / bracketType untouched so this PR stays surgical.
--
-- Idempotency strategy:
--   - DROP COLUMN IF EXISTS  -> safe even if the column was never there
--     or was already removed by a previous re-run.
--   - ADD COLUMN IF NOT EXISTS -> safe even if the column already
--     exists from a prior re-run or a greenfield deploy that used the
--     rewritten 20260710_init migration.
--   - Wrapped in a single transaction (default Prisma behaviour) so a
--     partial failure rolls back cleanly.
-- =====================================================================

-- Drop legacy SH-4 columns
ALTER TABLE "Match" DROP COLUMN IF EXISTS "score1";
ALTER TABLE "Match" DROP COLUMN IF EXISTS "score2";
ALTER TABLE "Match" DROP COLUMN IF EXISTS "notes";
ALTER TABLE "Match" DROP COLUMN IF EXISTS "scheduledTime";
ALTER TABLE "Match" DROP COLUMN IF EXISTS "ringNumber";

-- Add the new SH-4 columns (match schema.prisma exactly)
ALTER TABLE "Match" ADD COLUMN IF NOT EXISTS "scores" TEXT;
ALTER TABLE "Match" ADD COLUMN IF NOT EXISTS "ring" TEXT;
ALTER TABLE "Match" ADD COLUMN IF NOT EXISTS "scheduledAt" TIMESTAMP(3);
