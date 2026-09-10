# Backup & Recovery Guide

This document describes the backup and recovery procedures for Bowin Tournament OS.

## Backup Strategy

### Automated Daily Backups

Bowin uses encrypted PostgreSQL backups stored locally and optionally synced to off-host storage.

**Backup Schedule:**
- Daily backups at 2:00 AM server time (configurable via cron)
- Retention: 30 days (configurable via `RETENTION_DAYS`)
- Format: PostgreSQL custom format (compressed, parallel-restore capable)
- Encryption: AES-256 (GPG symmetric encryption)

### Backup Script

Location: `scripts/backup-database.sh`

**Usage:**
```bash
# Local backup only
./scripts/backup-database.sh

# Backup with off-host sync (S3 or rsync)
./scripts/backup-database.sh --off-host
```

**Required Environment Variables:**
```bash
DATABASE_URL          # PostgreSQL connection string
```

**Recommended Environment Variables:**
```bash
BACKUP_ENCRYPTION_KEY # GPG passphrase (generate with: openssl rand -base64 32)
                      # Optional: if not set, backup is created WITHOUT encryption
                      # (dev mode acceptable, production must encrypt)
```

**Optional (for off-host sync):**
```bash
BACKUP_S3_BUCKET      # S3 bucket name (e.g., my-bowin-backups)
BACKUP_RSYNC_TARGET   # rsync target (e.g., backup@remote.example.com:/backups)
```

**Configuration:**
```bash
BACKUP_DIR=/opt/bowin/backups  # Local backup storage
RETENTION_DAYS=30               # Delete backups older than this
```

---

## Setting Up Automated Backups

### Cron Job (Linux)

1. Edit the crontab:
   ```bash
   sudo crontab -e
   ```

2. Add the backup job:
   ```bash
   # Bowin daily backup at 2:00 AM with off-host sync
   0 2 * * * /opt/bowin/scripts/backup-database.sh --off-host >> /var/log/bowin-backup.log 2>&1
   ```

3. Verify the cron job:
   ```bash
   sudo crontab -l
   ```

### Docker Container (alternative)

If using a dedicated backup container:

```yaml
# docker-compose.yml
services:
  backup:
    image: postgres:16
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - BACKUP_ENCRYPTION_KEY=${BACKUP_ENCRYPTION_KEY}
      - BACKUP_S3_BUCKET=${BACKUP_S3_BUCKET}
    volumes:
      - ./scripts:/scripts
      - backup-storage:/opt/bowin/backups
    command: >
      sh -c "
        apk add --no-cache gnupg aws-cli &&
        /scripts/backup-database.sh --off-host
      "
    networks:
      - bowin-network

volumes:
  backup-storage:

networks:
  bowin-network:
    external: true
```

Then schedule via cron on the Docker host:
```bash
0 2 * * * docker compose -f /opt/bowin/docker-compose.yml run --rm backup
```

---

## Restoring from Backup

### Restore Script

Location: `scripts/restore-database.sh`

**Usage:**
```bash
./scripts/restore-database.sh /opt/bowin/backups/bowin-backup-20260909-143022.sql.gpg
```

**Required Environment Variables:**
```bash
DATABASE_URL          # Target PostgreSQL connection string
BACKUP_ENCRYPTION_KEY # Same GPG passphrase used for backup
```

**⚠️ WARNINGS:**
- The restore script will **DROP** the existing database and recreate it
- All existing data will be **permanently lost**
- Always test restores on a **staging database** first
- Verify the backup checksum before restoring

### Manual Restore Steps

If the restore script fails, or you need more control:

1. **Decrypt the backup:**
   ```bash
   echo "YOUR_BACKUP_ENCRYPTION_KEY" | gpg \
     --batch --yes --passphrase-fd 0 \
     --decrypt bowin-backup-20260909-143022.sql.gpg > backup.sql
   ```

2. **Drop and recreate the database:**
   ```bash
   psql -U taekwondo -d postgres -c "DROP DATABASE IF EXISTS taekwondo_tournament;"
   psql -U taekwondo -d postgres -c "CREATE DATABASE taekwondo_tournament;"
   ```

