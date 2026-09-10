#!/usr/bin/env bash
# =============================================================================
# Compose host-port hardening smoke test (closes audit #63)
# =============================================================================
# Verifies that the merged docker-compose config (base + production override)
# does NOT bind any database port (Postgres 5432, MySQL 3306, Mongo 27017)
# to the host. The merged config is the production posture — what
# `docker compose up` would actually bind to the host. If a future edit to
# docker-compose.yml silently re-adds `- 5432:5432` (or similar) to a
# service, the production override MUST strip it; this test catches a
# regression in either file.
#
# Requirements (on the CI runner / VPS):
#   - docker (with `docker compose` v2 / the `docker-compose` plugin)
#   - jq
#
# Exit codes:
#   0 — pass: no DB port is bound to the host
#   1 — fail: a DB port is bound to the host, or a tool is missing
#   2 — fail: docker compose config itself failed (syntax error etc.)
#
# Usage:
#   ./scripts/test-compose-port-hardening.sh
# =============================================================================
set -Eeuo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"

# DB ports that must NEVER be published to the host. Extend the alternation
# here when adding a new database to the stack (e.g. 6379 for Redis). Keep
# the pattern narrow — a typo can't slip through.
FORBIDDEN_HOST_PORTS='5432|3306|27017'

# --- Tooling preflight -------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  echo "FAIL: docker is not installed or not on PATH" >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "FAIL: 'docker compose' (v2 plugin) is required" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "FAIL: jq is required (apt-get install jq / brew install jq)" >&2
  exit 1
fi
if [ ! -f docker-compose.yml ] || [ ! -f docker-compose.prod.yml ]; then
  echo "FAIL: docker-compose.yml and docker-compose.prod.yml must both exist at repo root" >&2
  exit 1
fi

# `docker-compose.prod.yml` uses the `!override` tag to strip host-port
# bindings, which requires Compose v2.24.4+. Older versions silently
# ignore the tag, which would mask a regression in the test. The test
# only inspects the merged config, so it cannot detect that the tag was
# ignored — fail fast here with a clear message instead.
COMPOSE_VERSION_RAW=$(docker compose version --short 2>/dev/null \
  || docker compose version 2>/dev/null \
     | head -n 1 \
     | sed -E 's/.*version[[:space:]]+//')
if [ -n "$COMPOSE_VERSION_RAW" ]; then
  # Strip a leading 'v' and any suffix like '-rc1' / '-backports' /
  # '+build.N' so the version parses as M.m.p.
  COMPOSE_VERSION_NUM=${COMPOSE_VERSION_RAW#v}
  COMPOSE_VERSION_NUM=${COMPOSE_VERSION_NUM%%[-+ ]*}
  # Fall back to "0.0.0" if any field is non-numeric (e.g. a future
  # major version with a different output format).
  if ! [[ "$COMPOSE_VERSION_NUM" =~ ^[0-9]+(\.[0-9]+){0,2}$ ]]; then
    COMPOSE_VERSION_NUM="0.0.0"
  fi
  REQUIRED_MAJOR=2
  REQUIRED_MINOR=24
  REQUIRED_PATCH=4
  MAJOR=$(echo "$COMPOSE_VERSION_NUM" | cut -d. -f1)
  MINOR=$(echo "$COMPOSE_VERSION_NUM" | cut -d. -f2)
  PATCH=$(echo "$COMPOSE_VERSION_NUM" | cut -d. -f3)
  MAJOR=${MAJOR:-0}
  MINOR=${MINOR:-0}
  PATCH=${PATCH:-0}
  if [ "$MAJOR" -lt "$REQUIRED_MAJOR" ] \
     || { [ "$MAJOR" -eq "$REQUIRED_MAJOR" ] && [ "$MINOR" -lt "$REQUIRED_MINOR" ]; } \
     || { [ "$MAJOR" -eq "$REQUIRED_MAJOR" ] && [ "$MINOR" -eq "$REQUIRED_MINOR" ] && [ "$PATCH" -lt "$REQUIRED_PATCH" ]; }; then
    echo "FAIL: 'docker compose' v${REQUIRED_MAJOR}.${REQUIRED_MINOR}.${REQUIRED_PATCH}+ is required for the '!override' tag in docker-compose.prod.yml (have ${COMPOSE_VERSION_RAW})" >&2
    exit 1
  fi
fi

# --- Render merged config ----------------------------------------------------
# We need a populated env so the merge does not fail on missing required
# variables. The hardening test only inspects port bindings; the values
# themselves are irrelevant. Stub the required ones with placeholders that
# pass the `:-` fallbacks.
CONFIG_JSON=$(\
  POSTGRES_PASSWORD=stub \
  JWT_SECRET=stub-jwt-secret-at-least-32-characters-xx \
  METRICS_TOKEN=stub \
  ALLOWED_ORIGINS=https://example.invalid \
  PUBLIC_APP_URL=https://example.invalid \
  MAILGUN_API_KEY=stub \
  MAILGUN_DOMAIN=example.invalid \
  EMAIL_FROM_ADDRESS=stub@example.invalid \
  REGISTRATION_CONSENT_VERSION=stub-v1 \
  PRIVACY_NOTICE_URL=https://example.invalid/legal/privacy \
  TOURNAMENT_TERMS_URL=https://example.invalid/legal/terms \
  VITE_OFFLINE_CAPABILITY_PUBLIC_KEY_BASE64=stub \
  OFFLINE_CAPABILITY_PRIVATE_KEY_BASE64=stub \
  docker compose \
    -f docker-compose.yml \
    -f docker-compose.prod.yml \
    config --format json 2>&1
) || {
  echo "FAIL: 'docker compose config' failed:" >&2
  echo "$CONFIG_JSON" >&2
  exit 2
}

# --- Inspect every service for a forbidden host port -------------------------
# A binding is a "host port" when `published` is a non-empty number /
# string (the value on the host side). A pure `expose:` line produces a
# binding with no `published` key, so it is correctly skipped.
violations=$(echo "$CONFIG_JSON" | jq -r --arg re "$FORBIDDEN_HOST_PORTS" '
  .services
  | to_entries[]
  | .key as $svc
  | (.value.ports // [])
  | map(select((.published // "") | tostring | test($re)))
  | if length > 0 then
      [ $svc, (map(.published) | join(",")) ]
      | @tsv
    else empty
    end
')

if [ -n "$violations" ]; then
  echo "FAIL: a database port is bound to the host in the merged compose config." >&2
  echo "      Audit #63 forbids host bindings of 5432 / 3306 / 27017." >&2
  echo "" >&2
  echo "      service<TAB>published_ports" >&2
  while IFS=$'\t' read -r svc ports; do
    printf '      %s\t%s\n' "$svc" "$ports" >&2
  done <<< "$violations"
  echo "" >&2
  echo "      Fix: ensure the service in docker-compose.yml has no" >&2
  echo "      host-port line, and that docker-compose.prod.yml sets" >&2
  echo "      'ports: []' on the same service so the merge strips it." >&2
  exit 1
fi

echo "PASS: no host-bound database port in merged compose config."
echo "      Forbidden patterns: ${FORBIDDEN_HOST_PORTS}"
echo "      Merged services: $(echo "$CONFIG_JSON" | jq -r '.services | keys | join(", ")')"
