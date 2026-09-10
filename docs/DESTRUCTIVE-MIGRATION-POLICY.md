# Destructive Migration Policy

## Overview

This document defines the approval process and safety requirements for **destructive database migrations** — schema changes that can permanently delete or corrupt production data.

**Destructive migrations include:**
- Dropping tables or columns
- Changing column types that require data transformation (e.g., `TEXT` → `INTEGER`)
- Adding non-nullable columns without defaults to tables with existing data
- Renaming tables or columns (breaks existing code references)
- Changing primary keys or unique constraints
- Dropping indexes that queries depend on

**Non-destructive migrations** (safe for automated deployment):
- Adding new tables
- Adding nullable columns
- Adding indexes
- Creating new constraints (if existing data is valid)

---

## Policy: Destructive Migrations Require Approval

### 1. Approval Gate

**All destructive migrations MUST have:**
1. ✅ **Written approval** from the repository owner (Cameron / camster91)
2. ✅ **Tested recovery plan** (restore drill or rollback procedure documented)
3. ✅ **Pre-migration backup** (taken immediately before deploy)
4. ✅ **Impact assessment** (which features/queries break if rollback is required)

**Process:**
- Open a GitHub issue: `[DESTRUCTIVE MIGRATION] <brief description>`
- Include the migration SQL
- Include the recovery plan
- Tag @camster91 for approval
- Wait for explicit approval comment before merging

**Example approval issue:**
```markdown
## Destructive Migration: Drop `Competitor.beltStripe` column

**Migration SQL:**
```sql
ALTER TABLE "Competitor" DROP COLUMN "beltStripe";
```

**Justification:**
- Belt stripe is no longer used in the UI
- Data is redundant (captured in `belt` field)
- Simplifies competitor model

**Impact:**
- ~1,200 competitors in production have non-null `beltStripe` values
- No queries or code reference this column (verified via grep)

**Recovery Plan:**
1. Pre-migration backup taken via `scripts/backup-database.sh`
2. If rollback needed: restore from backup (RTO < 15 minutes)
3. Backup retention: 90 days

**Approval:** @camster91 please approve
```

### 2. Pre-Migration Backup

**Before applying ANY destructive migration to production:**

```bash
# 1. Take backup
./scripts/backup-database.sh --off-host

# 2. Verify backup
ls -lh /opt/bowin/backups/bowin-backup-YYYYMMDD-HHMMSS.sql.gpg

# 3. Test restore (staging only)
./scripts/test-backup-restore.sh

# 4. Document backup location
echo "Pre-migration backup: bowin-backup-YYYYMMDD-HHMMSS.sql.gpg" >> migration-log.txt
```

**This is ALREADY enforced in `scripts/deploy-production.sh`:**
- The deploy script automatically takes a pre-migration backup
- Backup filename includes the git SHA being deployed
- Stored at: `/var/backups/taekwondo/pre-{timestamp}-{SHA}.dump`

### 3. Testing Requirements

**Before submitting the migration PR:**

1. **Test on a production-like database:**
   ```bash
   # Create test DB with production snapshot
   pg_dump production > production-snapshot.sql
   psql test_db < production-snapshot.sql
   
   # Apply migration
   DATABASE_URL=postgresql://...test_db... npx prisma migrate dev
   
   # Verify queries still work
   npm run test:e2e
   ```

2. **Test rollback procedure:**
   - If migration fails mid-apply, can you restore from backup?
   - If migration completes but breaks the app, can you roll back?
   - Document rollback steps in the PR description

3. **Measure downtime:**
   - How long does the migration take? (use `\timing` in psql)
   - Does it lock tables? (check `pg_stat_activity` during apply)
   - Is a maintenance window required?

### 4. Communication

**For migrations requiring > 5 minutes downtime:**

1. **Pre-announce (24 hours before):**
   - Email active tournament organizers
   - Post in support channel (if applicable)
   - Update status page (if available)

2. **During migration:**
   - Set maintenance mode flag in the app
   - Return 503 Service Unavailable with retry-after header
   - Monitor Sentry/logs for errors

3. **Post-migration:**
   - Send confirmation email
   - Update status page
   - Document actual downtime vs. estimated

---

## Safe Migration Patterns

### Adding a Non-Nullable Column (Safe)

**Do this (2-step deployment):**

Step 1: Add nullable column with default
```sql
ALTER TABLE "Competitor" ADD COLUMN "rank" INTEGER DEFAULT 0;
```

Step 2 (next release): Make non-nullable
```sql
UPDATE "Competitor" SET "rank" = 0 WHERE "rank" IS NULL;
ALTER TABLE "Competitor" ALTER COLUMN "rank" SET NOT NULL;
```

**Don't do this (breaks on existing data):**
```sql
ALTER TABLE "Competitor" ADD COLUMN "rank" INTEGER NOT NULL;
-- ERROR: column "rank" contains null values
```

### Renaming a Column (Safe with aliases)

**Do this (3-step deployment):**

Step 1: Add new column
```sql
ALTER TABLE "Tournament" ADD COLUMN "brand_name" TEXT;
UPDATE "Tournament" SET "brand_name" = "brandName";
```

