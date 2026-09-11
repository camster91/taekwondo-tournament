-- Composite index for support-ticket list queries.
-- The list endpoint (GET /api/support/tickets) filters by
-- `organizationId IN (...)` and orders by `createdAt DESC`, so the
-- existing single-column indexes on each field force a sort every
-- time. The (organizationId, createdAt) compound index makes the
-- filter + sort a single index scan, which matters once a tenant
-- accumulates a few thousand tickets.
--
-- Safe and reversible: the existing single-column indexes stay
-- in place; the new index is additive. Drop with
-- `DROP INDEX IF EXISTS "SupportTicket_organizationId_createdAt_idx"`.

CREATE INDEX IF NOT EXISTS "SupportTicket_organizationId_createdAt_idx"
  ON "SupportTicket"("organizationId", "createdAt" DESC);
