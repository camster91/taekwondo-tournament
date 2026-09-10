#!/usr/bin/env bash
# tests/scripts/assert-required-env.test.sh
#
# Unit tests for scripts/lib/assert-required-env.sh — the function
# used by deploy-production.sh and deploy-staging.sh to fail closed on
# missing or empty required env vars (closes SH-7).
#
# Run with:
#   bash tests/scripts/assert-required-env.test.sh
#
# Exits non-zero on any failure.

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
# shellcheck source=scripts/lib/assert-required-env.sh
. "$ROOT/scripts/lib/assert-required-env.sh"

PASS=0
FAIL=0
FAILED_TESTS=()

# ANSI colours when stdout is a TTY (CI logs stay plain)
if [ -t 1 ]; then
  GREEN=$'\033[0;32m'
  RED=$'\033[0;31m'
  NC=$'\033[0m'
else
  GREEN=""
  RED=""
  NC=""
fi

pass() {
  PASS=$((PASS + 1))
  printf '%sPASS%s  %s\n' "$GREEN" "$NC" "$1"
}

fail() {
  FAIL=$((FAIL + 1))
  FAILED_TESTS+=("$1")
  printf '%sFAIL%s  %s\n' "$RED" "$NC" "$1" >&2
  if [ -n "${2:-}" ]; then
    printf '       %s\n' "$2" >&2
  fi
}

# expect_exit <expected_rc> <expected_substring_in_stderr> <test_name> <cmd...>
expect_exit() {
  local expected_rc=$1
  local expected_sub=$2
  local name=$3
  shift 3
  local stderr_file
  stderr_file=$(mktemp)
  set +e
  "$@" 2>"$stderr_file"
  local actual_rc=$?
  set -e
  local stderr_content
  stderr_content=$(cat "$stderr_file")
  rm -f "$stderr_file"
  if [ "$actual_rc" -ne "$expected_rc" ]; then
    fail "$name" "expected exit ${expected_rc}, got ${actual_rc}; stderr: ${stderr_content}"
    return
  fi
  if [ -n "$expected_sub" ] && ! printf '%s' "$stderr_content" | grep -qF "$expected_sub"; then
    fail "$name" "expected stderr to contain '${expected_sub}', got: ${stderr_content}"
    return
  fi
  pass "$name"
}

# Write a complete production-style env file to a tmp path and echo it.
make_env_file() {
  local f
  f=$(mktemp)
  cat > "$f" <<'EOF'
DATABASE_URL=postgresql://x:y@h:5432/d
JWT_SECRET=abcdefghijklmnopqrstuvwxyz0123456789ABCDEF
METRICS_TOKEN=metricstoken1234567890abcdefghijklmnop
SENTRY_DSN=https://aaaabbbb@o0.ingest.sentry.io/123
SENTRY_ENVIRONMENT=production
MAILGUN_API_KEY=key-abc123
STRIPE_SECRET_KEY=sk_live_abc
REGISTRATION_CONSENT_VERSION=bowin-legal-v1-2026-08-24
PRIVACY_NOTICE_URL=https://tkd.ashbi.ca/legal/privacy
TOURNAMENT_TERMS_URL=https://tkd.ashbi.ca/legal/terms
OFFLINE_CAPABILITY_PRIVATE_KEY_BASE64=c2hpbmVzdGVzdHRlc3Q=
EOF
  printf '%s' "$f"
}

echo "Running assert_required_env_vars tests..."

# Test 1: all required vars present and non-empty -> exit 0
ENV_FILE=$(make_env_file)
expect_exit 0 "Required env var assertion passed" \
  "all required vars present" \
  assert_required_env_vars "$ENV_FILE" "test" \
    DATABASE_URL JWT_SECRET SENTRY_DSN MAILGUN_API_KEY STRIPE_SECRET_KEY
rm -f "$ENV_FILE"

# Test 2: one var missing -> exit 1, message names the missing var
ENV_FILE=$(make_env_file)
# Remove SENTRY_DSN so the assertion sees it as missing.
sed -i '/^SENTRY_DSN=/d' "$ENV_FILE"
expect_exit 1 "missing required env var" \
  "SENTRY_DSN missing" \
  assert_required_env_vars "$ENV_FILE" "test" \
    DATABASE_URL JWT_SECRET SENTRY_DSN MAILGUN_API_KEY
rm -f "$ENV_FILE"

# Test 3: one var empty -> exit 1, message names the empty var
ENV_FILE=$(make_env_file)
# SENTRY_DSN exists but is empty
sed -i 's|^SENTRY_DSN=.*|SENTRY_DSN=|' "$ENV_FILE"
expect_exit 1 "empty required env var" \
  "SENTRY_DSN empty" \
  assert_required_env_vars "$ENV_FILE" "test" \
    DATABASE_URL JWT_SECRET SENTRY_DSN MAILGUN_API_KEY
