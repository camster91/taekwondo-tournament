-- Registration waitlist columns were declared in schema.prisma and written by
-- public registration, but no prior migration created them.
ALTER TABLE "Registration" ADD COLUMN "waitlistStatus" TEXT DEFAULT 'active';
ALTER TABLE "Registration" ADD COLUMN "waitlistPosition" INTEGER;
ALTER TABLE "Registration" ADD COLUMN "waitlistPromotedAt" TIMESTAMP(3);

CREATE INDEX "Registration_tournamentId_waitlistStatus_idx" ON "Registration"("tournamentId", "waitlistStatus");

-- Declared in schema.prisma by the usage-metering work but never migrated.
CREATE INDEX "OrganizationBillingSubscription_gracePeriodEndsAt_idx" ON "OrganizationBillingSubscription"("gracePeriodEndsAt");
