# Portal Health & Tenant Isolation Monitoring

This document describes health checks, readiness signals, and monitoring patterns specific to the tenant-branded event portal system.

## Portal Health Signals

### 1. Portal Registration Failures

**Detection:**
- Monitor HTTP 4xx/5xx responses to `POST /api/public/register`
- Track failed registrations in application logs
- Alert on > 5% registration failure rate within a 15-minute window

**Implementation:**
The application logs all registration failures with structured metadata:
```typescript
// Logged in src/server/routes/public.ts
console.error('[public-register] validation failed', {
  tournamentId,
  errors,
  timestamp: new Date().toISOString(),
});
```

**GlitchTip / Sentry Integration:**
Registration failures are captured as Sentry events with context:
- Tournament ID
- Organization ID
- Error category (validation, entitlement, duplicate, etc.)
- User agent
- IP address (hashed for privacy)

**Alert Conditions:**
- **Critical:** > 50% registration attempts fail in 15 minutes → Portal may be misconfigured
- **Warning:** > 10% registration attempts fail in 1 hour → Investigate validation issues
- **Info:** Individual registration failure (logged but not alerted)

**Example Uptime Kuma Check:**
```json
{
  "type": "http",
  "name": "Portal Registration Health",
  "url": "https://tkd.ashbi.ca/api/health/ready",
  "method": "GET",
  "interval": 300,
  "retries": 2,
  "keyword": "\"status\":\"ok\""
}
```

---

### 2. Unpublished / Stale Portals

**Detection:**
Query for events with `portalPublished=true` but `status != 'registration'` (draft, in_progress, completed).

**Implementation:**
Add a daily check via cron or manual query:
```sql
-- Find published portals that are no longer accepting registrations
SELECT 
  t.id, 
  t.name, 
  t.eventSlug, 
  t.status, 
  t.portalPublishedAt,
  o.name as organization_name,
  o.slug as org_slug
FROM "Tournament" t
JOIN "Organization" o ON t."organizationId" = o.id
WHERE t."portalPublished" = true
  AND t.status NOT IN ('registration')
  AND t."deletedAt" IS NULL
ORDER BY t.date DESC;
```

**Alert Conditions:**
- **Warning:** Event is published but status is 'draft' → Organizer may have forgotten to unpublish
- **Info:** Event is published and status is 'in_progress' or 'completed' → Expected lifecycle, no action needed unless portal should have been unpublished

**Automation Opportunity:**
Consider auto-unpublishing events when status changes from 'registration' to 'in_progress':
```typescript
// In src/server/routes/tournaments.ts when updating status
if (previousStatus === 'registration' && newStatus === 'in_progress') {
  await prisma.tournament.update({
    where: { id: tournamentId },
    data: { portalPublished: false },
  });
  console.info('[tournament-lifecycle] auto-unpublished portal', { tournamentId });
}
```

---

### 3. Tenant Boundary Violations

**Detection:**
- Monitor for database queries that attempt cross-organization reads/writes
- Alert on Sentry errors mentioning "organizationId mismatch" or "access denied"
- Track rate limiter hits that suggest enumeration attacks

**Implementation:**
The application logs potential tenant boundary violations:
```typescript
// Example in middleware/auth.ts
if (tournament.organizationId !== user.organizationId && user.role !== 'admin') {
  console.warn('[tenant-isolation] boundary violation attempt', {
    userId: user.id,
    userOrgId: user.organizationId,
    tournamentId: tournament.id,
    tournamentOrgId: tournament.organizationId,
    requestId: res.locals.requestId,
  });
  // Then return 403
}
```

**Test Coverage:**
- Automated tests in `src/server/routes/tenant-isolation-matrix.test.ts`
- E2E tests verify portal URLs are scoped to org slugs
- Unit tests verify `requireTournamentAccess` middleware rejects cross-org access

**Alert Conditions:**
- **Critical:** > 10 tenant boundary violation attempts in 5 minutes → Possible attack or misconfiguration
- **Warning:** 1–10 violations in 1 hour → May be legitimate misnavigation or stale bookmark
- **Info:** Individual violation (logged for audit trail)

