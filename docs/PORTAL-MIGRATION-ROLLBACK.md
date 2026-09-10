# Portal URL Migration & Rollback Guide

This document describes the rehearsal steps for migrating from organization-less UUID-only registration URLs to tenant-branded portal URLs, and how to roll back if needed.

## Background

**Legacy registration URL pattern (pre-portal):**
```
https://tkd.ashbi.ca/register/:tournamentId
```
- `tournamentId` is a UUID (e.g. `550e8400-e29b-41d4-a716-446655440000`)
- No organization context in the URL
- Works for any tournament (legacy single-tenant mode)

**New portal URL pattern (post-portal):**
```
https://tkd.ashbi.ca/events/:orgSlug/:eventSlug
```
- `orgSlug` is a human-readable organization slug (e.g. `master-kims-academy`)
- `eventSlug` is a human-readable event slug (e.g. `spring-championship-2027`)
- Tenant-branded: organizer identity is visible in the URL
- Fail-closed: wrong org slug returns 404, not cross-org data

**Backward compatibility:**
- Legacy UUID URLs (`/register/:tournamentId`) continue to work
- New portal URLs (`/events/:orgSlug/:eventSlug`) are opt-in
- Tournaments without `eventSlug` or `portalPublished=false` are not discoverable via portal

---

## Migration Strategy

### Phase 1: Dual-Mode Operation (Current State)

**Status:** Both URL patterns work simultaneously
- Legacy `/register/:tournamentId` → works for all tournaments
- Portal `/events/:orgSlug/:eventSlug` → works for published portal events

**No breaking changes:** Existing bookmarks, QR codes, and shared links continue to work.

**Advantages:**
- Zero-downtime migration
- Organizers can opt-in to portal URLs at their own pace
- Legacy tournaments (pre-organization) continue to function

### Phase 2: Portal Opt-In (Current Approach)

**Process:**
1. Organizer creates a tournament in the dashboard
2. Organizer navigates to Tournament Settings → Portal Publication
3. Organizer sets `eventSlug` (e.g. `spring-championship`)
4. Organizer toggles `portalPublished = true`
5. System generates portal URL: `/events/:orgSlug/:eventSlug`
6. Organizer shares portal URL with parents/competitors

**UI Flow:**
- Tournament Settings page shows:
  - ✅ Portal URL: `https://tkd.ashbi.ca/events/master-kims-academy/spring-championship` (if published)
  - ✅ Legacy URL: `https://tkd.ashbi.ca/register/550e8400-...` (always works)
  - Toggle: "Publish to portal" (controls `portalPublished`)
  - Input: Event slug (controls `eventSlug`)

**Database Changes:**
- Add `eventSlug` to existing tournaments (nullable, unique within org)
- Add `portalPublished` boolean (default `false`)
- No data migration required (opt-in, not forced)

### Phase 3: Portal-First (Future)

**When:** After 6–12 months of portal adoption, consider deprecating legacy URLs.

**Steps:**
1. Announce deprecation timeline (e.g., 90 days)
2. Add deprecation warning banner to legacy `/register/:tournamentId` pages
3. Email all organizers with instructions to switch to portal URLs
4. After deprecation period, redirect legacy URLs to portal URLs (if `eventSlug` exists)
5. Return 410 Gone for legacy URLs without `eventSlug`

**Not recommended until:**
- > 90% of active tournaments have `portalPublished=true`
- All active organizers have been notified
- No critical tournaments depend on legacy URLs

---

## Migration Rehearsal Steps

### Pre-Migration Checklist

- [ ] Verify all organizations have a `slug` (required for portal URLs)
- [ ] Verify no slug collisions (run query below)
- [ ] Backup production database (see `docs/BACKUP-RECOVERY.md`)
- [ ] Test portal URLs on staging environment
- [ ] Run tenant isolation tests: `npm test -- tenant-isolation-matrix.test.ts`

**Check for slug collisions:**
```sql
-- Find organizations missing slugs
SELECT id, name, slug 
FROM "Organization" 
WHERE slug IS NULL;

-- Find duplicate slugs (should return 0 rows)
SELECT slug, COUNT(*) 
FROM "Organization" 
GROUP BY slug 
HAVING COUNT(*) > 1;

-- Find events missing eventSlug but published (should return 0 rows)
SELECT t.id, t.name, o.slug as org_slug, t."eventSlug", t."portalPublished"
FROM "Tournament" t
JOIN "Organization" o ON t."organizationId" = o.id
WHERE t."portalPublished" = true 
  AND t."eventSlug" IS NULL;
```

### Rehearsal: Organization Slug Assignment

**Scenario:** Assign slugs to organizations that don't have one.

**Steps:**
1. Identify organizations without slugs:
   ```sql
   SELECT id, name, slug FROM "Organization" WHERE slug IS NULL;
   ```

2. Generate slugs from organization names:
   ```typescript
   // In src/server/utils/slug.ts (create if needed)
   export function generateSlug(name: string): string {
     return name
       .toLowerCase()
       .replace(/[^a-z0-9]+/g, '-')
       .replace(/^-|-$/g, '')
       .slice(0, 63);
   }
   ```

