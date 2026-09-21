-- Adds the scalar columns the application code reads but which no migration
-- ever created. Verified by reconciling prisma/schema.prisma against a
-- fully-migrated database (information_schema) and against production
-- call sites.
--
-- CONTEXT (#289 / #291)
-- ---------------------
-- These fields were declared in schema.prisma and read by server code, but
-- they exist in no earlier migration and therefore in no database. Feature
-- code that touches them would fail at runtime with
-- "The column X of relation Y does not exist in the current database".
--
-- Affected features:
--   * Registration.waitlist*  -> tournament capacity + waitlist (PR #274)
--   * SOSAlert.source/status  -> SOS alert lifecycle
--   * TournamentOperationAudit.userId/details -> audit trail identity
--   * CompetitorRating.confidence             -> fairness/rating display
--
-- This migration is additive and nullable/defaulted so it is safe to apply
-- to a live database: no existing row is invalidated, no data is rewritten.
-- It has NOT been applied to production; that requires owner approval.
--
-- Rollback: each statement can be reversed with DROP COLUMN. The added
-- columns carry defaults, so dropping them loses only the default values
-- for rows written after this migration ran.

-- Tournament capacity + waitlist (PR #274 shipped the code without this).
ALTER TABLE "Registration"
  ADD COLUMN IF NOT EXISTS "waitlistStatus" TEXT DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS "waitlistPosition" INTEGER,
  ADD COLUMN IF NOT EXISTS "waitlistPromotedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Registration_waitlistStatus_idx"
  ON "Registration"("waitlistStatus");

-- SOS alert lifecycle.
ALTER TABLE "SOSAlert"
  ADD COLUMN IF NOT EXISTS "source" TEXT,
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'active';

CREATE INDEX IF NOT EXISTS "SOSAlert_tournamentId_status_idx"
  ON "SOSAlert"("tournamentId", "status");

-- Operation audit identity + payload.
ALTER TABLE "TournamentOperationAudit"
  ADD COLUMN IF NOT EXISTS "userId" TEXT,
  ADD COLUMN IF NOT EXISTS "details" TEXT;

-- Competitor rating confidence (fairness matching).
ALTER TABLE "CompetitorRating"
  ADD COLUMN IF NOT EXISTS "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Match score + start time.
ALTER TABLE "Match"
  ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3);

-- Division assignment manual seeding (singular column name used by code).
ALTER TABLE "DivisionAssignment"
  ADD COLUMN IF NOT EXISTS "seed" INTEGER;

-- CompetitorRating update timestamp (read by the rating service).
ALTER TABLE "CompetitorRating"
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
