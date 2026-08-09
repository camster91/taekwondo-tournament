CREATE TABLE "TournamentOperationAudit" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "operationType" TEXT NOT NULL,
    "operationKey" TEXT NOT NULL,
    "beforeState" TEXT,
    "afterState" TEXT NOT NULL,
    "impactSummary" TEXT NOT NULL,
    "reversible" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" TIMESTAMP(3),
    "undoneBy" TEXT,

    CONSTRAINT "TournamentOperationAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TournamentOperationAudit_tournamentId_createdAt_idx" ON "TournamentOperationAudit"("tournamentId", "createdAt");
CREATE INDEX "TournamentOperationAudit_operationType_idx" ON "TournamentOperationAudit"("operationType");
CREATE UNIQUE INDEX "TournamentOperationAudit_operationKey_key" ON "TournamentOperationAudit"("operationKey");
ALTER TABLE "TournamentOperationAudit" ADD CONSTRAINT "TournamentOperationAudit_tournamentId_fkey"
FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