3. Update organizations:
   ```sql
   UPDATE "Organization" 
   SET slug = 'generated-slug-here' 
   WHERE id = 'org-id-here';
   ```

4. Verify uniqueness:
   ```sql
   SELECT slug, COUNT(*) FROM "Organization" GROUP BY slug HAVING COUNT(*) > 1;
   ```

**Rollback:** If slug collision occurs, manually adjust slug to add suffix:
```sql
UPDATE "Organization" SET slug = 'org-name-2' WHERE id = 'collision-org-id';
```

### Rehearsal: Event Slug Assignment

**Scenario:** Assign `eventSlug` to existing tournaments.

**Steps:**
1. Identify tournaments without `eventSlug`:
   ```sql
   SELECT t.id, t.name, o.slug as org_slug, t."eventSlug"
   FROM "Tournament" t
   JOIN "Organization" o ON t."organizationId" = o.id
   WHERE t."eventSlug" IS NULL
     AND t."deletedAt" IS NULL
   ORDER BY t.date DESC;
   ```

2. Generate `eventSlug` from tournament name:
   ```typescript
   // Same generateSlug() function as above
   const eventSlug = generateSlug(tournament.name);
   ```

3. Update tournaments:
   ```sql
   UPDATE "Tournament" 
   SET "eventSlug" = 'generated-event-slug' 
   WHERE id = 'tournament-id-here';
   ```

4. Verify uniqueness within organization:
   ```sql
   SELECT o.slug, t."eventSlug", COUNT(*)
   FROM "Tournament" t
   JOIN "Organization" o ON t."organizationId" = o.id
   WHERE t."eventSlug" IS NOT NULL
   GROUP BY o.slug, t."eventSlug"
   HAVING COUNT(*) > 1;
   ```

**Rollback:** If slug collision within org, add year suffix:
```sql
UPDATE "Tournament" 
SET "eventSlug" = 'spring-championship-2027' 
WHERE id = 'collision-tournament-id';
```

### Rehearsal: Portal Publication

**Scenario:** Enable portal for select tournaments.

**Steps:**
1. Verify tournament has `eventSlug` and org has `slug`:
   ```sql
   SELECT t.id, t.name, o.slug as org_slug, t."eventSlug", t."portalPublished"
   FROM "Tournament" t
   JOIN "Organization" o ON t."organizationId" = o.id
   WHERE t.id = 'tournament-id-here';
   ```

2. Enable portal publication:
   ```sql
   UPDATE "Tournament" 
   SET "portalPublished" = true, 
       "portalPublishedAt" = NOW() 
   WHERE id = 'tournament-id-here';
   ```

3. Verify portal URL works:
   ```bash
   curl -s https://tkd.ashbi.ca/api/public/portal/org-slug/event-slug | jq .
   # Should return event details
   ```

**Rollback:** Disable portal publication:
```sql
UPDATE "Tournament" 
SET "portalPublished" = false 
WHERE id = 'tournament-id-here';
```

---

## Rollback Procedures

### Rollback 1: Disable Portal for Specific Event

**When:** Portal URL is broken or causing issues for a specific event.

**Steps:**
1. Disable portal publication:
   ```sql
   UPDATE "Tournament" 
   SET "portalPublished" = false 
   WHERE id = 'tournament-id-here';
   ```

2. Verify portal URL returns 404:
   ```bash
   curl -i https://tkd.ashbi.ca/api/public/portal/org-slug/event-slug
   # Should return 404
   ```

3. Communicate to organizer:
   - Portal URL is temporarily disabled
   - Legacy URL still works: `/register/:tournamentId`
   - Will re-enable after investigation

**Recovery time:** < 5 minutes

### Rollback 2: Disable Portal for Entire Organization

**When:** Organization-wide issue with portal URLs.

**Steps:**
1. Disable all portal events for org:
   ```sql
   UPDATE "Tournament" 
   SET "portalPublished" = false 
   WHERE "organizationId" = 'org-id-here';
   ```

2. Verify all portal URLs return 404:
   ```bash
   curl -i https://tkd.ashbi.ca/api/public/portal/org-slug
   # Should return empty events list
   ```

3. Communicate to organizer via email/phone

**Recovery time:** < 10 minutes

### Rollback 3: Disable Portal System-Wide

**When:** Critical portal bug affecting all organizations.

**Steps:**
1. Feature flag: Add `PORTAL_ENABLED=false` to `.env`

2. Update `public-portal.ts` to check feature flag:
   ```typescript
   if (process.env.PORTAL_ENABLED === 'false') {
     return res.status(503).json({ 
       error: 'Portal temporarily unavailable',
       fallback: 'Use legacy registration URL',
     });
   }
   ```

3. Deploy via VPS rollback script (see `docs/DEPLOY.md`)

4. All portal URLs return 503; legacy URLs continue to work

5. Communicate via status page / email blast

**Recovery time:** < 30 minutes (includes deploy)

