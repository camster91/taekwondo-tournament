#!/usr/bin/env bash
#
# Bowin Tournament OS — Database Restore Script
#
# Restores a PostgreSQL backup created by backup-database.sh: either the
# encrypted `.sql.gpg` file or the `.sql.UNENCRYPTED` file it writes when no
# BACKUP_ENCRYPTION_KEY is configured.
#
# Usage:
#   ./scripts/restore-database.sh <backup-file>
#
# Example:
#   ./scripts/restore-database.sh /opt/bowin/backups/bowin-backup-20260909-143022.sql.gpg
#
# Requirements:
#   - pg_restore, psql (PostgreSQL client tools)
#   - gpg (only for encrypted backups)
#
# Environment Variables:
#   DATABASE_URL          - PostgreSQL connection string (target database)
#   BACKUP_ENCRYPTION_KEY - GPG passphrase (required for .gpg backups only)
#   RESTORE_ASSUME_YES    - set to 1 to skip the interactive confirmation
#
# Safety:
#   - The backup is decrypted and validated (pg_restore --list) before
#     anything in the database server is touched.
#   - It is restored into a temporary database first. Only when that restore
#     succeeds is the live database renamed to <db>_pre_restore_<timestamp>
#     and the temporary database renamed into its place. A failed restore
#     leaves the live database untouched.
#   - The previous database is kept; drop it once the restore is verified.
#   - Always test restores on a separate staging database first.
#
# Exit codes:
#   0 - Success
#   1 - Missing required arguments or environment variables
#   2 - Backup file not found or checksum mismatch
#   3 - Decryption failed or the file is not a valid pg_dump archive
#   4 - Restore failed (live database untouched)

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
    error "Usage: $0 <backup-file>"
    error "Example: $0 /opt/bowin/backups/bowin-backup-20260909-143022.sql.gpg"
    exit 1
fi

BACKUP_PATH="$1"

# Check required environment variables
if [[ -z "${DATABASE_URL:-}" ]]; then
    error "DATABASE_URL is not set"
    exit 1
fi

# Check if backup file exists
if [[ ! -f "${BACKUP_PATH}" ]]; then
    error "Backup file not found: ${BACKUP_PATH}"
    exit 2
fi

ENCRYPTED=true
case "${BACKUP_PATH}" in
    *.gpg) ENCRYPTED=true ;;
    *.UNENCRYPTED) ENCRYPTED=false ;;
    *)
        # Otherwise sniff: a custom-format pg_dump archive starts with "PGDMP".
        if [[ "$(head -c 5 "${BACKUP_PATH}")" == "PGDMP" ]]; then
            ENCRYPTED=false
        fi
        ;;
esac

if [[ "${ENCRYPTED}" == true && -z "${BACKUP_ENCRYPTION_KEY:-}" ]]; then
    error "BACKUP_ENCRYPTION_KEY is not set (required to decrypt ${BACKUP_PATH})"
    exit 1
fi

# Verify checksum if .sha256 file exists (it records the bare file name, so
# check from the backup's own directory)
CHECKSUM_FILE="${BACKUP_PATH}.sha256"
if [[ -f "${CHECKSUM_FILE}" ]]; then
    log "Verifying backup checksum..."
    if (cd "$(dirname "${BACKUP_PATH}")" && sha256sum --check "$(basename "${CHECKSUM_FILE}")"); then
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

