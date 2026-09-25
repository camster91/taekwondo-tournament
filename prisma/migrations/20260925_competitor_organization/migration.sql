-- Owning organization for competitors, so an org-created competitor stays
-- visible to that org before its first registration (tenant isolation
-- otherwise derives competitor visibility only from registrations).

ALTER TABLE "Competitor" ADD COLUMN "organizationId" TEXT;

CREATE INDEX "Competitor_organizationId_idx" ON "Competitor"("organizationId");

ALTER TABLE "Competitor" ADD CONSTRAINT "Competitor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: a competitor whose registrations all belong to tournaments of
-- exactly one organization is owned by that organization.
UPDATE "Competitor" c
SET "organizationId" = o."organizationId"
FROM (
  SELECT r."competitorId", MIN(t."organizationId") AS "organizationId"
  FROM "Registration" r
  JOIN "Tournament" t ON t."id" = r."tournamentId"
  GROUP BY r."competitorId"
  HAVING COUNT(DISTINCT t."organizationId") = 1
     AND COUNT(*) = COUNT(t."organizationId")
) o
WHERE c."id" = o."competitorId" AND c."organizationId" IS NULL;
