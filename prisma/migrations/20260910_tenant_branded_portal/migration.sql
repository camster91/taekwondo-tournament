-- Add tournament portal fields for tenant-branded event discovery
-- Issue #212: Branded public event portals per organizer

-- Add eventSlug for tenant-branded URLs (/events/:orgSlug/:eventSlug)
ALTER TABLE "Tournament" ADD COLUMN "eventSlug" TEXT;

-- Add portal publication state fields
ALTER TABLE "Tournament" ADD COLUMN "portalPublished" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tournament" ADD COLUMN "portalPublishedAt" TIMESTAMP(3);

-- Create indexes for portal queries
CREATE INDEX "Tournament_organizationId_eventSlug_idx" ON "Tournament"("organizationId", "eventSlug");
CREATE INDEX "Tournament_portalPublished_idx" ON "Tournament"("portalPublished");

-- Enforce eventSlug uniqueness within organization scope
CREATE UNIQUE INDEX "Tournament_organizationId_eventSlug_key" ON "Tournament"("organizationId", "eventSlug");

-- Migration metadata
-- Reserved words for eventSlug validation (enforced in application layer):
--   admin, api, login, register, dashboard, events, public, static, assets,
--   health, metrics, docs, help, support, about, legal, terms, privacy,
--   tournaments, competitors, divisions, brackets, scoreboard, results