3. **Restore the backup:**
   ```bash
   pg_restore \
     --dbname=postgresql://taekwondo:***@localhost:5432/taekwondo_tournament \
     --verbose \
     --no-owner \
     --no-acl \
     backup.sql
   ```

4. **Run migrations (if schema changed):**
   ```bash
   cd /opt/bowin
   npx prisma migrate deploy
   ```

---

## Off-Host Backup Options

### Option 1: AWS S3

**Setup:**
1. Install AWS CLI:
   ```bash
   sudo apt-get install awscli
   ```

2. Configure AWS credentials:
   ```bash
   aws configure
   ```

3. Create an S3 bucket:
   ```bash
   aws s3 mb s3://my-bowin-backups
   ```

4. Set environment variable:
   ```bash
   export BACKUP_S3_BUCKET=my-bowin-backups
   ```

5. Run backup with off-host sync:
   ```bash
   ./scripts/backup-database.sh --off-host
   ```

**S3 Lifecycle Policy (optional):**
```json
{
  "Rules": [
    {
      "Id": "DeleteOldBackups",
      "Status": "Enabled",
      "Prefix": "bowin-backups/",
      "Expiration": {
        "Days": 90
      }
    }
  ]
}
```

### Option 2: rsync to Remote Server

**Setup:**
1. Set up SSH key authentication to remote server:
   ```bash
   ssh-keygen -t ed25519
   ssh-copy-id backup@remote.example.com
   ```

2. Test connection:
   ```bash
   ssh backup@remote.example.com "echo 'Connection successful'"
   ```

3. Set environment variable:
   ```bash
   export BACKUP_RSYNC_TARGET=backup@remote.example.com:/backups/bowin
   ```

4. Run backup with off-host sync:
   ```bash
   ./scripts/backup-database.sh --off-host
   ```

### Option 3: Other Cloud Storage (Backblaze B2, DigitalOcean Spaces, etc.)

Most S3-compatible storage works with the AWS CLI:

```bash
# Example for Backblaze B2
export AWS_ACCESS_KEY_ID=your_b2_key_id
export AWS_SECRET_ACCESS_KEY=your_b2_application_key
export BACKUP_S3_BUCKET=my-bowin-backups

# Override endpoint
aws s3 cp backup.sql.gpg s3://my-bowin-backups/ \
  --endpoint-url=https://s3.us-west-002.backblazeb2.com
```

---

## Backup Verification

### Weekly Restore Drills

**Recommendation:** Perform a full restore drill every week to verify:
1. Backups are being created correctly
2. Encryption/decryption works
3. Restore procedure is up-to-date
4. Recovery time objective (RTO) is acceptable

---

## Testing & Validation

### Automated Testing

**Fresh Migration Test:**
```bash
# Validates that fresh database reaches exact schema via migrate deploy
./scripts/test-fresh-migration.sh

# Runs in CI on every build
# Catches schema drift between prisma/schema.prisma and migrations
```

**Backup/Restore Integration Test:**
```bash
# End-to-end test: backup → encrypt → restore → verify
./scripts/test-backup-restore.sh

# Creates ephemeral test database
# Tests AES256 encryption/decryption
# Verifies data integrity after restore
```

**Integration Tests:**
```bash
# Regression tests for atomic restore rollback
BACKUP_RECOVERY_DATABASE_URL=postgresql://...test_db npm test -- backup-recovery.integration.test.ts

# 6 tests covering:
# - Rollback on division creation failure
# - Artifact retention on failure
# - Assignment/bracket recovery
# - Cleanup after success
```

### Manual Restore Drill

Use the comprehensive template at `docs/RESTORE-DRILL-TEMPLATE.md`:

**Restore Drill Checklist:**
1. [ ] Download most recent backup from off-host storage
2. [ ] Verify checksum matches
3. [ ] Restore to a staging database (never production)
4. [ ] Run smoke tests (check tournament count, user count, etc.)
5. [ ] Measure restore time
6. [ ] Document any issues or improvements

### Monitoring Backup Jobs

