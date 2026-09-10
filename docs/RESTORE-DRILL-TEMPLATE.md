# Database Restore Drill Record

## Restore Drill Metadata

**Date:** _______________  
**Operator:** _______________  
**Drill Type:** [ ] Scheduled Weekly  [ ] Emergency  [ ] Pre-Release Validation  
**Environment:** [ ] Staging  [ ] Test  [ ] Production (downtime approved)  
**Backup Source:** _______________  
**Backup Date/Time:** _______________

---

## Recovery Time Objective (RTO) & Recovery Point Objective (RPO)

**Target RTO (Recovery Time Objective):**
- Database corruption: < 15 minutes
- Server failure: < 2 hours
- Ransomware/breach: < 4 hours

**Target RPO (Recovery Point Objective):**
- Maximum data loss: 24 hours (last daily backup)
- For zero-downtime: Use streaming replication (future enhancement)

**Actual Times Measured:**
- Backup retrieval time: __________ minutes
- Decryption time: __________ minutes
- Database drop/recreate time: __________ minutes
- Restore time: __________ minutes
- **Total recovery time: __________ minutes**
- **Met RTO target:** [ ] Yes  [ ] No

---

## Pre-Drill Checklist

- [ ] **Backup verification:** Checksum validated (sha256)
- [ ] **Backup age:** Confirmed backup is from the expected date/time
- [ ] **Staging database ready:** Target database is non-production (NEVER run against live production)
- [ ] **Required tools installed:** `psql`, `pg_dump`, `pg_restore`, `gpg`
- [ ] **Environment variables set:** `DATABASE_URL`, `BACKUP_ENCRYPTION_KEY`
- [ ] **Off-host backup available:** Can retrieve from S3/rsync if local copy lost
- [ ] **Downtime approval (if prod):** Stakeholders notified and approved

---

## Restore Procedure Steps

### Step 1: Retrieve Backup

**Command:**
```bash
# If from S3:
aws s3 cp s3://BUCKET_NAME/bowin-backups/BACKUP_FILE /tmp/restore-backup.sql.gpg

# If from rsync:
rsync -avz backup@remote:/backups/BACKUP_FILE /tmp/restore-backup.sql.gpg
```

**Result:**
- [ ] Backup file retrieved successfully
- [ ] File size: __________ MB
- [ ] Checksum verified: __________

**Notes:** _______________________________________________________________

---

### Step 2: Verify Backup Integrity

**Command:**
```bash
sha256sum -c /path/to/backup.sql.gpg.sha256
```

**Result:**
- [ ] Checksum matches
- [ ] Backup file is not corrupted

**Notes:** _______________________________________________________________

---

### Step 3: Decrypt Backup

**Command:**
```bash
echo "$BACKUP_ENCRYPTION_KEY" | gpg \
    --batch --yes --passphrase-fd 0 \
    --decrypt /tmp/restore-backup.sql.gpg > /tmp/restore-backup.sql
```

**Result:**
- [ ] Decryption successful
- [ ] Decrypted file size: __________ MB

**Notes:** _______________________________________________________________

---

### Step 4: Stop Application (if live environment)

**Command:**
```bash
# For Docker:
docker stop taekwondo-tournament

# For systemd:
sudo systemctl stop bowin-tournament
```

**Result:**
- [ ] Application stopped
- [ ] No active connections to database
- [ ] Downtime start time: __________

**Notes:** _______________________________________________________________

---

### Step 5: Drop Existing Database

**Command:**
```bash
psql -U taekwondo -d postgres -c "DROP DATABASE IF EXISTS taekwondo_tournament;"
```

**Result:**
- [ ] Database dropped successfully

**Notes:** _______________________________________________________________

---

### Step 6: Recreate Database

**Command:**
```bash
psql -U taekwondo -d postgres -c "CREATE DATABASE taekwondo_tournament;"
```

**Result:**
- [ ] Database created successfully

**Notes:** _______________________________________________________________

---

### Step 7: Restore from Backup

**Command:**
```bash
pg_restore \
    --dbname=postgresql://taekwondo:***@localhost:5432/taekwondo_tournament \
    --verbose \
    --no-owner \
    --no-acl \
    /tmp/restore-backup.sql
```

**Result:**
- [ ] Restore completed
- [ ] Restore duration: __________ minutes
- [ ] Exit code: __________

**Notes:** _______________________________________________________________

---

### Step 8: Run Migrations (if schema changed)

**Command:**
```bash
cd /opt/bowin
npx prisma migrate deploy
```

**Result:**
- [ ] Migrations applied successfully
- [ ] Schema version: __________

**Notes:** _______________________________________________________________

---

### Step 9: Verify Data Integrity

