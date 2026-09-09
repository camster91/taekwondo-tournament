#!/usr/bin/env bash
#
# Bowin Tournament OS — Database Restore Script
#
# Restores an encrypted PostgreSQL backup created by backup-database.sh
#
# Usage:
#   ./scripts/restore-database.sh <encrypted-backup-file>
#
# Example:
#   ./scripts/restore-database.sh /opt/bowin/backups/bowin-backup-20260909-143022.sql.gpg
#
# Requirements:
#   - pg_restore (PostgreSQL client tools)
#   - gpg (for decryption)
#
# Environment Variables:
#   DATABASE_URL          - PostgreSQL connection string (target database)
#   BACKUP_ENCRYPTION_KEY - GPG passphrase for backup decryption
#
# WARNINGS:
#   - This script will DROP the existing database and recreate it
#   - Always test restores on a separate staging database first
#   - Verify the backup checksum before restoring
#
# Exit codes:
#   0 - Success
#   1 - Missing required arguments or environment variables
#   2 - Backup file not found or checksum mismatch
#   3 - Decryption failed
#   4 - Restore failed

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[restore]${NC} $*"
}

warn() {
    echo -e "${YELLOW}[restore]${NC} $*"
}

error() {
    echo -e "${RED}[restore]${NC} $*" >&2
}

# Check arguments
if [[ $# -lt 1 ]]; then
    error "Usage: $0 <encrypted-backup-file>"
    error "Example: $0 /opt/bowin/backups/bowin-backup-20260909-143022.sql.gpg"
    exit 1
fi

ENCRYPTED_FILE="$1"

# Check required environment variables
if [[ -z "${DATABASE_URL:-}" ]]; then
    error "DATABASE_URL is not set"
    exit 1
fi

if [[ -z "${BACKUP_ENCRYPTION_KEY:-}" ]]; then
    error "BACKUP_ENCRYPTION_KEY is not set"
    exit 1
fi

# Check if backup file exists
if [[ ! -f "${ENCRYPTED_FILE}" ]]; then
    error "Backup file not found: ${ENCRYPTED_FILE}"
    exit 2
fi

# Verify checksum if .sha256 file exists
CHECKSUM_FILE="${ENCRYPTED_FILE}.sha256"
if [[ -f "${CHECKSUM_FILE}" ]]; then
    log "Verifying backup checksum..."
    if sha256sum --check "${CHECKSUM_FILE}"; then
        log "Checksum verified"
    else
        error "Checksum verification failed"
        error "Backup file may be corrupted"
        exit 2
    fi
else
    warn "No checksum file found (${CHECKSUM_FILE})"
    warn "Proceeding without verification"
fi

# Extract database details from DATABASE_URL
if [[ ! "${DATABASE_URL}" =~ ^postgresql://([^:]+):([^@]+)@([^:]+):([0-9]+)/(.+)$ ]]; then
    error "Invalid DATABASE_URL format"
    exit 1
fi

DB_USER="${BASH_REMATCH[1]}"
DB_PASS="${BASH_REMATCH[2]}"
DB_HOST="${BASH_REMATCH[3]}"
DB_PORT="${BASH_REMATCH[4]}"
DB_NAME="${BASH_REMATCH[5]}"

log "Restore target: ${DB_NAME} at ${DB_HOST}:${DB_PORT}"
warn "This will DROP and recreate the database: ${DB_NAME}"
warn "All existing data will be lost!"
echo -n "Continue? (yes/no): "
read -r CONFIRM

if [[ "${CONFIRM}" != "yes" ]]; then
    error "Restore cancelled by user"
    exit 1
fi

# Create temporary directory for decrypted backup
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "${TEMP_DIR}"' EXIT
DECRYPTED_FILE="${TEMP_DIR}/backup.sql"

# Decrypt backup
log "Decrypting backup..."
if echo "${BACKUP_ENCRYPTION_KEY}" | gpg \
    --batch \
    --yes \
    --passphrase-fd 0 \
    --decrypt \
    --output "${DECRYPTED_FILE}" \
    "${ENCRYPTED_FILE}"; then
    log "Backup decrypted"
else
    error "Decryption failed"
    exit 3
fi

# Drop existing database and recreate
log "Dropping existing database..."
PGPASSWORD="${DB_PASS}" psql \
    --host="${DB_HOST}" \
    --port="${DB_PORT}" \
    --username="${DB_USER}" \
    --dbname=postgres \
    --command="DROP DATABASE IF EXISTS ${DB_NAME};"

log "Creating fresh database..."
PGPASSWORD="${DB_PASS}" psql \
    --host="${DB_HOST}" \
    --port="${DB_PORT}" \
    --username="${DB_USER}" \
    --dbname=postgres \
    --command="CREATE DATABASE ${DB_NAME};"

# Restore backup
log "Restoring backup..."
if PGPASSWORD="${DB_PASS}" pg_restore \
    --host="${DB_HOST}" \
    --port="${DB_PORT}" \
    --username="${DB_USER}" \
    --dbname="${DB_NAME}" \
    --verbose \
    --no-owner \
    --no-acl \
    "${DECRYPTED_FILE}"; then
    log "Database restored successfully"
else
    error "pg_restore failed"
    exit 4
fi

# Verify restoration
log "Verifying restoration..."
ROW_COUNT=$(PGPASSWORD="${DB_PASS}" psql \
    --host="${DB_HOST}" \
    --port="${DB_PORT}" \
    --username="${DB_USER}" \
    --dbname="${DB_NAME}" \
    --tuples-only \
    --no-align \
    --command="SELECT COUNT(*) FROM \"Tournament\";")

log "Restored ${ROW_COUNT} tournaments"

log "Restore completed successfully at $(date)"
log "Remember to run: prisma migrate deploy"

exit 0
