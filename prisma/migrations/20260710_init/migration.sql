
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Competitor" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "gender" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3) NOT NULL,
    "belt" TEXT NOT NULL,
    "beltStripe" TEXT,
    "danRank" INTEGER,
    "heightInches" DOUBLE PRECISION,
    "weightLbs" DOUBLE PRECISION,
    "schoolDojang" TEXT,
    "specialNeeds" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "beltPromotionDate" TIMESTAMP(3),
    "yearsTraining" DOUBLE PRECISION,
    "region" TEXT,
    "reachInches" DOUBLE PRECISION,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Competitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tournament" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "settings" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT,
    "sportProfileId" TEXT,
    "sportProfileSlug" TEXT DEFAULT 'taekwondo',
    "deletedAt" TIMESTAMP(3),
    "publicSlug" TEXT,

    CONSTRAINT "Tournament_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Registration" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "patterns" BOOLEAN NOT NULL DEFAULT false,
    "sparring" BOOLEAN NOT NULL DEFAULT false,
    "weightAtRegistration" DOUBLE PRECISION,
    "ageAtTournament" INTEGER,
    "checkedIn" BOOLEAN NOT NULL DEFAULT false,
    "checkInTime" TIMESTAMP(3),
    "checkInWeight" DOUBLE PRECISION,
    "parentName" TEXT,
    "parentEmail" TEXT,
    "parentPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heightAtRegistration" DOUBLE PRECISION,
    "reachAtRegistration" DOUBLE PRECISION,
    "experienceScore" DOUBLE PRECISION,
    "skillEstimate" DOUBLE PRECISION,
    "competeWithOlder" BOOLEAN NOT NULL DEFAULT false,
    "specialNeeds" TEXT,
    "manualDivisionId" TEXT,
    "seeding" INTEGER,

    CONSTRAINT "Registration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Division" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "beltLevel" TEXT NOT NULL,
    "gender" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "ageMin" INTEGER NOT NULL,
    "ageMax" INTEGER NOT NULL,
    "beltColors" TEXT,
    "danMin" INTEGER,
    "danMax" INTEGER,
    "weightClass" TEXT,
    "divisionNumber" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "isSpecialNeeds" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bracketDifficulty" DOUBLE PRECISION,
    "matchupQuality" DOUBLE PRECISION,
    "avgSkillRating" DOUBLE PRECISION,

    CONSTRAINT "Division_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DivisionAssignment" (
    "id" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "seedPosition" INTEGER,
    "manualOverride" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DivisionAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bracket" (
    "id" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "structure" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'double_elim',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bracket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "bracketId" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "matchNumber" INTEGER NOT NULL,
    "bracketType" TEXT NOT NULL,
    "competitor1Id" TEXT,
    "competitor2Id" TEXT,
    "winnerId" TEXT,
    "roundName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scores" TEXT,
    "ring" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeightClass" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gender" TEXT,
    "ageMin" INTEGER,
    "ageMax" INTEGER,
    "weightMinLbs" DOUBLE PRECISION,
    "weightMaxLbs" DOUBLE PRECISION,
    "displayOrder" INTEGER,

    CONSTRAINT "WeightClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLogin" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MagicLink" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MagicLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserTournamentAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserTournamentAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorHistory" (
    "id" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "divisionName" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "placement" INTEGER NOT NULL,
    "matchesWon" INTEGER NOT NULL DEFAULT 0,
    "matchesLost" INTEGER NOT NULL DEFAULT 0,
    "points" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchupHistory" (
    "id" TEXT NOT NULL,
    "competitor1Id" TEXT NOT NULL,
    "competitor2Id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "winnerId" TEXT,
    "eventType" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "score" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchupHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorRating" (
    "id" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 1000,
    "peakRating" DOUBLE PRECISION NOT NULL DEFAULT 1000,
    "matchesPlayed" INTEGER NOT NULL DEFAULT 0,
    "lastMatchDate" TIMESTAMP(3),
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "token" TEXT NOT NULL,
    "tokenExpiry" TIMESTAMP(3) NOT NULL,
    "invitedBy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchAuditLog" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "previousState" TEXT NOT NULL,
    "newState" TEXT NOT NULL,
    "userId" TEXT,
    "userEmail" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "settings" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationMember" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SportProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "icon" TEXT,
    "eventTypes" TEXT NOT NULL,
    "beltConfig" TEXT NOT NULL,
    "scoringConfig" TEXT NOT NULL,
    "ageGroupConfig" TEXT,
    "isGlobal" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SportProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "matchId" TEXT,
    "registrationId" TEXT,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "actionTaken" TEXT,
    "reportedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentRule" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "ruleType" TEXT NOT NULL,
    "enforcement" TEXT NOT NULL DEFAULT 'hard',
    "parameters" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 50,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Competitor_lastName_firstName_idx" ON "Competitor"("lastName", "firstName");

-- CreateIndex
CREATE INDEX "Competitor_schoolDojang_idx" ON "Competitor"("schoolDojang");

-- CreateIndex
CREATE INDEX "Competitor_region_idx" ON "Competitor"("region");

-- CreateIndex
CREATE UNIQUE INDEX "Tournament_publicSlug_key" ON "Tournament"("publicSlug");

-- CreateIndex
CREATE INDEX "Registration_tournamentId_idx" ON "Registration"("tournamentId");

-- CreateIndex
CREATE INDEX "Registration_competitorId_idx" ON "Registration"("competitorId");

-- CreateIndex
CREATE UNIQUE INDEX "Registration_tournamentId_competitorId_key" ON "Registration"("tournamentId", "competitorId");

-- CreateIndex
CREATE INDEX "Division_tournamentId_idx" ON "Division"("tournamentId");

-- CreateIndex
CREATE INDEX "Division_tournamentId_eventType_idx" ON "Division"("tournamentId", "eventType");

-- CreateIndex
CREATE INDEX "Division_tournamentId_gender_eventType_idx" ON "Division"("tournamentId", "gender", "eventType");

-- CreateIndex
CREATE INDEX "DivisionAssignment_divisionId_idx" ON "DivisionAssignment"("divisionId");

-- CreateIndex
CREATE INDEX "DivisionAssignment_registrationId_idx" ON "DivisionAssignment"("registrationId");

-- CreateIndex
CREATE UNIQUE INDEX "DivisionAssignment_divisionId_registrationId_key" ON "DivisionAssignment"("divisionId", "registrationId");

-- CreateIndex
CREATE UNIQUE INDEX "Bracket_divisionId_key" ON "Bracket"("divisionId");

-- CreateIndex
CREATE INDEX "Match_bracketId_idx" ON "Match"("bracketId");

-- CreateIndex
CREATE INDEX "Match_status_idx" ON "Match"("status");

-- CreateIndex
CREATE INDEX "Match_winnerId_idx" ON "Match"("winnerId");

-- CreateIndex
CREATE INDEX "WeightClass_tournamentId_idx" ON "WeightClass"("tournamentId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "MagicLink_token_key" ON "MagicLink"("token");

-- CreateIndex
CREATE INDEX "MagicLink_email_idx" ON "MagicLink"("email");

-- CreateIndex
CREATE INDEX "MagicLink_token_idx" ON "MagicLink"("token");

-- CreateIndex
CREATE INDEX "MagicLink_email_code_idx" ON "MagicLink"("email", "code");

-- CreateIndex
CREATE INDEX "UserTournamentAccess_tournamentId_idx" ON "UserTournamentAccess"("tournamentId");

-- CreateIndex
CREATE UNIQUE INDEX "UserTournamentAccess_userId_tournamentId_key" ON "UserTournamentAccess"("userId", "tournamentId");

-- CreateIndex
CREATE INDEX "CompetitorHistory_competitorId_idx" ON "CompetitorHistory"("competitorId");

-- CreateIndex
CREATE INDEX "CompetitorHistory_tournamentId_idx" ON "CompetitorHistory"("tournamentId");

-- CreateIndex
CREATE INDEX "CompetitorHistory_eventType_idx" ON "CompetitorHistory"("eventType");

-- CreateIndex
CREATE INDEX "CompetitorHistory_competitorId_eventType_idx" ON "CompetitorHistory"("competitorId", "eventType");

-- CreateIndex
CREATE INDEX "MatchupHistory_competitor1Id_idx" ON "MatchupHistory"("competitor1Id");

-- CreateIndex
CREATE INDEX "MatchupHistory_competitor2Id_idx" ON "MatchupHistory"("competitor2Id");

-- CreateIndex
CREATE INDEX "MatchupHistory_tournamentId_idx" ON "MatchupHistory"("tournamentId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchupHistory_competitor1Id_competitor2Id_tournamentId_mat_key" ON "MatchupHistory"("competitor1Id", "competitor2Id", "tournamentId", "matchId");

-- CreateIndex
CREATE INDEX "CompetitorRating_competitorId_idx" ON "CompetitorRating"("competitorId");

-- CreateIndex
CREATE INDEX "CompetitorRating_eventType_idx" ON "CompetitorRating"("eventType");

-- CreateIndex
CREATE INDEX "CompetitorRating_rating_idx" ON "CompetitorRating"("rating");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitorRating_competitorId_eventType_key" ON "CompetitorRating"("competitorId", "eventType");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_token_key" ON "Invitation"("token");

-- CreateIndex
CREATE INDEX "Invitation_email_idx" ON "Invitation"("email");

-- CreateIndex
CREATE INDEX "Invitation_token_idx" ON "Invitation"("token");

-- CreateIndex
CREATE INDEX "Invitation_status_idx" ON "Invitation"("status");

-- CreateIndex
CREATE INDEX "MatchAuditLog_matchId_idx" ON "MatchAuditLog"("matchId");

-- CreateIndex
CREATE INDEX "MatchAuditLog_createdAt_idx" ON "MatchAuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Organization_slug_idx" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "OrganizationMember_organizationId_idx" ON "OrganizationMember"("organizationId");

-- CreateIndex
CREATE INDEX "OrganizationMember_userId_idx" ON "OrganizationMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMember_organizationId_userId_key" ON "OrganizationMember"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "SportProfile_slug_key" ON "SportProfile"("slug");

-- CreateIndex
CREATE INDEX "Incident_tournamentId_idx" ON "Incident"("tournamentId");

-- CreateIndex
CREATE INDEX "Incident_matchId_idx" ON "Incident"("matchId");

-- CreateIndex
CREATE INDEX "Incident_registrationId_idx" ON "Incident"("registrationId");

-- CreateIndex
CREATE INDEX "Incident_deletedAt_idx" ON "Incident"("deletedAt");

-- CreateIndex
CREATE INDEX "TournamentRule_tournamentId_idx" ON "TournamentRule"("tournamentId");

-- CreateIndex
CREATE INDEX "TournamentRule_tournamentId_category_idx" ON "TournamentRule"("tournamentId", "category");

-- CreateIndex
CREATE INDEX "TournamentRule_ruleType_idx" ON "TournamentRule"("ruleType");

-- AddForeignKey
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_sportProfileId_fkey" FOREIGN KEY ("sportProfileId") REFERENCES "SportProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Division" ADD CONSTRAINT "Division_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DivisionAssignment" ADD CONSTRAINT "DivisionAssignment_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DivisionAssignment" ADD CONSTRAINT "DivisionAssignment_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bracket" ADD CONSTRAINT "Bracket_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_bracketId_fkey" FOREIGN KEY ("bracketId") REFERENCES "Bracket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_competitor1Id_fkey" FOREIGN KEY ("competitor1Id") REFERENCES "Registration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_competitor2Id_fkey" FOREIGN KEY ("competitor2Id") REFERENCES "Registration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "Registration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeightClass" ADD CONSTRAINT "WeightClass_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTournamentAccess" ADD CONSTRAINT "UserTournamentAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTournamentAccess" ADD CONSTRAINT "UserTournamentAccess_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorHistory" ADD CONSTRAINT "CompetitorHistory_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorRating" ADD CONSTRAINT "CompetitorRating_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentRule" ADD CONSTRAINT "TournamentRule_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

