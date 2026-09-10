-- CreateTable
CREATE TABLE "TournamentTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sportProfileSlug" TEXT NOT NULL DEFAULT 'taekwondo',
    "settings" TEXT,
    "rules" TEXT,
    "weightClasses" TEXT,
    "brandName" TEXT,
    "brandPrimaryColor" TEXT,
    "brandLogoUrl" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "TournamentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TournamentTemplate_organizationId_idx" ON "TournamentTemplate"("organizationId");

-- CreateIndex
CREATE INDEX "TournamentTemplate_organizationId_deletedAt_idx" ON "TournamentTemplate"("organizationId", "deletedAt");

-- AddForeignKey
ALTER TABLE "TournamentTemplate" ADD CONSTRAINT "TournamentTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