**GlitchTip / Uptime Kuma:**
- Configure log pattern matching for `[tenant-isolation]` messages
- Set up alerts in GlitchTip to fire on security-tagged events

---

### 4. Portal QR Poster URL Validity

**Detection:**
- Verify QR poster URLs resolve correctly
- Check that QR codes encode correct portal URLs (not internal UUIDs)

**Implementation:**
QR poster generation in `src/server/routes/brackets.ts` includes:
- Portal URL: `/events/:orgSlug/:eventSlug`
- Public scoreboard URL: `/scoreboard/:publicSlug`
- Management URL (for staff): `/tournaments/:tournamentId`

**Manual Verification Steps:**
1. Generate QR poster for a test tournament
2. Scan QR code with phone camera
3. Verify URL format is `https://tkd.ashbi.ca/events/org-slug/event-slug` (not UUID)
4. Verify page loads with correct branding (no "Bowin" watermark)

**Automated Test (E2E):**
```typescript
// In tests/e2e/portal-qr-codes.spec.ts (future)
test('QR poster generates portal URL, not UUID', async ({ page }) => {
  await loginAsDemo(page);
  // Create tournament with portal published
  // Download QR poster PDF
  // Parse PDF, extract QR code content
  // Verify URL matches /events/:orgSlug/:eventSlug pattern
});
```

---

### 5. Portal Analytics (if present)

**Detection:**
- Track portal page views by org slug
- Monitor registration conversion rate (views → completed registrations)
- Alert on zero portal traffic for active portals

**Implementation:**
The application logs portal page views:
```typescript
// In src/server/routes/public-portal.ts
router.get('/:orgSlug/:eventSlug', portalLimiter, async (req, res) => {
  console.info('[portal-view]', {
    orgSlug: req.params.orgSlug,
    eventSlug: req.params.eventSlug,
    userAgent: req.headers['user-agent'],
    referer: req.headers.referer,
    timestamp: new Date().toISOString(),
  });
  // ... rest of handler
});
```

**Metrics to Track:**
- Portal views per organization (by org slug)
- Registration conversion rate (portal views → completed registrations)
- Average time from portal view to registration submission
- Bounce rate (portal views with no registration)

**Alert Conditions:**
- **Warning:** Published portal has 0 views in 7 days → Organizer may not have shared the link
- **Info:** High bounce rate (> 80%) → May indicate confusing UX or missing information

---

## Health Check Endpoint Extensions

### Add Portal-Specific Health Check

Extend `/api/health/ready` to include portal health:

```typescript
// In src/server/index.ts
app.get('/api/health/ready', async (_req: Request, res: Response) => {
  try {
    // Existing DB check
    await prisma.$queryRaw`SELECT 1`;
    
    // NEW: Check for portal data integrity
    const publishedWithoutSlugs = await prisma.tournament.count({
      where: {
        portalPublished: true,
        eventSlug: null,
        deletedAt: null,
      },
    });
    
    if (publishedWithoutSlugs > 0) {
      console.warn('[health/ready] portal integrity issue', {
        publishedWithoutSlugs,
      });
      return res.status(503).json({
        status: 'degraded',
        db: 'ok',
        portal: 'integrity-violation',
        details: `${publishedWithoutSlugs} published events missing eventSlug`,
      });
    }
    
    res.json({ status: 'ok', db: 'ok', portal: 'ok' });
  } catch (err) {
    console.error('[health/ready] check failed:', err);
    res.status(503).json({ status: 'unavailable', db: 'error' });
  }
});
```

### Add Portal Metrics Endpoint

Extend `/api/internal/metrics` with portal-specific metrics:

```typescript
// In src/server/services/observability.ts or index.ts
interface PortalMetrics {
  publishedPortals: number;
  activeRegistrations: number;
  portalViews24h: number;
}

export function capturePortalMetrics(): PortalMetrics {
  // Implementation would query Prisma for counts
  return {
    publishedPortals: 0, // Count of portalPublished=true
    activeRegistrations: 0, // Count of registrations in last 24h
    portalViews24h: 0, // Count from logs or DB
  };
}

// Expose in /api/internal/metrics response
app.get('/api/internal/metrics', (req, res) => {
  // ... existing metrics ...
  const portalMetrics = capturePortalMetrics();
  res.send(`
