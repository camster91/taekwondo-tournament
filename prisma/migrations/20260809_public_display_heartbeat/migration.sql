CREATE TABLE "PublicDisplayHeartbeat" (
    "tournamentId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicDisplayHeartbeat_pkey" PRIMARY KEY ("tournamentId")
);

CREATE INDEX "PublicDisplayHeartbeat_lastSeenAt_idx" ON "PublicDisplayHeartbeat"("lastSeenAt");

ALTER TABLE "PublicDisplayHeartbeat"
ADD CONSTRAINT "PublicDisplayHeartbeat_tournamentId_fkey"
FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
