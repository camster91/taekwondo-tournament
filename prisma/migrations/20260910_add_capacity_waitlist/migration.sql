-- AlterTable: Add capacity and waitlist fields to Tournament
-- #191: Tournament capacity, waitlist, and controlled promotion

ALTER TABLE "Tournament" ADD COLUMN "maxCapacity" INTEGER;
ALTER TABLE "Tournament" ADD COLUMN "waitlistEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Index for capacity queries (optional but recommended for performance)
CREATE INDEX "Tournament_maxCapacity_waitlistEnabled_idx" ON "Tournament"("maxCapacity", "waitlistEnabled") WHERE "maxCapacity" IS NOT NULL;
