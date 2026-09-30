#!/usr/bin/env bash
#
# Container smoke test: build the production image and boot it the way a
# platform like Coolify does (environment variables only, empty database),
# then check the endpoints a deploy depends on.
#
# Catches what unit and browser tests cannot: a runtime dependency missing
# from the `npm ci --omit=dev` layer, a broken CMD or migration on start,
# a health check that never passes, or a missing client bundle.
#
# Usage:
#   DATABASE_URL=postgresql://user:pass@localhost:5432/anydb ./scripts/container-smoke.sh
#
# DATABASE_URL only locates the Postgres server; a fresh database is created
# and dropped. The container uses host networking so it can reach it.
# Optional: DOCKERFILE (default Dockerfile), DOCKER_BUILD_FLAGS (extra
# `docker build` flags), SMOKE_PORT (default 3911), KEEP_CONTAINER=1.
#
# Exit codes: 0 pass, 1 check failed, 3 bad environment.

set -euo pipefail

log() { echo "[container-smoke] $*"; }
fail() { echo "[container-smoke] FAIL: $*" >&2; exit 1; }

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[container-smoke] DATABASE_URL is not set" >&2
  exit 3
fi
if [[ ! "${DATABASE_URL}" =~ ^postgresql://([^:]+):([^@]+)@([^:/]+):([0-9]+)/ ]]; then
  echo "[container-smoke] DATABASE_URL must look like postgresql://user:pass@host:port/db" >&2
  exit 3
fi
DB_USER="${BASH_REMATCH[1]}"
DB_PASS="${BASH_REMATCH[2]}"
DB_HOST="${BASH_REMATCH[3]}"
DB_PORT="${BASH_REMATCH[4]}"

IMAGE="bowin-container-smoke:$(git rev-parse --short HEAD 2>/dev/null || echo local)"
CONTAINER="bowin-container-smoke-$$"
SMOKE_DB="bowin_container_smoke_$(date +%s)"
PORT="${SMOKE_PORT:-3911}"
BASE="http://127.0.0.1:${PORT}"
SHA="$(git rev-parse HEAD 2>/dev/null || echo 0000000000000000000000000000000000000000)"
METRICS_TOKEN="container-smoke-metrics-token-$(date +%s)-0123456789"

psql_admin() {
  PGPASSWORD="${DB_PASS}" psql --host="${DB_HOST}" --port="${DB_PORT}" --username="${DB_USER}" \
    --dbname=postgres --quiet --no-psqlrc --command="$1"
}

cleanup() {
  if [[ "${KEEP_CONTAINER:-}" != "1" ]]; then
    docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
    psql_admin "DROP DATABASE IF EXISTS ${SMOKE_DB} WITH (FORCE);" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

log "Building ${IMAGE}"
# shellcheck disable=SC2086
docker build ${DOCKER_BUILD_FLAGS:-} --build-arg "BUILD_SHA=${SHA}" -f "${DOCKERFILE:-Dockerfile}" -t "${IMAGE}" .

log "Creating empty database ${SMOKE_DB}"
psql_admin "CREATE DATABASE ${SMOKE_DB};"

log "Starting container on port ${PORT}"
# Production mode with the minimum configuration production requires.
# Mail points at a closed port: startup must survive an unreachable provider.
docker run -d --name "${CONTAINER}" --network host \
  -e PORT="${PORT}" \
  -e DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${SMOKE_DB}" \
  -e JWT_SECRET="container-smoke-jwt-secret-$(date +%s)-0123456789abcdef" \
  -e METRICS_TOKEN="${METRICS_TOKEN}" \
  -e ALLOWED_ORIGINS="https://smoke.example.test" \
  -e PUBLIC_APP_URL="https://smoke.example.test" \
  -e ADMIN_SETUP_KEY="container-smoke-setup-key" \
  -e MAILGUN_API_KEY="key-container-smoke" \
  -e MAILGUN_DOMAIN="example.test" \
  -e EMAIL_FROM_ADDRESS="noreply@example.test" \
  -e MAILGUN_BASE_URL="http://127.0.0.1:9/v3" \
  "${IMAGE}" >/dev/null

log "Waiting for the Docker health check"
status=starting
for _ in $(seq 1 90); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "${CONTAINER}" 2>/dev/null || echo missing)"
  running="$(docker inspect -f '{{.State.Running}}' "${CONTAINER}" 2>/dev/null || echo false)"
  [[ "${status}" == "healthy" ]] && break
  if [[ "${running}" != "true" ]]; then
    docker logs "${CONTAINER}" 2>&1 | tail -40 >&2
    fail "container exited before becoming healthy"
  fi
  sleep 2
done
if [[ "${status}" != "healthy" ]]; then
  docker logs "${CONTAINER}" 2>&1 | tail -40 >&2
  fail "container did not become healthy (status: ${status})"
fi

expect_status() {
  local expected="$1" url="$2"; shift 2
  local got
  got="$(curl -s -o /dev/null -w '%{http_code}' "$@" "${url}")"
  [[ "${got}" == "${expected}" ]] || fail "${url} returned ${got}, expected ${expected}"
  log "ok ${expected} ${url}"
}

expect_status 200 "${BASE}/api/health/ready"
revision="$(curl -s "${BASE}/api/health" | sed -n 's/.*"revision":"\([^"]*\)".*/\1/p')"
[[ "${revision}" == "${SHA}" ]] || fail "/api/health revision is '${revision}', expected ${SHA}"
log "ok revision ${revision}"

expect_status 200 "${BASE}/"
curl -s "${BASE}/" | grep -q '<div id="root">' || fail "/ did not serve the app shell"
expect_status 200 "${BASE}/tournaments/deep-link-check"
expect_status 401 "${BASE}/api/internal/metrics"
expect_status 200 "${BASE}/api/internal/metrics" -H "Authorization: Bearer ${METRICS_TOKEN}"
expect_status 401 "${BASE}/api/tournaments"

setup="$(curl -s -X POST "${BASE}/api/auth/setup-admin" -H 'Content-Type: application/json' \
  -d '{"email":"smoke-admin@example.test","firstName":"Smoke","lastName":"Admin","setupKey":"container-smoke-setup-key"}')"
echo "${setup}" | grep -q '"role":"admin"' || fail "setup-admin did not create the first admin: ${setup}"
log "ok first-admin setup"

log "PASS"
