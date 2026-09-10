-- Add expiration and revocation fields to registration management tokens
-- Closes P0 #118 acceptance criteria: expiration + revocation support

ALTER TABLE "Registration"
ADD COLUMN "managementTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN "managementTokenRevokedAt" TIMESTAMP(3);

-- No default expiry for existing rows (NULL = never expires, legacy behavior).
-- New tokens will set explicit expiry at generation time.
