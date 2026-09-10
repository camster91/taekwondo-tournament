#!/usr/bin/env bash
#
# Graceful-shutdown smoke test (SH-8 regression gate).
#
# The graceful-shutdown block at `src/server/index.ts:412` (the
# `process.on('SIGTERM', ...)` handler) was dead code on every production
# restart, deploy, and `docker stop` because the previous
# `CMD ["sh", "-c", "migrate deploy && node server.js"]` made `sh` PID 1,
# and `sh` exits on SIGTERM without forwarding the signal to its `node`
# child. The Docker `init: true` setting in `docker-compose.yml:44` was the
# only path that worked; the production `docker run` was broken.
#
# This test:
#   1. Builds the production image locally.
#   2. Starts the container with `--init` (the production path) and a
#      placeholder env (MIGRATE_SKIP=1 means no database is needed).
#   3. Waits for `Server running on` to appear in the logs.
#   4. Sends `docker stop --time=30` (SIGTERM, then SIGKILL after 30s).
#   5. Asserts the `[shutdown] received SIGTERM` line appears in the
#      container logs before the process exits.
#   6. Cleans up the image and container.
#
# Then runs the same flow WITHOUT `--init` to prove the entrypoint alone
# is sufficient (the `exec node` in `docker-entrypoint.sh` replaces the
# shell with node, so even without tini, SIGTERM reaches node directly).
#
# Exit codes:
#   0 - Both runs delivered SIGTERM to Node and the shutdown block ran.
#   1 - Build failed.
#   2 - Container did not become ready.
#   3 - `docker stop` failed or timed out.
#   4 - Graceful-shutdown message missing from logs (regression).
#   5 - Docker not installed.
#
# Requires: docker, bash. No database required.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "[shutdown-test] FAIL: docker CLI not found" >&2
  exit 5
fi

IMAGE_TAG="bowin-shutdown-test:$(date +%s)"
CONTAINER_WITH_INIT="bowin-shutdown-test-with-init-$$"
CONTAINER_NO_INIT="bowin-shutdown-test-no-init-$$"

cleanup() {
  set +e
  docker rm -f "$CONTAINER_WITH_INIT" "$CONTAINER_NO_INIT" 2>/dev/null
  docker rmi -f "$IMAGE_TAG" 2>/dev/null
}
trap cleanup EXIT

log()  { echo "[shutdown-test] $*"; }
fail() { echo "[shutdown-test] FAIL: $*" >&2; exit "${2:-4}"; }

log "Building image ${IMAGE_TAG}..."
docker build -t "$IMAGE_TAG" . >/tmp/shutdown-test-build.log 2>&1 || {
  log "docker build failed; tail of /tmp/shutdown-test-build.log:"
  tail -n 30 /tmp/shutdown-test-build.log >&2
  fail "build" 1
}

# Minimal env. MIGRATE_SKIP=1 makes the entrypoint skip `prisma migrate
# deploy` so no database is required. NODE_ENV=development skips the strict
# production-config validation (which would reject these placeholder
# secrets) and disables the demo-data isolation asserts; the rest of the
# server boot path is identical to production. The signal-handling code we
# are testing is gated only by `process.on('SIGTERM', ...)`, which runs
# regardless of NODE_ENV.
PLACEHOLDER_ENV=(
  -e NODE_ENV=development
  -e PORT=3001
  -e MIGRATE_SKIP=1
  -e DATABASE_URL=postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder
  -e JWT_SECRET=test-secret-not-used-in-tests-min-32-chars-xx
  -e ADMIN_SETUP_KEY=test
  -e ALLOWED_ORIGINS=http://localhost:3000
  -e PUBLIC_APP_URL=http://localhost:3000
  -e METRICS_TOKEN=test-metrics-token-32-chars-min-required-xx
  -e MAILGUN_API_KEY=test
  -e MAILGUN_DOMAIN=test.example
  -e EMAIL_FROM_ADDRESS=test@example.com
  -e EMAIL_FROM_NAME=Test
  -e REGISTRATION_CONSENT_VERSION=test-v1
  -e PRIVACY_NOTICE_URL=https://example.com/privacy
  -e TOURNAMENT_TERMS_URL=https://example.com/terms
  -e OFFLINE_CAPABILITY_PRIVATE_KEY_BASE64=dGVzdA==
)

run_shutdown_check() {
  local container=$1
  local use_init_flag=$2
  local label=$3

  if [ "$use_init_flag" = "yes" ]; then
    log "Starting container ${container} (with --init)..."
    docker run -d --init --name "$container" "${PLACEHOLDER_ENV[@]}" "$IMAGE_TAG" >/dev/null
  else
    log "Starting container ${container} (without --init, entrypoint only)..."
    docker run -d --name "$container" "${PLACEHOLDER_ENV[@]}" "$IMAGE_TAG" >/dev/null
  fi

  # Wait for the server to log that it's listening. The app's listen()
  # callback in src/server/index.ts:376 prints this before any DB or email
  # path, so it is a reliable readiness signal without a real backend.
  local ready=0
  for _ in $(seq 1 60); do
    if docker logs "$container" 2>&1 | grep -q "Server running on"; then
      ready=1
      break
    fi
    sleep 1
  done
  if [ "$ready" -ne 1 ]; then
    log "${label}: server did not become ready within 60s; logs:"
    docker logs "$container" 2>&1 | tail -n 40 >&2
    fail "${label} readiness" 2
  fi

  # `docker stop --time=30` sends SIGTERM and waits up to 30s for the
  # process to exit before sending SIGKILL. This is the production path
  # (Docker / Coolify / `docker stop` from an operator).
  log "${label}: sending docker stop (SIGTERM)..."
  if ! docker stop --time=30 "$container" >/dev/null 2>&1; then
    log "${label}: docker stop failed or timed out; logs:"
    docker logs "$container" 2>&1 | tail -n 40 >&2
    fail "${label} docker stop" 3
  fi

  # The shutdown block at src/server/index.ts:412 logs
  # `[shutdown] received SIGTERM, draining...`. Assert it ran.
  if docker logs "$container" 2>&1 | grep -q "\[shutdown\] received SIGTERM"; then
    log "${label}: PASS — SIGTERM reached Node and the shutdown block ran"
    return 0
  fi

  log "${label}: FAIL — graceful-shutdown message missing from logs"
  docker logs "$container" 2>&1 | tail -n 40 >&2
  return 1
}

# Primary regression check: the production path is `docker run --init ...`.
# This must pass.
if ! run_shutdown_check "$CONTAINER_WITH_INIT" yes "with --init"; then
  fail "with --init" 4
fi

# Secondary check: the entrypoint alone (no --init) must also deliver
# SIGTERM to Node, because the entrypoint's `exec node` replaces the shell
# with the node process. If this regresses, the test catches the breakage
# even when an operator forgets `--init` on docker run.
if ! run_shutdown_check "$CONTAINER_NO_INIT" no "without --init"; then
  fail "without --init" 4
fi

log "All checks passed. The graceful-shutdown block at src/server/index.ts:412 is reachable."
