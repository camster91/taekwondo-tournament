-- Add cascade FKs to Incident, CompetitorHistory, MatchupHistory
-- so they no longer orphan when their parent Tournament is hard-
-- deleted. Closes B8 from the 2026-07-15 review.

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorHistory" ADD CONSTRAINT "CompetitorHistory_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchupHistory" ADD CONSTRAINT "MatchupHistory_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
