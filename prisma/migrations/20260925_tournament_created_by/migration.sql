-- Track which user created each tournament so a director's pre-org
-- (organizationId NULL) tournaments can move into the first organization
-- they create. Tenant isolation hides org-less tournaments from org members.

ALTER TABLE "Tournament" ADD COLUMN "createdById" TEXT;

CREATE INDEX "Tournament_createdById_idx" ON "Tournament"("createdById");

ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill from the earliest tournament_created audit entry.
UPDATE "Tournament" t
SET "createdById" = a."userId"
FROM (
  SELECT DISTINCT ON ("tournamentId") "tournamentId", "userId"
  FROM "UserAuditLog"
  WHERE "action" = 'tournament_created' AND "tournamentId" IS NOT NULL
  ORDER BY "tournamentId", "createdAt" ASC
) a
WHERE t."id" = a."tournamentId" AND t."createdById" IS NULL;