# Extract database details from DATABASE_URL. A Prisma-style query string
# (?schema=public) is not part of the database name.
if [[ ! "${DATABASE_URL}" =~ ^postgresql://([^:]+):([^@]+)@([^:/]+):([0-9]+)/([^?]+)(\?.*)?$ ]]; then
    error "Invalid DATABASE_URL format"
    exit 1
fi

DB_USER="${BASH_REMATCH[1]}"
DB_PASS="${BASH_REMATCH[2]}"
DB_HOST="${BASH_REMATCH[3]}"
DB_PORT="${BASH_REMATCH[4]}"
DB_NAME="${BASH_REMATCH[5]}"

# The name is interpolated into SQL identifiers below.
if [[ ! "${DB_NAME}" =~ ^[A-Za-z0-9_]+$ ]]; then
    error "Unsupported database name '${DB_NAME}' (letters, digits and _ only)"
    exit 1
fi

RESTORE_TS=$(date +%Y%m%d%H%M%S)
TEMP_DB="${DB_NAME}_restore_${RESTORE_TS}"
OLD_DB="${DB_NAME}_pre_restore_${RESTORE_TS}"

psql_admin() {
    PGPASSWORD="${DB_PASS}" psql \
        --host="${DB_HOST}" \
        --port="${DB_PORT}" \
        --username="${DB_USER}" \
        --dbname=postgres \
        --set=ON_ERROR_STOP=1 \
        --quiet \
        "$@"
}

# Temporary directory for the decrypted backup; the temporary database is
# dropped on any exit before the swap completes.
TEMP_DIR=$(mktemp -d)
TEMP_DB_CREATED=false
cleanup() {
    rm -rf "${TEMP_DIR}"
    if [[ "${TEMP_DB_CREATED}" == true ]]; then
        warn "Dropping temporary database ${TEMP_DB}"
        psql_admin --command="DROP DATABASE IF EXISTS \"${TEMP_DB}\";" || \
            warn "Could not drop ${TEMP_DB}; drop it manually"
    fi
}
trap cleanup EXIT

# Decrypt backup (before anything destructive)
if [[ "${ENCRYPTED}" == true ]]; then
    DUMP_FILE="${TEMP_DIR}/backup.dump"
    log "Decrypting backup..."
    if echo "${BACKUP_ENCRYPTION_KEY}" | gpg \
        --batch \
        --yes \
        --passphrase-fd 0 \
        --decrypt \
        --output "${DUMP_FILE}" \
        "${BACKUP_PATH}"; then
        log "Backup decrypted"
    else
        error "Decryption failed"
        exit 3
    fi
else
    warn "Backup is NOT encrypted: ${BACKUP_PATH}"
    DUMP_FILE="${BACKUP_PATH}"
fi

# Validate the archive (before anything destructive)
log "Validating backup archive..."
if ! pg_restore --list "${DUMP_FILE}" >"${TEMP_DIR}/toc.txt" 2>"${TEMP_DIR}/toc.err"; then
    error "Backup is not a valid pg_dump archive:"
    cat "${TEMP_DIR}/toc.err" >&2 || true
    exit 3
fi
log "Archive valid ($(grep -c 'TABLE DATA' "${TEMP_DIR}/toc.txt" || true) table data entries)"

log "Restore target: ${DB_NAME} at ${DB_HOST}:${DB_PORT}"
warn "The backup is restored into ${TEMP_DB} first; on success ${DB_NAME}"
warn "is renamed to ${OLD_DB} and replaced. Connected clients are disconnected."
if [[ "${RESTORE_ASSUME_YES:-}" != "1" ]]; then
    echo -n "Continue? (yes/no): "
    read -r CONFIRM
    if [[ "${CONFIRM}" != "yes" ]]; then
        error "Restore cancelled by user"
        exit 1
    fi
fi

# Restore into a temporary database
log "Creating temporary database ${TEMP_DB}..."
psql_admin --command="CREATE DATABASE \"${TEMP_DB}\";"
TEMP_DB_CREATED=true

log "Restoring backup into ${TEMP_DB}..."
if PGPASSWORD="${DB_PASS}" pg_restore \
    --host="${DB_HOST}" \
    --port="${DB_PORT}" \
    --username="${DB_USER}" \
    --dbname="${TEMP_DB}" \
    --exit-on-error \
    --no-owner \
    --no-acl \
    "${DUMP_FILE}" 2>"${TEMP_DIR}/restore.err"; then
    log "Backup restored into ${TEMP_DB}"
else
    error "pg_restore failed; ${DB_NAME} was not modified:"
    tail -n 20 "${TEMP_DIR}/restore.err" >&2 || true
    exit 4
fi

# Verify restoration before the swap
if ! ROW_COUNT=$(PGPASSWORD="${DB_PASS}" psql \
    --host="${DB_HOST}" \
    --port="${DB_PORT}" \
    --username="${DB_USER}" \
    --dbname="${TEMP_DB}" \
    --tuples-only \
    --no-align \
    --command="SELECT COUNT(*) FROM \"Tournament\";"); then
    error "Restored database has no readable \"Tournament\" table; ${DB_NAME} was not modified"
    exit 4
fi
log "Restored ${ROW_COUNT} tournaments"

# Swap: disconnect clients, rename live -> old, temp -> live
log "Swapping ${TEMP_DB} into place..."
LIVE_EXISTS=$(psql_admin --tuples-only --no-align \
    --command="SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}';")
if [[ "${LIVE_EXISTS}" == "1" ]]; then
    psql_admin --command="SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();" >/dev/null
    psql_admin --command="ALTER DATABASE \"${DB_NAME}\" RENAME TO \"${OLD_DB}\";"
    log "Previous database kept as ${OLD_DB}"
fi
if ! psql_admin --command="ALTER DATABASE \"${TEMP_DB}\" RENAME TO \"${DB_NAME}\";"; then
    error "Could not rename ${TEMP_DB} to ${DB_NAME}"
    if [[ "${LIVE_EXISTS}" == "1" ]]; then
        psql_admin --command="ALTER DATABASE \"${OLD_DB}\" RENAME TO \"${DB_NAME}\";" && \
            warn "Previous database renamed back to ${DB_NAME}"
    fi
    exit 4
fi
TEMP_DB_CREATED=false

log "Restore completed successfully at $(date)"
if [[ "${LIVE_EXISTS}" == "1" ]]; then
    log "Once verified, drop the previous database: DROP DATABASE \"${OLD_DB}\";"
fi
log "Remember to run: prisma migrate deploy"

exit 0
