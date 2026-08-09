CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "recommendationType" TEXT NOT NULL,
    "inputSnapshot" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "constraintsConsidered" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "warnings" TEXT NOT NULL,
    "proposedDiff" TEXT NOT NULL,
    "validationResult" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedBy" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "appliedBy" TEXT,
    "appliedAt" TIMESTAMP(3),
    "appliedResult" TEXT,
    "undoReference" TEXT,
    "operationAuditId" TEXT,
    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Recommendation_confidence_check" CHECK ("confidence" >= 0 AND "confidence" <= 1),
    CONSTRAINT "Recommendation_status_check" CHECK ("status" IN ('proposed', 'approved', 'rejected', 'applied')),
    CONSTRAINT "Recommendation_lifecycle_check" CHECK (
      ("status" = 'proposed' AND "approvedBy" IS NULL AND "rejectedBy" IS NULL AND "appliedBy" IS NULL) OR
      ("status" = 'approved' AND "approvedBy" IS NOT NULL AND "approvedAt" IS NOT NULL AND "rejectedBy" IS NULL AND "appliedBy" IS NULL) OR
      ("status" = 'rejected' AND "rejectedBy" IS NOT NULL AND "rejectedAt" IS NOT NULL AND "rejectionReason" IS NOT NULL AND "approvedBy" IS NULL AND "appliedBy" IS NULL) OR
      ("status" = 'applied' AND "approvedBy" IS NOT NULL AND "approvedAt" IS NOT NULL AND "appliedBy" IS NOT NULL AND "appliedAt" IS NOT NULL AND "operationAuditId" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "Recommendation_operationAuditId_key" ON "Recommendation"("operationAuditId");
CREATE INDEX "Recommendation_tournamentId_createdAt_idx" ON "Recommendation"("tournamentId", "createdAt");
CREATE INDEX "Recommendation_tournamentId_status_idx" ON "Recommendation"("tournamentId", "status");
CREATE INDEX "Recommendation_recommendationType_idx" ON "Recommendation"("recommendationType");
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_operationAuditId_fkey" FOREIGN KEY ("operationAuditId") REFERENCES "TournamentOperationAudit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
