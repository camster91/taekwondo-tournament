#!/usr/bin/env bash
#
# Exit non-zero when the last successful backup is too old (#165).
# Intended for an external monitor / cron (e.g. every 15 minutes):
#
#   ./scripts/check-backup-freshness.sh [max-age-hours]   (default 26)
#
# Reads ${BACKUP_DIR:-/opt/bowin/backups}/last-success.json written by
# backup-database.sh. Exit codes: 0 fresh, 1 stale, 2 missing/unreadable.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/bowin/backups}"
MAX_AGE_HOURS="${1:-26}"
MARKER="${BACKUP_DIR}/last-success.json"

case "$MAX_AGE_HOURS" in ''|*[!0-9]*) echo "max-age-hours must be a whole number" >&2; exit 2;; esac

if [[ ! -r "$MARKER" ]]; then
  echo "CRITICAL: no successful backup recorded (${MARKER} missing)"
  exit 2
fi

COMPLETED=$(sed -n 's/.*"completed_epoch":\([0-9][0-9]*\).*/\1/p' "$MARKER")
if [[ -z "$COMPLETED" ]]; then
  echo "CRITICAL: ${MARKER} is unreadable"
  exit 2
fi

NOW=$(date -u +%s)
AGE_HOURS=$(( (NOW - COMPLETED) / 3600 ))
if (( NOW - COMPLETED > MAX_AGE_HOURS * 3600 )); then
  echo "CRITICAL: last successful backup is ${AGE_HOURS}h old (limit ${MAX_AGE_HOURS}h)"
  exit 1
fi
echo "OK: last successful backup ${AGE_HOURS}h ago"
