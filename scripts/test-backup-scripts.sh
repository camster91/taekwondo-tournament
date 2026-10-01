#!/usr/bin/env bash
#
# Regression tests for scripts/backup-database.sh and scripts/restore-database.sh.
#
# Part 1 (always): runs backup-database.sh against a fake pg_dump on PATH that
# behaves like the real one with --verbose (every stderr line starts with
# "pg_dump:"), with and without BACKUP_ENCRYPTION_KEY, and with a failing dump.
#
# Part 2 (opt-in): when BACKUP_TEST_ADMIN_URL points at a Postgres server
# (postgresql://user:pass@host:port, a role that may CREATE DATABASE), it
# round-trips a real scratch database through backup + restore, including a
# Prisma-style ?schema=public URL, an unencrypted backup, and a corrupt backup
# that must leave the live database untouched.
#
# Usage:
#   ./scripts/test-backup-scripts.sh
#   BACKUP_TEST_ADMIN_URL=postgresql://postgres:pg@localhost:5432 ./scripts/test-backup-scripts.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_SH="${SCRIPT_DIR}/backup-database.sh"
RESTORE_SH="${SCRIPT_DIR}/restore-database.sh"
WORK="$(mktemp -d)"
FAILURES=0
SCRATCH_DBS=()

cleanup() {
    if [[ -n "${BACKUP_TEST_ADMIN_URL:-}" ]]; then
        for db in "${SCRATCH_DBS[@]+"${SCRATCH_DBS[@]}"}"; do
            psql "${BACKUP_TEST_ADMIN_URL}/postgres" -q -c "DROP DATABASE IF EXISTS \"${db}\";" >/dev/null 2>&1 || true
        done
    fi
    rm -rf "${WORK}"
}
trap cleanup EXIT

pass() { echo "ok   - $*"; }
fail() { echo "FAIL - $*"; FAILURES=$((FAILURES + 1)); }
exists() { compgen -G "$1" >/dev/null; }
check() { local desc="$1"; shift; if "$@"; then pass "${desc}"; else fail "${desc}"; fi; }

# ---------------------------------------------------------------- part 1
mkdir -p "${WORK}/bin"
cat > "${WORK}/bin/pg_dump" <<'FAKE'
#!/usr/bin/env bash
file=""
for arg in "$@"; do
    case "$arg" in --file=*) file="${arg#--file=}" ;; esac
done
echo "pg_dump: last built-in OID is 16383" >&2
echo "pg_dump: reading extensions" >&2
if [[ -n "${FAKE_PG_DUMP_FAIL:-}" ]]; then
    printf 'PGDMP-partial' > "$file"
    echo "pg_dump: error: connection to server failed" >&2
    exit 1
fi
printf 'PGDMP fake custom-format archive' > "$file"
echo "pg_dump: dumping contents of table \"public.Tournament\"" >&2
exit 0
FAKE
chmod +x "${WORK}/bin/pg_dump"

FAKE_URL="postgresql://u:p@db.example:5432/bowin?schema=public"

run_backup() { # dir, extra env...
    local dir="$1"; shift
    env -u BACKUP_ENCRYPTION_KEY PATH="${WORK}/bin:${PATH}" BACKUP_DIR="${dir}" \
        DATABASE_URL="${FAKE_URL}" "$@" bash "${BACKUP_SH}" >"${dir}.out" 2>&1
}

# 1a: no encryption key (documented optional) — must succeed under set -u
D="${WORK}/plain"; mkdir -p "$D"
rc=0; run_backup "$D" || rc=$?
check "unencrypted backup exits 0 (got ${rc})" test "$rc" -eq 0
check "unencrypted backup writes .sql.UNENCRYPTED" exists "$D/bowin-backup-*.sql.UNENCRYPTED"
check "unencrypted backup writes checksum" exists "$D/bowin-backup-*.sql.UNENCRYPTED.sha256"
check "unencrypted backup writes last-success.json" test -f "$D/last-success.json"
check "unencrypted backup leaves no bare .sql / log" test -z "$(find "$D" -name '*.sql' -o -name '*.log')"

# 1b: with encryption key
D="${WORK}/enc"; mkdir -p "$D"
rc=0; run_backup "$D" BACKUP_ENCRYPTION_KEY=test-key-test-key-test-key-test-key || rc=$?
check "encrypted backup exits 0 (got ${rc})" test "$rc" -eq 0
check "encrypted backup writes .sql.gpg" exists "$D/bowin-backup-*.sql.gpg"
check "encrypted backup leaves no plaintext" test -z "$(find "$D" -name '*.sql' -o -name '*.UNENCRYPTED' -o -name '*.log')"
check "encrypted last-success.json names the .gpg file" grep -q '\.sql\.gpg"' "$D/last-success.json"

# 1c: failing pg_dump — exit 2, nothing left behind, no success marker
D="${WORK}/fail"; mkdir -p "$D"
rc=0; run_backup "$D" BACKUP_ENCRYPTION_KEY=k FAKE_PG_DUMP_FAIL=1 || rc=$?
check "failed dump exits 2 (got ${rc})" test "$rc" -eq 2
check "failed dump leaves no files" test -z "$(ls -A "$D")"
check "failed dump prints pg_dump's error" grep -q "connection to server failed" "$D.out"

