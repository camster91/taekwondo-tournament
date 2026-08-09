-- Mark ephemeral demo principals explicitly so cleanup never relies on email patterns.
ALTER TABLE "User"
ADD COLUMN "demoExpiresAt" TIMESTAMP(3);

-- Supports capped expiry scans without walking the complete user table.
CREATE INDEX "User_demoExpiresAt_idx" ON "User"("demoExpiresAt");
