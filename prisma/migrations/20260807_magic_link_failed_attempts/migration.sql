-- OTP verification increments this counter after invalid attempts and
-- invalidates the magic link at the configured threshold. The Prisma
-- model has required this field since the authentication hardening work,
-- but the production migration chain did not previously create it.
ALTER TABLE "MagicLink"
ADD COLUMN "failedAttempts" INTEGER NOT NULL DEFAULT 0;