# ---------------------------------------------------------------- part 2
if [[ -z "${BACKUP_TEST_ADMIN_URL:-}" ]]; then
    echo "skip - real Postgres round-trip (set BACKUP_TEST_ADMIN_URL)"
else
    ADMIN="${BACKUP_TEST_ADMIN_URL%/}"
    DB="bowin_backup_test_$$"
    SCRATCH_DBS+=("$DB")
    psql "${ADMIN}/postgres" -q -c "CREATE DATABASE \"${DB}\";"
    psql "${ADMIN}/${DB}" -q -c 'CREATE TABLE "Tournament"(id text primary key); INSERT INTO "Tournament" VALUES ($$a$$),($$b$$);'
    URL="${ADMIN}/${DB}?schema=public"
    count() { psql "${ADMIN}/${DB}" -tA -c 'SELECT count(*) FROM "Tournament";'; }

    D="${WORK}/real"; mkdir -p "$D"
    rc=0; BACKUP_DIR="$D" DATABASE_URL="$URL" BACKUP_ENCRYPTION_KEY=real-key \
        bash "${BACKUP_SH}" >"$D.out" 2>&1 || rc=$?
    check "real encrypted backup exits 0 (got ${rc})" test "$rc" -eq 0
    GPG_FILE="$(compgen -G "$D/bowin-backup-*.sql.gpg" | head -1)"

    D2="${WORK}/real-plain"; mkdir -p "$D2"
    rc=0; env -u BACKUP_ENCRYPTION_KEY BACKUP_DIR="$D2" DATABASE_URL="$URL" \
        bash "${BACKUP_SH}" >"$D2.out" 2>&1 || rc=$?
    check "real unencrypted backup exits 0 (got ${rc})" test "$rc" -eq 0
    PLAIN_FILE="$(compgen -G "$D2/bowin-backup-*.sql.UNENCRYPTED" | head -1)"

    # Data changes after the backup; a corrupt backup must not touch it.
    psql "${ADMIN}/${DB}" -q -c 'INSERT INTO "Tournament" VALUES ($$c$$);'
    printf 'not a dump' > "${WORK}/corrupt.sql.UNENCRYPTED"
    rc=0; RESTORE_ASSUME_YES=1 DATABASE_URL="$URL" bash "${RESTORE_SH}" "${WORK}/corrupt.sql.UNENCRYPTED" >"${WORK}/r0.out" 2>&1 || rc=$?
    check "corrupt backup is rejected with exit 3 (got ${rc})" test "$rc" -eq 3
    check "corrupt backup leaves live database intact" test "$(count)" = 3

    rc=0; RESTORE_ASSUME_YES=1 DATABASE_URL="$URL" BACKUP_ENCRYPTION_KEY=wrong \
        bash "${RESTORE_SH}" "${GPG_FILE}" >"${WORK}/r1.out" 2>&1 || rc=$?
    check "wrong key fails with exit 3 (got ${rc})" test "$rc" -eq 3
    check "wrong key leaves live database intact" test "$(count)" = 3

    rc=0; RESTORE_ASSUME_YES=1 DATABASE_URL="$URL" BACKUP_ENCRYPTION_KEY=real-key \
        bash "${RESTORE_SH}" "${GPG_FILE}" >"${WORK}/r2.out" 2>&1 || rc=$?
    check "encrypted restore with ?schema=public URL exits 0 (got ${rc})" test "$rc" -eq 0
    check "encrypted restore brings back backed-up rows" test "$(count)" = 2
    for old in $(psql "${ADMIN}/postgres" -tA -c "SELECT datname FROM pg_database WHERE datname LIKE '${DB}\\_%';"); do
        SCRATCH_DBS+=("$old")
    done

    psql "${ADMIN}/${DB}" -q -c 'INSERT INTO "Tournament" VALUES ($$d$$);'
    sleep 1 # distinct restore timestamp for the kept previous database
    rc=0; RESTORE_ASSUME_YES=1 DATABASE_URL="$URL" env -u BACKUP_ENCRYPTION_KEY \
        bash "${RESTORE_SH}" "${PLAIN_FILE}" >"${WORK}/r3.out" 2>&1 || rc=$?
    check "unencrypted restore exits 0 (got ${rc})" test "$rc" -eq 0
    check "unencrypted restore brings back backed-up rows" test "$(count)" = 2
    for old in $(psql "${ADMIN}/postgres" -tA -c "SELECT datname FROM pg_database WHERE datname LIKE '${DB}\\_%';"); do
        SCRATCH_DBS+=("$old")
    done
    check "no temporary restore database left behind" \
        test -z "$(psql "${ADMIN}/postgres" -tA -c "SELECT datname FROM pg_database WHERE datname LIKE '${DB}\\_restore\\_%';")"
fi

if [[ "${FAILURES}" -gt 0 ]]; then
    echo "${FAILURES} check(s) failed"
    exit 1
fi
echo "all checks passed"
