#!/usr/bin/env bash
#
# Bowin Tournament OS — Database Backup Script
#
# Creates encrypted PostgreSQL backups with timestamps. Stores them locally
# and optionally syncs to off-host storage (S3, rsync, etc.).
#
# Usage:
#   ./scripts/backup-database.sh [--off-host]
#
# Requirements:
#   - pg_dump (PostgreSQL client tools)
#   - gpg (for encryption)
#   - (optional) aws CLI or rsync for off-host storage
#
# Environment Variables:
#   DATABASE_URL          - PostgreSQL connection string
#   BACKUP_ENCRYPTION_KEY - GPG passphrase for backup encryption
#   BACKUP_S3_BUCKET      - (optional) S3 bucket for off-host backups
#   BACKUP_RSYNC_TARGET   - (optional) rsync target (user@host:/path)
#
# Exit codes:
#   0 - Success
#   1 - Missing required environment variables
#   2 - Backup failed (pg_dump error)
#   3 - Encryption failed
#   4 - Off-host sync failed

set -euo pipefail

# Configuration
BACKUP_DIR="${BACKUP_DIR:-/opt/bowin/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="bowin-backup-${TIMESTAMP}.sql"
ENCRYPTED_FILE="${BACKUP_FILE}.gpg"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[backup]${NC} $*"
}

warn() {
    echo -e "${YELLOW}[backup]${NC} $*"
}

error() {
    echo -e "${RED}[backup]${NC} $*" >&2
}

# Parse arguments
OFF_HOST=false
if [[ "${1:-}" == "--off-host" ]]; then
    OFF_HOST=true
fi

# Check required environment variables
if [[ -z "${DATABASE_URL:-}" ]]; then
    error "DATABASE_URL is not set"
    exit 1
fi

# BACKUP_ENCRYPTION_KEY is optional (warn if missing)
if [[ -z "${BACKUP_ENCRYPTION_KEY:-}" ]]; then
    warn "BACKUP_ENCRYPTION_KEY is not set"
    warn "Backup will be created WITHOUT encryption"
    warn "For production use, generate a key: openssl rand -base64 32"
fi

# Create backup directory if it doesn't exist
mkdir -p "${BACKUP_DIR}"
cd "${BACKUP_DIR}"

log "Starting backup at $(date)"

# Extract database details from DATABASE_URL
# Format: postgresql://user:pass@host:port/dbname
if [[ ! "${DATABASE_URL}" =~ ^postgresql://([^:]+):([^@]+)@([^:]+):([0-9]+)/(.+)$ ]]; then
    error "Invalid DATABASE_URL format"
    exit 1
fi

DB_USER="${BASH_REMATCH[1]}"
DB_PASS="${BASH_REMATCH[2]}"
DB_HOST="${BASH_REMATCH[3]}"
DB_PORT="${BASH_REMATCH[4]}"
DB_NAME="${BASH_REMATCH[5]}"

# Create backup
log "Dumping database ${DB_NAME} from ${DB_HOST}:${DB_PORT}..."
if PGPASSWORD="${DB_PASS}" pg_dump \
    --host="${DB_HOST}" \
    --port="${DB_PORT}" \
    --username="${DB_USER}" \
    --dbname="${DB_NAME}" \
    --format=custom \
    --file="${BACKUP_FILE}" \
    --verbose \
    --no-owner \
    --no-acl 2>&1 | grep -v "^pg_dump:"; then
    log "Database dump completed: ${BACKUP_FILE}"
else
    error "pg_dump failed"
    exit 2
fi

# Get backup size
BACKUP_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
log "Backup size: ${BACKUP_SIZE}"

# Encrypt backup (only if encryption key is set)
if [[ -n "${BACKUP_ENCRYPTION_KEY}" ]]; then
    log "Encrypting backup..."
    if echo "${BACKUP_ENCRYPTION_KEY}" | gpg \
        --batch \
        --yes \
        --passphrase-fd 0 \
        --symmetric \
        --cipher-algo AES256 \
        --output "${ENCRYPTED_FILE}" \
        "${BACKUP_FILE}"; then
        log "Backup encrypted: ${ENCRYPTED_FILE}"
        # Remove unencrypted backup
        rm -f "${BACKUP_FILE}"
    else
        error "Encryption failed"
        exit 3
    fi
else
    warn "BACKUP_ENCRYPTION_KEY not set - backup is unencrypted"
    warn "Set BACKUP_ENCRYPTION_KEY to enable encryption"
    # Rename to indicate unencrypted
    mv "${BACKUP_FILE}" "${BACKUP_FILE}.UNENCRYPTED"
    ENCRYPTED_FILE="${BACKUP_FILE}.UNENCRYPTED"
fi

# Calculate checksum
CHECKSUM=$(sha256sum "${ENCRYPTED_FILE}" | cut -d' ' -f1)
echo "${CHECKSUM}  ${ENCRYPTED_FILE}" > "${ENCRYPTED_FILE}.sha256"
log "Checksum: ${CHECKSUM}"

# Off-host sync (optional)
if [[ "${OFF_HOST}" == true ]]; then
    log "Syncing to off-host storage..."
    
    if [[ -n "${BACKUP_S3_BUCKET:-}" ]]; then
        log "Uploading to S3: ${BACKUP_S3_BUCKET}"
        if aws s3 cp "${ENCRYPTED_FILE}" "s3://${BACKUP_S3_BUCKET}/bowin-backups/${ENCRYPTED_FILE}"; then
            log "S3 upload successful"
        else
            error "S3 upload failed"
            exit 4
        fi
    elif [[ -n "${BACKUP_RSYNC_TARGET:-}" ]]; then
        log "Syncing via rsync: ${BACKUP_RSYNC_TARGET}"
        if rsync -avz --progress "${ENCRYPTED_FILE}" "${BACKUP_RSYNC_TARGET}/"; then
            log "rsync successful"
        else
            error "rsync failed"
            exit 4
        fi
    else
        warn "Off-host sync requested but no target configured"
        warn "Set BACKUP_S3_BUCKET or BACKUP_RSYNC_TARGET"
    fi
fi

# Clean up old backups (local only)
log "Cleaning up backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -name "bowin-backup-*.sql.gpg" -mtime "+${RETENTION_DAYS}" -delete
find "${BACKUP_DIR}" -name "bowin-backup-*.sql.gpg.sha256" -mtime "+${RETENTION_DAYS}" -delete
log "Cleanup complete"

log "Backup completed successfully at $(date)"
log "Backup file: ${BACKUP_DIR}/${ENCRYPTED_FILE}"
log "To restore: gpg --decrypt ${ENCRYPTED_FILE} | pg_restore --dbname=\$DATABASE_URL"

exit 0
