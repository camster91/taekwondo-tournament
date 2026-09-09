-- P2-14: COPPA parental consent verification
-- Add verification tracking to Registration
ALTER TABLE "Registration" ADD COLUMN "parentEmailVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Registration" ADD COLUMN "parentEmailVerifiedAt" TIMESTAMP(3);

-- P2-14: Parental consent verification token table
CREATE TABLE "ParentalConsentVerification" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "parentEmail" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParentalConsentVerification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ParentalConsentVerification_registrationId_key" ON "ParentalConsentVerification"("registrationId");
CREATE UNIQUE INDEX "ParentalConsentVerification_token_key" ON "ParentalConsentVerification"("token");
CREATE INDEX "ParentalConsentVerification_parentEmail_idx" ON "ParentalConsentVerification"("parentEmail");
CREATE INDEX "ParentalConsentVerification_token_idx" ON "ParentalConsentVerification"("token");

ALTER TABLE "ParentalConsentVerification" ADD CONSTRAINT "ParentalConsentVerification_registrationId_fkey" 
    FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- P2-18: Onboarding checklist
CREATE TABLE "UserOnboardingChecklist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgProfileComplete" BOOLEAN NOT NULL DEFAULT false,
    "importComplete" BOOLEAN NOT NULL DEFAULT false,
    "firstTournamentDone" BOOLEAN NOT NULL DEFAULT false,
    "publicPageReviewed" BOOLEAN NOT NULL DEFAULT false,
    "staffInvited" BOOLEAN NOT NULL DEFAULT false,
    "dismissed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserOnboardingChecklist_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserOnboardingChecklist_userId_key" ON "UserOnboardingChecklist"("userId");

ALTER TABLE "UserOnboardingChecklist" ADD CONSTRAINT "UserOnboardingChecklist_userId_fkey" 
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
