-- One usage record per (organization, tournament): completing a tournament
-- again (completed -> in_progress -> completed) used to insert a second row
-- and double-count usage. Keep the earliest record of each pair.
DELETE FROM "OrganizationUsageRecord" AS dup
USING (
    SELECT "id",
           ROW_NUMBER() OVER (
               PARTITION BY "organizationId", "tournamentId"
               ORDER BY "recordedAt" ASC, "createdAt" ASC, "id" ASC
           ) AS rn
    FROM "OrganizationUsageRecord"
) AS ranked
WHERE dup."id" = ranked."id"
  AND ranked.rn > 1;

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationUsageRecord_organizationId_tournamentId_key" ON "OrganizationUsageRecord"("organizationId", "tournamentId");
