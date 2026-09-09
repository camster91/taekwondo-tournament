-- Phase 1: Organization invites + User audit log (P1-1, P1-3)

-- Add organizationId to Invitation for org-scoped invites
ALTER TABLE "Invitation" ADD COLUMN "organizationId" TEXT;

-- Add foreign key constraint for organizationId
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_organizationId_fkey" 
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add index for organizationId lookups
CREATE INDEX "Invitation_organizationId_idx" ON "Invitation"("organizationId");

-- Create UserAuditLog table for security tracking
CREATE TABLE "UserAuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "organizationId" TEXT,
    "tournamentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAuditLog_pkey" PRIMARY KEY ("id")
);

-- Add foreign keys for UserAuditLog
ALTER TABLE "UserAuditLog" ADD CONSTRAINT "UserAuditLog_userId_fkey" 
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserAuditLog" ADD CONSTRAINT "UserAuditLog_organizationId_fkey" 
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserAuditLog" ADD CONSTRAINT "UserAuditLog_tournamentId_fkey" 
  FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add indexes for UserAuditLog
CREATE INDEX "UserAuditLog_userId_createdAt_idx" ON "UserAuditLog"("userId", "createdAt");
CREATE INDEX "UserAuditLog_action_idx" ON "UserAuditLog"("action");
CREATE INDEX "UserAuditLog_organizationId_idx" ON "UserAuditLog"("organizationId");
CREATE INDEX "UserAuditLog_tournamentId_idx" ON "UserAuditLog"("tournamentId");