rm -f "$ENV_FILE"

# Test 4: multiple vars missing -> all reported in one error
ENV_FILE=$(make_env_file)
# Remove both SENTRY_DSN and STRIPE_SECRET_KEY from the env file.
sed -i '/^SENTRY_DSN=/d;/^STRIPE_SECRET_KEY=/d' "$ENV_FILE"
expect_exit 1 "SENTRY_DSN" \
  "multiple missing vars reports SENTRY_DSN" \
  assert_required_env_vars "$ENV_FILE" "test" \
    DATABASE_URL JWT_SECRET SENTRY_DSN STRIPE_SECRET_KEY MAILGUN_API_KEY
rm -f "$ENV_FILE"

# Test 5: env file does not exist -> exit 2
expect_exit 2 "env file not found" \
  "env file not found" \
  assert_required_env_vars "/tmp/does-not-exist-XXXXXX" "test" DATABASE_URL
rm -f "/tmp/does-not-exist-XXXXXX"

# Test 6: no required vars given -> exit 3
ENV_FILE=$(make_env_file)
expect_exit 3 "usage" \
  "no required vars argument" \
  assert_required_env_vars "$ENV_FILE" "test"
rm -f "$ENV_FILE"

# Test 7: only two args (no required vars) -> exit 3
ENV_FILE=$(make_env_file)
expect_exit 3 "usage" \
  "missing required-var arguments" \
  assert_required_env_vars "$ENV_FILE" "test"
rm -f "$ENV_FILE"

# Test 8: SH-7 regression — SENTRY_DSN missing from a STAGING-style list
ENV_FILE=$(make_env_file)
# Remove SENTRY_DSN and SENTRY_ENVIRONMENT entirely
sed -i '/^SENTRY_DSN=/d;/^SENTRY_ENVIRONMENT=/d' "$ENV_FILE"
expect_exit 1 "SENTRY_DSN" \
  "SH-7 regression: SENTRY_DSN missing fails the deploy" \
  assert_required_env_vars "$ENV_FILE" "staging" \
    DATABASE_URL JWT_SECRET METRICS_TOKEN \
    SENTRY_DSN SENTRY_ENVIRONMENT \
    OFFLINE_CAPABILITY_PRIVATE_KEY_BASE64
rm -f "$ENV_FILE"

# Test 9: SH-7 regression — SENTRY_DSN present but empty fails
ENV_FILE=$(make_env_file)
sed -i 's|^SENTRY_DSN=.*|SENTRY_DSN=|;s|^SENTRY_ENVIRONMENT=.*|SENTRY_ENVIRONMENT=|' "$ENV_FILE"
expect_exit 1 "SENTRY_DSN" \
  "SH-7 regression: SENTRY_DSN present-but-empty fails the deploy" \
  assert_required_env_vars "$ENV_FILE" "staging" \
    DATABASE_URL JWT_SECRET METRICS_TOKEN \
    SENTRY_DSN SENTRY_ENVIRONMENT \
    OFFLINE_CAPABILITY_PRIVATE_KEY_BASE64
rm -f "$ENV_FILE"

# Test 10: values with '=' in them (e.g. URL query strings) are preserved
ENV_FILE=$(mktemp)
cat > "$ENV_FILE" <<'EOF'
DATABASE_URL=postgresql://x:y@h:5432/d?sslmode=require
JWT_SECRET=abcdefghijklmnopqrstuvwxyz0123456789ABCDEF
SENTRY_DSN=https://key@host.example.com/1?sample=0.1
EOF
expect_exit 0 "Required env var assertion passed" \
  "values with '=' are accepted" \
  assert_required_env_vars "$ENV_FILE" "test" DATABASE_URL JWT_SECRET SENTRY_DSN
rm -f "$ENV_FILE"

# Test 11: a key that appears multiple times picks the first line's value.
# The first line is non-empty; the second is empty. If the function used
# the last value, the empty second would fail. The function's
# `head -n 1` means the first (non-empty) value is used.
ENV_FILE=$(mktemp)
cat > "$ENV_FILE" <<'EOF'
SENTRY_DSN=https://first-host/1
SENTRY_DSN=
EOF
expect_exit 0 "Required env var assertion passed" \
  "duplicate keys use first occurrence" \
  assert_required_env_vars "$ENV_FILE" "test" SENTRY_DSN
rm -f "$ENV_FILE"

echo
echo "Summary: ${PASS} passed, ${FAIL} failed"
if [ "$FAIL" -ne 0 ]; then
  echo "Failed tests:" >&2
  for t in "${FAILED_TESTS[@]}"; do
    echo "  - $t" >&2
  done
  exit 1
fi
exit 0