### Rollback 4: Database Schema Rollback (Nuclear Option)

**When:** Portal columns (`eventSlug`, `portalPublished`) cause database corruption.

**Steps:**
1. Restore database from pre-migration backup:
   ```bash
   docker exec -i markup-postgres pg_restore \
     -U taekwondo -d taekwondo_tournament --clean --create \
     < /var/backups/taekwondo/pre-portal-migration.dump
   ```

2. Verify schema version:
   ```sql
   SELECT * FROM "_prisma_migrations" ORDER BY finished_at DESC LIMIT 5;
   ```

3. Rollback Prisma migration (if schema migration was applied):
   ```bash
   npx prisma migrate resolve --rolled-back MIGRATION_NAME
   ```

4. Restart application server

5. Verify legacy URLs work; portal URLs will 404 (expected)

**Recovery time:** 5–10 minutes (depends on DB size)

**Data loss:** All portal publications since backup (if any)

---

## Testing Rollback Procedures

### Pre-Production Testing

**Environment:** Staging database with synthetic data

**Test Cases:**
1. ✅ Disable portal for one event → verify 404, legacy URL works
2. ✅ Disable portal for entire org → verify all events return 404
3. ✅ Set `PORTAL_ENABLED=false` → verify 503, legacy URLs work
4. ✅ Restore database backup → verify schema version, data integrity

**Run before production migration:**
```bash
# On staging
npm test -- tenant-isolation-matrix.test.ts
npm run test:e2e -- public-register.spec.ts
```

### Production Rollback Drill

**When:** Quarterly (or before major portal release)

**Steps:**
1. Announce drill to team (no customer impact)
2. Disable portal for test event (`portalPublished=false`)
3. Verify portal URL returns 404
4. Re-enable portal (`portalPublished=true`)
5. Verify portal URL returns 200
6. Document time taken for each step

**Goal:** < 5 minutes from decision to rollback completion

---

## Communication Templates

### Template 1: Portal Temporarily Disabled

**Subject:** [Action Required] Your event portal is temporarily disabled

**Body:**
```
Hi [Organizer Name],

We've temporarily disabled the public portal for your event "[Event Name]" 
due to a technical issue. 

Your event is still accepting registrations via the legacy URL:
https://tkd.ashbi.ca/register/[tournamentId]

We're working to restore the portal URL and will notify you when it's back online.

If you have any questions, please contact support@bowin.io.

Best regards,
Bowin Team
```

### Template 2: Portal Restored

**Subject:** Your event portal is back online

**Body:**
```
Hi [Organizer Name],

Your event portal for "[Event Name]" is now back online:
https://tkd.ashbi.ca/events/[orgSlug]/[eventSlug]

You can resume sharing this link with parents and competitors.

We apologize for the interruption. If you have any concerns, 
please reach out to support@bowin.io.

Best regards,
Bowin Team
```

---

## Production Migration Timeline (Recommended)

### Week 1: Dry Run
- [ ] Assign slugs to all organizations (no public impact)
- [ ] Generate `eventSlug` for all tournaments (no public impact)
- [ ] Run tenant isolation tests on staging
- [ ] Verify no slug collisions

### Week 2: Pilot Publication
- [ ] Enable portal for 3–5 friendly organizers
- [ ] Monitor portal health for 7 days
- [ ] Collect feedback on portal URLs

### Week 3–4: Gradual Rollout
- [ ] Enable portal for 10% of organizations
- [ ] Monitor error rates, tenant isolation logs
- [ ] Verify no cross-org access attempts

### Week 5+: Full Rollout
- [ ] Enable portal for all organizations (opt-in)
- [ ] Announce portal URLs in product updates
- [ ] Keep legacy URLs active for backward compatibility

### 6 Months: Deprecation Notice (Optional)
- [ ] Announce legacy URL deprecation (90-day notice)
- [ ] Add deprecation banner to legacy `/register` pages
- [ ] Email all organizers with migration instructions

---

## Backup Strategy for Portal Migration

### Pre-Migration Backup

**Required before any production changes:**
```bash
# On VPS
docker exec markup-postgres pg_dump \
  -U taekwondo taekwondo_tournament \
  > /var/backups/taekwondo/pre-portal-migration-$(date +%Y%m%d-%H%M%S).dump
```

### Backup Verification

**Test restore on staging:**
```bash
docker exec -i markup-postgres-staging pg_restore \
  -U taekwondo -d taekwondo_tournament --clean --create \
  < /var/backups/taekwondo/pre-portal-migration-YYYYMMDD-HHMMSS.dump
```

**Expected restore time:** 2–5 minutes for typical database

---

## References

- Tenant isolation tests: `src/server/routes/tenant-isolation-matrix.test.ts`
- Portal routes: `src/server/routes/public-portal.ts`
- Portal health monitoring: `docs/PORTAL-HEALTH-MONITORING.md`
- Backup & recovery: `docs/BACKUP-RECOVERY.md`
- VPS deployment: `docs/DEPLOY.md`
