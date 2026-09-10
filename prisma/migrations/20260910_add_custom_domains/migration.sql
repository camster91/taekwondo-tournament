-- Custom domain configuration for organizer-branded public portals
CREATE TABLE "CustomDomain" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "verificationMethod" TEXT NOT NULL DEFAULT 'txt',
    "verificationToken" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "activatedAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "createdBy" TEXT,
    "verifiedBy" TEXT,
    "activatedBy" TEXT,
    "revokedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomDomain_pkey" PRIMARY KEY ("id")
);

-- Unique constraint on hostname
CREATE UNIQUE INDEX "CustomDomain_hostname_key" ON "CustomDomain"("hostname");

-- Index for organization lookup
CREATE INDEX "CustomDomain_organizationId_idx" ON "CustomDomain"("organizationId");

-- Index for status filtering
CREATE INDEX "CustomDomain_status_idx" ON "CustomDomain"("status");

-- Index for hostname lookup (already unique, but useful for composite queries)
CREATE INDEX "CustomDomain_hostname_idx" ON "CustomDomain"("hostname");

-- Foreign key to Organization
ALTER TABLE "CustomDomain" ADD CONSTRAINT "CustomDomain_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
