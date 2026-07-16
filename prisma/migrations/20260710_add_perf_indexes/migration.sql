-- Performance indexes. Closes P13 from the 2026-07-15 review.
-- All indexes are additive (CREATE INDEX IF NOT EXISTS is not
-- supported in standard Prisma migrations, but the operations
-- are idempotent at the schema level: re-running the migration
-- fails with "already exists" which is the expected
-- re-deploy behavior).

-- Match: combined index for match-advancement lookups
-- (bracketId + roundNumber + bracketType)
CREATE INDEX IF NOT EXISTS "Match_bracketId_roundNumber_bracketType_idx" ON "Match"("bracketId", "roundNumber", "bracketType");
CREATE INDEX IF NOT EXISTS "Match_competitor1Id_idx" ON "Match"("competitor1Id");
CREATE INDEX IF NOT EXISTS "Match_competitor2Id_idx" ON "Match"("competitor2Id");

-- Competitor / Tournament / Division: deletedAt indexes
-- (every list query filters on deletedAt = null)
CREATE INDEX IF NOT EXISTS "Competitor_deletedAt_idx" ON "Competitor"("deletedAt");
CREATE INDEX IF NOT EXISTS "Tournament_deletedAt_idx" ON "Tournament"("deletedAt");
CREATE INDEX IF NOT EXISTS "Tournament_status_idx" ON "Tournament"("status");
CREATE INDEX IF NOT EXISTS "Division_deletedAt_idx" ON "Division"("deletedAt");

-- Registration: day-of panel query (tournamentId + checkedIn)
CREATE INDEX IF NOT EXISTS "Registration_tournamentId_checkedIn_idx" ON "Registration"("tournamentId", "checkedIn");
