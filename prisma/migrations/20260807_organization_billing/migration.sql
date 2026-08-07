CREATE TABLE "OrganizationBillingSubscription" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'manual',
  "providerCustomerId" TEXT,
  "providerSubscriptionId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'inactive',
  "plan" TEXT NOT NULL DEFAULT 'free',
  "currentPeriodEnd" TIMESTAMP(3),
  "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrganizationBillingSubscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrganizationPlanChange" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "fromPlan" TEXT NOT NULL,
  "toPlan" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "reason" TEXT NOT NULL,
  "changedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrganizationPlanChange_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationBillingSubscription_organizationId_key" ON "OrganizationBillingSubscription"("organizationId");
CREATE UNIQUE INDEX "OrganizationBillingSubscription_providerCustomerId_key" ON "OrganizationBillingSubscription"("providerCustomerId");
CREATE UNIQUE INDEX "OrganizationBillingSubscription_providerSubscriptionId_key" ON "OrganizationBillingSubscription"("providerSubscriptionId");
CREATE INDEX "OrganizationBillingSubscription_status_idx" ON "OrganizationBillingSubscription"("status");
CREATE INDEX "OrganizationBillingSubscription_plan_idx" ON "OrganizationBillingSubscription"("plan");
CREATE INDEX "OrganizationPlanChange_organizationId_createdAt_idx" ON "OrganizationPlanChange"("organizationId", "createdAt");

ALTER TABLE "OrganizationBillingSubscription"
  ADD CONSTRAINT "OrganizationBillingSubscription_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrganizationPlanChange"
  ADD CONSTRAINT "OrganizationPlanChange_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
