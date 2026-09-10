#!/usr/bin/env bash
# scripts/lib/assert-required-env.sh
#
# Sourced by the deploy scripts (production + staging) to assert that a
# docker --env-file contains the keys a live release needs, with
# non-empty values. Closes SH-7: the previous deploy scripts only asserted
# a subset of vars with `grep -q '^KEY='`, which treats a present-but-empty
# value as a pass, and silently dropped Sentry SDK vars that the runtime
# reads (SENTRY_DSN, SENTRY_ENVIRONMENT).
#
# Usage:
#   source scripts/lib/assert-required-env.sh
#   assert_required_env_vars "$ENV_FILE" "production" \
#     DATABASE_URL JWT_SECRET SENTRY_DSN
#
# Exit codes:
#   0 - all required vars present and non-empty
#   1 - one or more required vars missing or empty (with a clear error)
#   2 - env file does not exist
#   3 - missing arguments (env file or required var list)
#
# On failure, the function prints a single human-readable line naming every
# offending variable so the operator can see the exact gap at a glance.

assert_required_env_vars() {
  local env_file=$1
  local label=${2:-deploy}
  if [ $# -lt 3 ]; then
    echo "assert_required_env_vars: usage: assert_required_env_vars <env_file> <label> <VAR> [VAR...]" >&2
    return 3
  fi
  shift 2
  if [ ! -f "$env_file" ]; then
    echo "Refusing ${label} deploy: env file not found at ${env_file}" >&2
    return 2
  fi
  local missing=()
  local empty=()
  local key value
  for key in "$@"; do
    if ! grep -q "^${key}=" "$env_file"; then
      missing+=("$key")
      continue
    fi
    # Read the first matching line's value; cut from first '=' so values
    # containing '=' (e.g. URL query strings) survive intact.
    value=$(grep "^${key}=" "$env_file" | head -n 1 | cut -d= -f2-)
    if [ -z "$value" ]; then
      empty+=("$key")
    fi
  done
  local problem=0
  if [ "${#missing[@]}" -gt 0 ]; then
    echo "Refusing ${label} deploy: missing required env var(s): ${missing[*]}" >&2
    problem=1
  fi
  if [ "${#empty[@]}" -gt 0 ]; then
    echo "Refusing ${label} deploy: empty required env var(s): ${empty[*]}" >&2
    problem=1
  fi
  if [ "$problem" -ne 0 ]; then
    return 1
  fi
  echo "Required env var assertion passed (${label}): $*" >&2
  return 0
}