**Alert on backup failures:**
- Set up monitoring for backup job exit codes
- Alert if no backup created in the last 25 hours
- Alert if off-host sync fails

**Example (cron with email alerts):**
```bash
0 2 * * * /opt/bowin/scripts/backup-database.sh --off-host || echo "Backup failed!" | mail -s "Bowin Backup Alert" ops@example.com
```

---

## Disaster Recovery Scenarios

### Scenario 1: Database Corruption

**Symptoms:** Queries fail, data is inconsistent, Prisma errors

**Recovery:**
1. Stop the application server
2. Restore from the most recent backup
3. Run `prisma migrate deploy`
4. Restart the application server
5. Verify data integrity (check tournament count, recent registrations)

### Scenario 2: Accidental Data Deletion

**Symptoms:** User reports missing tournaments, competitors, or results

**Recovery:**
1. Identify the time window of the deletion
2. Restore from a backup taken BEFORE the deletion
3. Extract only the affected data (tournaments, competitors, etc.)
4. Manually merge the data back into the production database
5. Verify with the user that the data is restored

### Scenario 3: Server Hardware Failure

**Symptoms:** Server is unresponsive, cannot SSH, disk failure

**Recovery:**
1. Provision a new server
2. Install Docker, PostgreSQL, Node.js, and other dependencies
3. Download the most recent backup from off-host storage
4. Restore the database on the new server
5. Deploy the application code
6. Update DNS to point to the new server
7. Verify all services are running

### Scenario 4: Ransomware / Security Breach

**Symptoms:** Encrypted files, unauthorized access, data exfiltration

**Recovery:**
1. **Immediately** disconnect the server from the network
2. Preserve logs and forensic evidence
3. Restore from a backup taken BEFORE the breach
4. Rotate ALL secrets (JWT_SECRET, MAILGUN_API_KEY, DATABASE_URL password, etc.)
5. Audit user accounts for unauthorized access
6. Apply security patches and harden the server
7. Monitor for suspicious activity

---

## Backup Security

### Encryption Key Management

**⚠️ CRITICAL:** The `BACKUP_ENCRYPTION_KEY` is the ONLY thing protecting your backups. If you lose it, your backups are permanently unrecoverable.

**Best Practices:**
1. Store the encryption key in a **secure password manager** (1Password, LastPass, Bitwarden)
2. Keep an encrypted copy in a **physical safe** (printed on paper)
3. Share the key with **at least one other trusted person** (co-founder, CTO, etc.)
4. **Never** commit the key to git, store it in plaintext files, or send it via unencrypted email
5. Rotate the key annually (and re-encrypt all backups with the new key)

### Off-Host Storage Security

**S3:**
- Enable bucket encryption (AES-256 or AWS KMS)
- Use bucket policies to restrict access by IP
- Enable versioning (so deleted backups can be recovered)
- Enable MFA delete (prevents accidental/malicious deletion)

**rsync:**
- Use SSH key authentication (never passwords)
- Restrict SSH key to backup user only (no shell access)
- Store backups in an encrypted filesystem (LUKS, eCryptfs)

---

## Recovery Time Objectives (RTO)

| Scenario | Target RTO | Notes |
|----------|-----------|-------|
| Database corruption | < 15 minutes | Restore from local backup |
| Accidental deletion | < 30 minutes | Restore + selective merge |
| Server failure | < 2 hours | Provision new server + restore |
| Ransomware | < 4 hours | Full server rebuild + restore |

**Actual RTO will depend on:**
- Backup file size (typically 100MB-1GB for 1,000 tournaments)
- Network speed (for off-host download)
- Database restore speed (typically 5-10 minutes for 1GB backup)

---

## Contact Information

**Backup/Recovery Owner:** [Name, email]  
**Escalation:** [CTO or senior engineer]  
**Off-hours emergency:** [Phone number]

---

## References

- [PostgreSQL Backup & Restore](https://www.postgresql.org/docs/current/backup.html)
- [GPG Encryption](https://www.gnupg.org/gph/en/manual.html)
- [AWS S3 Lifecycle Policies](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html)
- [rsync Documentation](https://rsync.samba.org/documentation.html)
