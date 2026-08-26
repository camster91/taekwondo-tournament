-- Scope support tickets to the requesting organization. Existing public and
-- legacy tickets intentionally remain unscoped and are visible to platform
-- administrators only.
ALTER TABLE "SupportTicket" ADD COLUMN "organizationId" TEXT;

CREATE INDEX "SupportTicket_organizationId_createdAt_idx"
ON "SupportTicket"("organizationId", "createdAt");

ALTER TABLE "SupportTicket"
ADD CONSTRAINT "SupportTicket_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
