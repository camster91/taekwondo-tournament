-- Add organization usage metering table
CREATE TABLE "OrganizationUsageRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "competitorCount" INTEGER NOT NULL DEFAULT 0,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "billingPeriodStart" TIMESTAMP(3),
    "billingPeriodEnd" TIMESTAMP(3),
    "reportedToStripe" BOOLEAN NOT NULL DEFAULT false,
    "reportedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationUsageRecord_pkey" PRIMARY KEY ("id")
);

-- Add indexes for efficient queries
CREATE INDEX "OrganizationUsageRecord_organizationId_idx" ON "OrganizationUsageRecord"("organizationId");
CREATE INDEX "OrganizationUsageRecord_tournamentId_idx" ON "OrganizationUsageRecord"("tournamentId");
CREATE INDEX "OrganizationUsageRecord_recordedAt_idx" ON "OrganizationUsageRecord"("recordedAt");
CREATE INDEX "OrganizationUsageRecord_reportedToStripe_idx" ON "OrganizationUsageRecord"("reportedToStripe");

-- Add foreign keys
ALTER TABLE "OrganizationUsageRecord" ADD CONSTRAINT "OrganizationUsageRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationUsageRecord" ADD CONSTRAINT "OrganizationUsageRecord_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add grace period fields to OrganizationBillingSubscription
ALTER TABLE "OrganizationBillingSubscription" ADD COLUMN "gracePeriodEndsAt" TIMESTAMP(3);
ALTER TABLE "OrganizationBillingSubscription" ADD COLUMN "paymentFailedAt" TIMESTAMP(3);
ALTER TABLE "OrganizationBillingSubscription" ADD COLUMN "lastPaymentFailureReason" TEXT;
