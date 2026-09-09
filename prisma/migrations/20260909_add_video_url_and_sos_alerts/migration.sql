-- AlterTable
ALTER TABLE "Match" ADD COLUMN "videoUrl" TEXT;

-- CreateTable
CREATE TABLE "SOSAlert" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "ringNumber" INTEGER,
    "divisionId" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "raisedBy" TEXT,
    "raisedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SOSAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SOSAlert_tournamentId_resolved_idx" ON "SOSAlert"("tournamentId", "resolved");

-- CreateIndex
CREATE INDEX "SOSAlert_createdAt_idx" ON "SOSAlert"("createdAt");

-- AddForeignKey
ALTER TABLE "SOSAlert" ADD CONSTRAINT "SOSAlert_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
