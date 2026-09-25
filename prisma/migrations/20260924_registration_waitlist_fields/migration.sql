-- Registration waitlist columns (#191) and billing grace-period index (#235).
-- These fields were declared in schema.prisma without a migration, so
-- `prisma migrate deploy` never created them. IF NOT EXISTS keeps this safe
-- on any database where they were added out of band.

ALTER TABLE "Registration" ADD COLUMN IF NOT EXISTS "waitlistPosition" INTEGER;
ALTER TABLE "Registration" ADD COLUMN IF NOT EXISTS "waitlistPromotedAt" TIMESTAMP(3);
ALTER TABLE "Registration" ADD COLUMN IF NOT EXISTS "waitlistStatus" TEXT DEFAULT 'active';

CREATE INDEX IF NOT EXISTS "Registration_tournamentId_waitlistStatus_idx" ON "Registration"("tournamentId", "waitlistStatus");
CREATE INDEX IF NOT EXISTS "OrganizationBillingSubscription_gracePeriodEndsAt_idx" ON "OrganizationBillingSubscription"("gracePeriodEndsAt");
