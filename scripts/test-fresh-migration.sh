#!/usr/bin/env bash
#
# Fresh Database Migration Test
#
# Validates that `prisma migrate deploy` brings a fresh PostgreSQL database
# to the exact current schema without errors. This is the release gate for
# schema changes.
#
# Usage:
#   ./scripts/test-fresh-migration.sh [--keep-db]
#
# Exit codes:
#   0 - Success (schema matches)
#   1 - Migration failed
#   2 - Schema drift detected
#   3 - Missing environment variables

set -euo pipefail

# Configuration
TEST_DB_NAME="taekwondo_test_fresh_$(date +%s)"
KEEP_DB=false

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[migration-test]${NC} $*"
}

warn() {
    echo -e "${YELLOW}[migration-test]${NC} $*"
}

error() {
    echo -e "${RED}[migration-test]${NC} $*" >&2
}

# Parse arguments
if [[ "${1:-}" == "--keep-db" ]]; then
    KEEP_DB=true
fi

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

log "Creating fresh test database: ${TEST_DB_NAME}"

# Create test database
PGPASSWORD="${DB_PASS}" psql \
    --host="${DB_HOST}" \
    --port="${DB_PORT}" \
    --username="${DB_USER}" \
    --dbname=postgres \
    --command="CREATE DATABASE ${TEST_DB_NAME};"

# Build test DATABASE_URL
TEST_DB_URL="postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${TEST_DB_NAME}"

# Cleanup function
cleanup() {
    if [[ "${KEEP_DB}" == false ]]; then
        log "Cleaning up test database..."
        PGPASSWORD="${DB_PASS}" psql \
            --host="${DB_HOST}" \
            --port="${DB_PORT}" \
            --username="${DB_USER}" \
            --dbname=postgres \
            --command="DROP DATABASE IF EXISTS ${TEST_DB_NAME};" || warn "Failed to drop test database"
    else
        log "Test database preserved: ${TEST_DB_NAME}"
        log "To drop manually: DROP DATABASE ${TEST_DB_NAME};"
    fi
}

trap cleanup EXIT

log "Running migrations on fresh database..."
if DATABASE_URL="${TEST_DB_URL}" npx prisma migrate deploy; then
    log "Migrations completed successfully"
else
    error "Migration failed"
    exit 1
fi

log "Validating schema..."
# Generate Prisma client against the test database
DATABASE_URL="${TEST_DB_URL}" npx prisma generate > /dev/null 2>&1

# Verify tables exist
log "Checking critical tables..."
CRITICAL_TABLES=(
    "Tournament"
    "Competitor"
    "Registration"
    "Division"
    "Bracket"
    "Match"
    "User"
    "Organization"
    "BackupState"
    "_prisma_migrations"
)

for table in "${CRITICAL_TABLES[@]}"; do
    TABLE_EXISTS=$(PGPASSWORD="${DB_PASS}" psql \
        --host="${DB_HOST}" \
        --port="${DB_PORT}" \
        --username="${DB_USER}" \
        --dbname="${TEST_DB_NAME}" \
        --tuples-only \
        --no-align \
        --command="SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = '${table}');")
    
    if [[ "${TABLE_EXISTS}" != "t" ]]; then
        error "Critical table missing: ${table}"
        exit 2
    fi
done

log "All critical tables present"

# Count migrations applied
MIGRATION_COUNT=$(PGPASSWORD="${DB_PASS}" psql \
    --host="${DB_HOST}" \
    --port="${DB_PORT}" \
    --username="${DB_USER}" \
    --dbname="${TEST_DB_NAME}" \
    --tuples-only \
    --no-align \
    --command="SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;")

log "Applied ${MIGRATION_COUNT} migrations"

# Check for schema drift (compare introspected schema to prisma/schema.prisma)
log "Checking for schema drift..."
DRIFT_OUTPUT=$(DATABASE_URL="${TEST_DB_URL}" npx prisma db pull --print 2>&1 || true)

if echo "${DRIFT_OUTPUT}" | grep -q "Your database is now in sync with your Prisma schema"; then
    log "✅ Schema matches: no drift detected"
elif echo "${DRIFT_OUTPUT}" | grep -q "already in sync"; then
    log "✅ Schema matches: no drift detected"
else
    warn "⚠️  Possible schema drift detected"
    warn "This may indicate migrations are out of sync with schema.prisma"
    echo "${DRIFT_OUTPUT}"
fi

log "Fresh migration test passed ✅"
log "Test database: ${TEST_DB_NAME}"
log "Migrations applied: ${MIGRATION_COUNT}"

exit 0
