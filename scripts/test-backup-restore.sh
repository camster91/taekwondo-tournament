#!/usr/bin/env bash
#
# Backup & Restore Integration Test
#
# Tests the complete backup/restore cycle with encryption in an ephemeral database.
# This validates the automation path documented in BACKUP-RECOVERY.md.
#
# Usage:
#   ./scripts/test-backup-restore.sh
#
# Exit codes:
#   0 - Success
#   1 - Backup failed
#   2 - Restore failed
#   3 - Data verification failed

set -euo pipefail

# Configuration
TEST_DB_NAME="taekwondo_test_backup_$(date +%s)"
BACKUP_FILE="/tmp/test-backup-$(date +%s).sql.gpg"
BACKUP_ENCRYPTION_KEY="test-encryption-key-min-32-chars-xxxxxxxxxxxxx"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[backup-test]${NC} $*"
}

warn() {
    echo -e "${YELLOW}[backup-test]${NC} $*"
}

error() {
    echo -e "${RED}[backup-test]${NC} $*" >&2
}

# Check required environment
if [[ -z "${DATABASE_URL:-}" ]]; then
    error "DATABASE_URL is not set"
    exit 3
fi

# Extract connection details
if [[ ! "${DATABASE_URL}" =~ ^postgresql://([^:]+):([^@]+)@([^:]+):([0-9]+)/(.+)$ ]]; then
    error "Invalid DATABASE_URL format"
    exit 3
fi

DB_USER="${BASH_REMATCH[1]}"
DB_PASS="${BASH_REMATCH[2]}"
DB_HOST="${BASH_REMATCH[3]}"
DB_PORT="${BASH_REMATCH[4]}"

log "Setting up test database: ${TEST_DB_NAME}"

# Cleanup function
cleanup() {
    log "Cleaning up..."
    PGPASSWORD="${DB_PASS}" psql \
        --host="${DB_HOST}" \
        --port="${DB_PORT}" \
        --username="${DB_USER}" \
        --dbname=postgres \
        --command="DROP DATABASE IF EXISTS ${TEST_DB_NAME};" 2>/dev/null || warn "Failed to drop test database"
    
    rm -f "${BACKUP_FILE}" "${BACKUP_FILE}.sha256" /tmp/test-backup-decrypted.sql
}

trap cleanup EXIT

# Create and populate test database
PGPASSWORD="${DB_PASS}" psql \
    --host="${DB_HOST}" \
    --port="${DB_PORT}" \
    --username="${DB_USER}" \
    --dbname=postgres \
    --command="CREATE DATABASE ${TEST_DB_NAME};"

TEST_DB_URL="postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${TEST_DB_NAME}"

log "Running migrations..."
DATABASE_URL="${TEST_DB_URL}" npx prisma migrate deploy > /dev/null 2>&1

log "Inserting test data..."
PGPASSWORD="${DB_PASS}" psql \
    --host="${DB_HOST}" \
    --port="${DB_PORT}" \
    --username="${DB_USER}" \
    --dbname="${TEST_DB_NAME}" \
    --command="
        INSERT INTO \"Tournament\" (id, name, date, status, \"createdAt\", \"updatedAt\")
        VALUES ('test-tournament-1', 'Test Tournament', '2030-01-01', 'draft', NOW(), NOW());
        
        INSERT INTO \"Tournament\" (id, name, date, status, \"createdAt\", \"updatedAt\")
        VALUES ('test-tournament-2', 'Second Tournament', '2030-02-01', 'registration', NOW(), NOW());
    " > /dev/null

# Verify test data
ORIGINAL_COUNT=$(PGPASSWORD="${DB_PASS}" psql \
    --host="${DB_HOST}" \
    --port="${DB_PORT}" \
    --username="${DB_USER}" \
    --dbname="${TEST_DB_NAME}" \
    --tuples-only \
    --no-align \
    --command="SELECT COUNT(*) FROM \"Tournament\";")

log "Test data inserted: ${ORIGINAL_COUNT} tournaments"

# === Test Backup ===
log "Creating encrypted backup..."
TEMP_BACKUP="/tmp/test-backup-plain-$(date +%s).sql"
if PGPASSWORD="${DB_PASS}" pg_dump \
    --host="${DB_HOST}" \
    --port="${DB_PORT}" \
    --username="${DB_USER}" \
    --dbname="${TEST_DB_NAME}" \
    --format=custom \
    --no-owner \
    --no-acl \
    --file="${TEMP_BACKUP}"; then
    log "Plain backup created"
else
    error "Backup failed"
    exit 1
fi

log "Encrypting backup..."
if echo "${BACKUP_ENCRYPTION_KEY}" | gpg \
    --batch \
    --yes \
    --passphrase-fd 0 \
    --symmetric \
    --cipher-algo AES256 \
    --output "${BACKUP_FILE}" \
    "${TEMP_BACKUP}"; then
    log "Backup encrypted: ${BACKUP_FILE}"
    rm -f "${TEMP_BACKUP}"
else
    error "Encryption failed"
    rm -f "${TEMP_BACKUP}"
    exit 1
fi

# Calculate checksum
CHECKSUM=$(sha256sum "${BACKUP_FILE}" | cut -d' ' -f1)
echo "${CHECKSUM}  ${BACKUP_FILE}" > "${BACKUP_FILE}.sha256"
log "Checksum: ${CHECKSUM}"

# Verify backup file exists and is not empty
if [[ ! -s "${BACKUP_FILE}" ]]; then
    error "Backup file is empty or missing"
    exit 1
fi

BACKUP_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
log "Backup size: ${BACKUP_SIZE}"

# === Test Decryption ===
log "Testing decryption..."
if echo "${BACKUP_ENCRYPTION_KEY}" | gpg \
    --batch \
    --yes \
    --passphrase-fd 0 \
    --decrypt \
    --output /tmp/test-backup-decrypted.sql \
    "${BACKUP_FILE}"; then
    log "Decryption successful"
else
    error "Decryption failed"
    exit 1
fi

# === Test Restore ===
log "Dropping test database..."
PGPASSWORD="${DB_PASS}" psql \
    --host="${DB_HOST}" \
    --port="${DB_PORT}" \
    --username="${DB_USER}" \
    --dbname=postgres \
    --command="DROP DATABASE ${TEST_DB_NAME};"

log "Recreating test database..."
PGPASSWORD="${DB_PASS}" psql \
    --host="${DB_HOST}" \
    --port="${DB_PORT}" \
    --username="${DB_USER}" \
    --dbname=postgres \
    --command="CREATE DATABASE ${TEST_DB_NAME};"

log "Restoring from backup..."
if PGPASSWORD="${DB_PASS}" pg_restore \
    --host="${DB_HOST}" \
    --port="${DB_PORT}" \
    --username="${DB_USER}" \
    --dbname="${TEST_DB_NAME}" \
    --verbose \
    --no-owner \
    --no-acl \
    /tmp/test-backup-decrypted.sql 2>&1 | grep -v "^pg_restore:"; then
    log "Restore completed"
else
    warn "Restore completed with warnings (normal for pg_restore)"
fi

# === Verify Restored Data ===
log "Verifying restored data..."
RESTORED_COUNT=$(PGPASSWORD="${DB_PASS}" psql \
    --host="${DB_HOST}" \
    --port="${DB_PORT}" \
    --username="${DB_USER}" \
    --dbname="${TEST_DB_NAME}" \
    --tuples-only \
    --no-align \
    --command="SELECT COUNT(*) FROM \"Tournament\";" 2>/dev/null || echo "0")

if [[ "${RESTORED_COUNT}" != "${ORIGINAL_COUNT}" ]]; then
    error "Data verification failed: expected ${ORIGINAL_COUNT} tournaments, got ${RESTORED_COUNT}"
    exit 3
fi

log "Data verification passed: ${RESTORED_COUNT} tournaments restored"

# Verify specific records
TOURNAMENT_1=$(PGPASSWORD="${DB_PASS}" psql \
    --host="${DB_HOST}" \
    --port="${DB_PORT}" \
    --username="${DB_USER}" \
    --dbname="${TEST_DB_NAME}" \
    --tuples-only \
    --no-align \
    --command="SELECT name FROM \"Tournament\" WHERE id = 'test-tournament-1';" 2>/dev/null || echo "")

if [[ "${TOURNAMENT_1}" != "Test Tournament" ]]; then
    error "Record verification failed: tournament not found or name mismatch"
    exit 3
fi

log "Record verification passed: '${TOURNAMENT_1}'"

log "✅ All backup/restore tests passed"
log ""
log "Summary:"
log "  - Backup created and encrypted: ${BACKUP_SIZE}"
log "  - Decryption verified"
log "  - Restore completed successfully"
log "  - Data integrity confirmed: ${RESTORED_COUNT} records"
log ""
log "Backup file: ${BACKUP_FILE}"
log "To decrypt manually: gpg --decrypt ${BACKUP_FILE} | pg_restore --dbname=\$DATABASE_URL"

exit 0