# Portal-specific metrics
bowin_portal_published_count ${portalMetrics.publishedPortals}
bowin_portal_registrations_24h ${portalMetrics.activeRegistrations}
bowin_portal_views_24h ${portalMetrics.portalViews24h}
  `);
});
```

---

## Uptime Kuma Configuration for Portals

### Portal URL Monitor (per organization)

```json
{
  "type": "http",
  "name": "Portal Org A - Event Listing",
  "url": "https://tkd.ashbi.ca/events/org-a",
  "method": "GET",
  "interval": 600,
  "keyword": "\"organization\":",
  "expectedStatus": "200-299"
}
```

### Portal Event Detail Monitor

```json
{
  "type": "http",
  "name": "Portal Event A1",
  "url": "https://tkd.ashbi.ca/events/org-a/event-a1",
  "method": "GET",
  "interval": 600,
  "keyword": "\"event\":",
  "expectedStatus": "200-299"
}
```

### Portal Registration Endpoint Monitor

```json
{
  "type": "http",
  "name": "Portal Registration Health",
  "url": "https://tkd.ashbi.ca/api/public/portal/org-a",
  "method": "GET",
  "interval": 300,
  "expectedStatus": "200-299"
}
```

---

## GlitchTip / Sentry Alert Rules

### Portal Registration Failure Spike

```yaml
Name: Portal Registration Failure Spike
Condition: New issue with tag portal=true AND error_count > 10 in 15 minutes
Alert: Email + Slack
Severity: Critical
```

### Tenant Isolation Violation

```yaml
Name: Tenant Isolation Violation
Condition: New issue with tag security=tenant-isolation
Alert: Email + PagerDuty
Severity: Critical
```

### Portal Integrity Degradation

```yaml
Name: Portal Data Integrity Issue
Condition: /api/health/ready returns 503 with portal=integrity-violation
Alert: Email
Severity: Warning
```

---

## Log Patterns to Monitor

### Registration Failures
```
[public-register] validation failed
[public-register] tournament not found
[public-register] entitlement limit exceeded
```

### Tenant Isolation
```
[tenant-isolation] boundary violation attempt
[requireTournamentAccess] org mismatch
```

### Portal Integrity
```
[portal-publish] event missing eventSlug
[portal-publish] org missing slug
```

---

## Daily Operations Checklist

### Pre-Launch (before first portal goes live)
- [ ] Confirm GlitchTip / Sentry is capturing portal events
- [ ] Configure Uptime Kuma monitors for at least 1 test portal
- [ ] Run `npm test -- tenant-isolation-matrix.test.ts` to verify isolation
- [ ] Manually verify QR poster URLs encode portal URLs (not UUIDs)
- [ ] Test cross-org access attempts return 404/403 (not 200)

### Daily
- [ ] Review GlitchTip dashboard for portal-related errors
- [ ] Check Uptime Kuma for portal uptime (should be > 99.5%)
- [ ] Query for published portals with missing slugs (should be 0)
- [ ] Review registration failure rate (should be < 5%)

### Weekly
- [ ] Run full tenant isolation test suite: `npm test -- tenant-isolation`
- [ ] Review portal analytics: conversion rate, bounce rate
- [ ] Check for stale published portals (status != 'registration')
- [ ] Verify no cross-org access attempts in logs

---

## Rollback Plan for Portal Regressions

If a portal-related regression is detected:

1. **Immediate:** Disable portal for affected organization:
   ```sql
   UPDATE "Tournament" 
   SET "portalPublished" = false 
   WHERE "organizationId" = 'org-id-here';
   ```

2. **Verify:** Confirm portal URLs return 404 (fail-closed)

3. **Investigate:** Review GlitchTip, logs, recent code changes

4. **Fix:** Deploy fix via VPS rollback or hotfix PR

5. **Re-enable:** Set `portalPublished=true` after verification

---

## References

- Main monitoring guide: `docs/MONITORING-OPS.md`
- Tenant isolation tests: `src/server/routes/tenant-isolation-matrix.test.ts`
- Portal routes: `src/server/routes/public-portal.ts`
- Health endpoint: `src/server/index.ts` (lines 261-280)
- Observability metrics: `src/server/services/observability.ts`
