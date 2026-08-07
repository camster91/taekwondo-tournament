-- Existing registrations predate versioned consent and remain explicitly
-- distinguishable through NULL consentVersion/consentAcceptedAt and false flags.
ALTER TABLE "Registration"
  ADD COLUMN "consentVersion" TEXT,
  ADD COLUMN "consentAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "privacyAccepted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "rulesAccepted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "guardianAttested" BOOLEAN NOT NULL DEFAULT false;