**Commands:**
```bash
# Count tournaments
psql -U taekwondo -d taekwondo_tournament -c "SELECT COUNT(*) FROM \"Tournament\";"

# Count competitors
psql -U taekwondo -d taekwondo_tournament -c "SELECT COUNT(*) FROM \"Competitor\";"

# Count users
psql -U taekwondo -d taekwondo_tournament -c "SELECT COUNT(*) FROM \"User\";"

# Check most recent records
psql -U taekwondo -d taekwondo_tournament -c "SELECT name, date FROM \"Tournament\" ORDER BY date DESC LIMIT 5;"
```

**Results:**
- Tournament count: __________
- Competitor count: __________
- User count: __________
- Most recent tournament: _______________
- [ ] Data matches expected pre-backup state

**Notes:** _______________________________________________________________

---

### Step 10: Restart Application

**Command:**
```bash
# For Docker:
docker start taekwondo-tournament

# For systemd:
sudo systemctl start bowin-tournament
```

**Result:**
- [ ] Application started successfully
- [ ] Health check passed: `/api/health/ready` returns 200
- [ ] Downtime end time: __________
- [ ] Total downtime: __________ minutes

**Notes:** _______________________________________________________________

---

### Step 11: Smoke Tests

Run the following smoke tests to verify the application is fully functional:

- [ ] **Login test:** Can authenticate with magic link
- [ ] **Tournament view:** Can view existing tournaments
- [ ] **Competitor search:** Search returns results
- [ ] **Division view:** Can view divisions
- [ ] **Bracket view:** Can view brackets (if any exist)
- [ ] **Match scoring:** Can record a test match score
- [ ] **Public registration:** Public registration form loads
- [ ] **Public scoreboard:** Public scoreboard displays correctly

**Notes:** _______________________________________________________________

---

## Post-Drill Review

### Issues Encountered

**Issue 1:** _______________________________________________________________  
**Resolution:** _______________________________________________________________  
**Time lost:** __________ minutes

**Issue 2:** _______________________________________________________________  
**Resolution:** _______________________________________________________________  
**Time lost:** __________ minutes

**Issue 3:** _______________________________________________________________  
**Resolution:** _______________________________________________________________  
**Time lost:** __________ minutes

### Lessons Learned

1. _______________________________________________________________
2. _______________________________________________________________
3. _______________________________________________________________

### Action Items

| Action | Owner | Due Date | Status |
|--------|-------|----------|--------|
| _______________| _______________| _______________| [ ] Open / [ ] Closed |
| _______________| _______________| _______________| [ ] Open / [ ] Closed |
| _______________| _______________| _______________| [ ] Open / [ ] Closed |

### Documentation Updates Required

- [ ] Update BACKUP-RECOVERY.md with new findings
- [ ] Update RTO/RPO targets based on actual measurements
- [ ] Document any new edge cases or failure modes
- [ ] Update restore script (`scripts/restore-database.sh`) if needed

---

## Drill Outcome

**Overall Status:** [ ] ✅ Success  [ ] ⚠️ Partial Success  [ ] ❌ Failed  

**Pass/Fail Criteria:**
- [ ] Restore completed within RTO target
- [ ] All data integrity checks passed
- [ ] All smoke tests passed
- [ ] No data loss beyond RPO
- [ ] Procedure documented and reproducible

**Operator Sign-off:**  
Name: _______________  
Signature: _______________  
Date: _______________  

**Reviewer Sign-off (if required):**  
Name: _______________  
Signature: _______________  
Date: _______________  

---

## Appendix: Commands Reference

### Quick Command Checklist

```bash
# 1. Retrieve backup
aws s3 cp s3://BUCKET/backup.sql.gpg /tmp/backup.sql.gpg

# 2. Verify checksum
sha256sum -c backup.sql.gpg.sha256

# 3. Decrypt
echo "$BACKUP_ENCRYPTION_KEY" | gpg --decrypt backup.sql.gpg > backup.sql

# 4. Stop app
docker stop taekwondo-tournament

# 5. Drop DB
psql -d postgres -c "DROP DATABASE taekwondo_tournament;"

# 6. Create DB
psql -d postgres -c "CREATE DATABASE taekwondo_tournament;"

# 7. Restore
pg_restore --dbname=$DATABASE_URL backup.sql

# 8. Migrate
npx prisma migrate deploy

# 9. Start app
docker start taekwondo-tournament

# 10. Verify
curl http://localhost:3001/api/health/ready
```

### Emergency Contacts

| Role | Name | Phone | Email |
|------|------|-------|-------|
| Primary Operator | _______________| _______________| _______________|
| Backup Operator | _______________| _______________| _______________|
| Infrastructure Owner | _______________| _______________| _______________|
| On-call Engineer | _______________| _______________| _______________|

---

**File this completed drill record at:** `/opt/bowin/restore-drills/YYYY-MM-DD-restore-drill.md`  
**Retention:** Keep all drill records for at least 1 year for audit purposes.
