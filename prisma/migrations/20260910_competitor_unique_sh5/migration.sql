-- SH-5: Uniqueness invariant on Competitor
-- Closes the TOCTOU + non-atomic race in public registration.
-- A same-second double-submit previously created duplicate Competitor
-- rows because the findFirst + create pair was not atomic. The unique
-- constraint is now the source of truth; route handlers catch P2002
-- and return 409 with "already registered" so the user gets a clear
-- answer and can refresh to see their existing registration.
--
-- Backfill before the constraint: dedupe existing rows by
-- (firstName, lastName, dateOfBirth), keeping the oldest competitor
-- per group and reassigning dependent rows to the survivor. Without
-- this, adding the unique index on a populated DB fails with
-- "could not create unique index" on the first collision.
--
-- Note: A soft-deleted Competitor (deletedAt set) still occupies the
-- unique slot. The findFirst in the route does not filter on deletedAt
-- (preserves accidental-deletion recovery), so re-registering a
-- previously soft-deleted person will hit P2002. That surfaces as the
-- same 409 "already registered" response — staff can restore the
-- soft-deleted record via the manager UI to clear the block.

-- Step 1: Reassign registrations to the oldest competitor per duplicate group.
UPDATE "Registration" r
SET "competitorId" = keeper.id
FROM (
  SELECT DISTINCT ON ("firstName", "lastName", "dateOfBirth") id,
         "firstName", "lastName", "dateOfBirth"
  FROM "Competitor"
  WHERE "deletedAt" IS NULL
  ORDER BY "firstName", "lastName", "dateOfBirth", "createdAt" ASC, id ASC
) keeper
JOIN "Competitor" dup
  ON dup."firstName" = keeper."firstName"
 AND dup."lastName" = keeper."lastName"
 AND dup."dateOfBirth" = keeper."dateOfBirth"
 AND dup."deletedAt" IS NULL
 AND dup.id <> keeper.id
WHERE r."competitorId" = dup.id;

-- Step 2: Reassign dependent tables (history + ratings) the same way.
UPDATE "CompetitorHistory" ch
SET "competitorId" = keeper.id
FROM (
  SELECT DISTINCT ON ("firstName", "lastName", "dateOfBirth") id,
         "firstName", "lastName", "dateOfBirth"
  FROM "Competitor"
  WHERE "deletedAt" IS NULL
  ORDER BY "firstName", "lastName", "dateOfBirth", "createdAt" ASC, id ASC
) keeper
JOIN "Competitor" dup
  ON dup."firstName" = keeper."firstName"
 AND dup."lastName" = keeper."lastName"
 AND dup."dateOfBirth" = keeper."dateOfBirth"
 AND dup."deletedAt" IS NULL
 AND dup.id <> keeper.id
WHERE ch."competitorId" = dup.id;

UPDATE "CompetitorRating" cr
SET "competitorId" = keeper.id
FROM (
  SELECT DISTINCT ON ("firstName", "lastName", "dateOfBirth") id,
         "firstName", "lastName", "dateOfBirth"
  FROM "Competitor"
  WHERE "deletedAt" IS NULL
  ORDER BY "firstName", "lastName", "dateOfBirth", "createdAt" ASC, id ASC
) keeper
JOIN "Competitor" dup
  ON dup."firstName" = keeper."firstName"
 AND dup."lastName" = keeper."lastName"
 AND dup."dateOfBirth" = keeper."dateOfBirth"
 AND dup."deletedAt" IS NULL
 AND dup.id <> keeper.id
WHERE cr."competitorId" = dup.id;

-- Step 3: Delete the now-orphaned duplicate Competitor rows.
DELETE FROM "Competitor"
WHERE id IN (
  SELECT dup.id
  FROM "Competitor" dup
  JOIN (
    SELECT DISTINCT ON ("firstName", "lastName", "dateOfBirth") id,
           "firstName", "lastName", "dateOfBirth"
    FROM "Competitor"
    WHERE "deletedAt" IS NULL
    ORDER BY "firstName", "lastName", "dateOfBirth", "createdAt" ASC, id ASC
  ) keeper
    ON dup."firstName" = keeper."firstName"
   AND dup."lastName" = keeper."lastName"
   AND dup."dateOfBirth" = keeper."dateOfBirth"
   AND dup."deletedAt" IS NULL
   AND dup.id <> keeper.id
);

-- Step 4: Add the unique index (Prisma's `@@unique` generates a
-- UNIQUE INDEX named "Competitor_firstName_lastName_dateOfBirth_key").
CREATE UNIQUE INDEX "Competitor_firstName_lastName_dateOfBirth_key"
  ON "Competitor"("firstName", "lastName", "dateOfBirth");
