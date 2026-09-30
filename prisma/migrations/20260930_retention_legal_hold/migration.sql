-- #121: legal hold exempts records from the retention purge; every purge
-- run (real or dry) is recorded.
ALTER TABLE "Tournament" ADD COLUMN "legalHoldAt" TIMESTAMP(3);
ALTER TABLE "Tournament" ADD COLUMN "legalHoldReason" TEXT;
ALTER TABLE "Competitor" ADD COLUMN "legalHoldAt" TIMESTAMP(3);
ALTER TABLE "Competitor" ADD COLUMN "legalHoldReason" TEXT;

CREATE TABLE "RetentionPurgeRun" (
    "id" TEXT NOT NULL,
    "cutoff" TIMESTAMP(3) NOT NULL,
    "dryRun" BOOLEAN NOT NULL,
    "incidents" INTEGER NOT NULL,
    "divisions" INTEGER NOT NULL,
    "tournaments" INTEGER NOT NULL,
    "competitors" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetentionPurgeRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RetentionPurgeRun_createdAt_idx" ON "RetentionPurgeRun"("createdAt");