Step 2 (next release): Update code to use new column
```typescript
// Old code: tournament.brandName
// New code: tournament.brand_name || tournament.brandName
```

Step 3 (next release): Drop old column
```sql
ALTER TABLE "Tournament" DROP COLUMN "brandName";
```

**Don't do this (breaks existing code immediately):**
```sql
ALTER TABLE "Tournament" RENAME COLUMN "brandName" TO "brand_name";
-- All existing code referencing brandName now fails
```

### Dropping a Table (Safe with grace period)

**Do this (3-step deployment):**

Step 1: Stop writes to the table
```typescript
// Comment out or feature-flag all INSERT/UPDATE queries
```

Step 2 (next release): Rename table (preserves data)
```sql
ALTER TABLE "LegacyFeature" RENAME TO "_LegacyFeature_deprecated_20260910";
```

Step 3 (30 days later): Drop table
```sql
DROP TABLE "_LegacyFeature_deprecated_20260910";
```

**Don't do this (no recovery if you made a mistake):**
```sql
DROP TABLE "LegacyFeature"; -- Data gone forever
```

---

## Emergency Rollback Procedure

If a destructive migration fails or breaks production:

### 1. Immediate Actions (< 5 minutes)

```bash
# 1. Stop the application
docker stop taekwondo-tournament

# 2. Identify the pre-migration backup
ls -lh /var/backups/taekwondo/pre-*.dump | tail -1

# 3. Restore from backup (see RESTORE-DRILL-TEMPLATE.md)
./scripts/restore-database.sh /var/backups/taekwondo/pre-TIMESTAMP-SHA.dump

# 4. Rollback code deployment
docker rename taekwondo-tournament-rollback taekwondo-tournament
docker start taekwondo-tournament

# 5. Verify health
curl http://localhost:3001/api/health/ready
```

### 2. Post-Rollback (< 1 hour)

1. **Root cause analysis:**
   - What went wrong?
   - Why didn't pre-deployment testing catch it?
   - How can we prevent this in the future?

2. **Update migration:**
   - Fix the migration SQL
   - Add regression tests
   - Re-test on staging

3. **Re-deploy:**
   - Follow the same approval process
   - Document lessons learned in PR

---

## Checklist: Before Merging a Destructive Migration PR

**Pull Request Author:**
- [ ] Migration is truly necessary (no safer alternative exists)
- [ ] Migration SQL is tested on a production-like database
- [ ] Rollback procedure is documented in PR description
- [ ] Pre-migration backup is automated via deploy script
- [ ] Downtime estimate is < 15 minutes (or maintenance window scheduled)
- [ ] Impact assessment is complete (which queries/features break on rollback)
- [ ] All tests pass (unit + integration + E2E)
- [ ] Approval requested from @camster91

**Approver (Cameron):**
- [ ] Migration SQL reviewed and approved
- [ ] Recovery plan is sufficient
- [ ] Downtime is acceptable (or scheduled)
- [ ] Approved comment posted on PR

**Deployer (Cameron or automated):**
- [ ] Pre-migration backup taken
- [ ] Backup verified (checksum + test restore)
- [ ] Migration applied successfully
- [ ] Post-migration smoke tests passed
- [ ] Downtime (if any) communicated to users

---

## Migration Audit Log

**All destructive migrations must be logged in `docs/MIGRATION-AUDIT.md`:**

| Date | Migration | SHA | Downtime | Rollback? | Notes |
|------|-----------|-----|----------|-----------|-------|
| 2026-09-10 | Drop `Competitor.beltStripe` | `abc123` | 0s | No | Smooth |
| 2026-09-15 | Rename `Tournament.status` → `lifecycle` | `def456` | 3min | No | 2-step deploy |
| 2026-09-20 | Drop table `LegacyBracket` | `ghi789` | 0s | No | Grace period ended |

---

## Questions & Clarifications

**Q: What if I'm not sure if a migration is destructive?**  
A: Err on the side of caution. Open a PR and ask for review before merging.

**Q: Can I apply a destructive migration to staging without approval?**  
A: Yes, staging does not require approval. But you must still document the recovery plan and test it.

**Q: What if I need to apply an emergency destructive migration during an outage?**  
A: Follow the emergency rollback procedure first (restore from backup). Then apply the migration after production is stable.

**Q: How long are pre-migration backups retained?**  
A: Pre-migration backups are kept for 90 days by default (configurable in `scripts/backup-database.sh`).

---

## Enforcement

**Violations of this policy:**
- Destructive migrations merged without approval → PR reverted immediately
- Destructive migrations applied without pre-migration backup → Production deploy blocked until backup exists
- Failed migrations without recovery plan → Incident post-mortem required

**This policy is enforced via:**
1. GitHub branch protection (requires @camster91 approval on PRs touching `prisma/migrations/`)
2. Deploy script checks (pre-migration backup is automatic)
3. Code review checklist (linked in PR template)

---

**Document owner:** Cameron (camster91)  
**Last updated:** 2026-09-10  
**Next review:** 2027-01-01
