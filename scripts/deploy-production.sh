#!/usr/bin/env bash
# Immutable, rollback-safe production deployment for the Bowin pilot.
# Requires explicit action-time approval. It never deletes the live container
# before a private candidate is healthy, and it restores both DB and app after
# a failed stopped-write cutover.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
VPS_HOST=${BOWIN_PRODUCTION_VPS:-root@187.77.26.99}
SSH_KEY=${BOWIN_PRODUCTION_SSH_KEY:-/c/Users/camst/.ssh/id_ed25519_hostinger}
PUBLIC_URL=${BOWIN_PRODUCTION_URL:-https://tkd.ashbi.ca}
: "${BOWIN_PRODUCTION_PROVISION_OFFLINE_KEYS:=0}"
: "${BOWIN_PRODUCTION_RESET_DEMO:=0}"
: "${BOWIN_REGISTRATION_CONSENT_VERSION:=bowin-legal-v1-2026-08-24}"
: "${BOWIN_PRIVACY_NOTICE_URL:=${PUBLIC_URL}/legal/privacy}"
: "${BOWIN_TOURNAMENT_TERMS_URL:=${PUBLIC_URL}/legal/terms}"

case "$BOWIN_REGISTRATION_CONSENT_VERSION" in *[!A-Za-z0-9._-]*|'') echo "Invalid registration consent version" >&2; exit 1;; esac
case "$BOWIN_PRIVACY_NOTICE_URL" in https://*) ;; *) echo "Privacy notice URL must use HTTPS" >&2; exit 1;; esac
case "$BOWIN_TOURNAMENT_TERMS_URL" in https://*) ;; *) echo "Tournament terms URL must use HTTPS" >&2; exit 1;; esac

cd "$ROOT"
test -z "$(git status --porcelain)" || { echo "Refusing production deploy from a dirty worktree" >&2; exit 1; }
RELEASE_SHA=$(git rev-parse --verify HEAD)
ARCHIVE=$(mktemp "${TMPDIR:-/tmp}/bowin-production-${RELEASE_SHA}.XXXXXX.tar.gz")
trap 'rm -f "$ARCHIVE"' EXIT
git archive --format=tar.gz --prefix=app/ --output="$ARCHIVE" "$RELEASE_SHA"
ARCHIVE_SHA256=$(sha256sum "$ARCHIVE" | awk '{print $1}')

echo "==> Uploading immutable source archive for ${RELEASE_SHA}"
ssh -i "$SSH_KEY" -o IdentitiesOnly=yes -o BatchMode=yes "$VPS_HOST" \
  "install -d -m 700 /opt/bowin-production-releases"
scp -O -i "$SSH_KEY" -o IdentitiesOnly=yes -o BatchMode=yes "$ARCHIVE" \
  "${VPS_HOST}:/opt/bowin-production-releases/${RELEASE_SHA}.tar.gz.part"
ssh -i "$SSH_KEY" -o IdentitiesOnly=yes -o BatchMode=yes "$VPS_HOST" \
  "mv /opt/bowin-production-releases/${RELEASE_SHA}.tar.gz.part /opt/bowin-production-releases/${RELEASE_SHA}.tar.gz"

ssh -i "$SSH_KEY" -o IdentitiesOnly=yes -o BatchMode=yes "$VPS_HOST" \
  "RELEASE_SHA='$RELEASE_SHA' ARCHIVE_SHA256='$ARCHIVE_SHA256' PUBLIC_URL='$PUBLIC_URL' PROVISION_OFFLINE_KEYS='$BOWIN_PRODUCTION_PROVISION_OFFLINE_KEYS' RESET_DEMO='$BOWIN_PRODUCTION_RESET_DEMO' REGISTRATION_CONSENT_VERSION='$BOWIN_REGISTRATION_CONSENT_VERSION' PRIVACY_NOTICE_URL='$BOWIN_PRIVACY_NOTICE_URL' TOURNAMENT_TERMS_URL='$BOWIN_TOURNAMENT_TERMS_URL' bash -s" <<'REMOTE'
set -Eeuo pipefail
LIVE=taekwondo-tournament
CANDIDATE=taekwondo-tournament-candidate
ROLLBACK=taekwondo-tournament-rollback
IMAGE="bowin-release:${RELEASE_SHA}"
RELEASE_ROOT=/opt/bowin-production-releases
ARCHIVE="$RELEASE_ROOT/${RELEASE_SHA}.tar.gz"
RELEASE_DIR="$RELEASE_ROOT/${RELEASE_SHA}"
BACKUP_DIR=/var/backups/taekwondo
STAMP="$(date -u +%Y%m%dT%H%M%SZ)-${RELEASE_SHA:0:12}"
BACKUP=""
ENV_FILE=""
CUTOVER_STARTED=0
DB_MUTATED=0
PREVIOUS_RENAMED=0
PREVIOUS_IMAGE_ID=""
LIVE_STOPPED=0
LOCK_DIR=/var/lock/bowin-production-deploy.lock

wait_for_health() {
  local url=$1
  local description=$2
  echo "==> Waiting for health check: ${description}"
  for attempt in $(seq 1 45); do 
    if curl -fsS --max-time 5 "$url" >/dev/null 2>&1; then
      echo "Health check PASSED (${description}) on attempt ${attempt}/45"
      return 0
    fi
    sleep 1
  done
  echo "FAIL-CLOSED: Health check FAILED (${description}) after 45 attempts" >&2
  return 1
}
restore_database() {
  test -n "$BACKUP" && test -s "$BACKUP" || return 1
  docker exec "$LIVE" true >/dev/null 2>&1 && docker stop "$LIVE" >/dev/null 2>&1 || true
  docker exec markup-postgres psql -U markup -d postgres -v ON_ERROR_STOP=1 \
    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='taekwondo' AND pid <> pg_backend_pid();" >/dev/null
  docker exec -i markup-postgres pg_restore -U markup -d postgres --clean --if-exists --create --no-owner --exit-on-error < "$BACKUP"
}
restore_previous_release() {
  echo "==> Rolling back to previous release"
  docker rm -f "$LIVE" >/dev/null 2>&1 || true
  if [ "$PREVIOUS_RENAMED" -eq 1 ]; then
    docker inspect "$ROLLBACK" >/dev/null
    docker rename "$ROLLBACK" "$LIVE"
  fi
  test "$(docker inspect "$LIVE" --format '{{.Image}}')" = "$PREVIOUS_IMAGE_ID"
  docker start "$LIVE" >/dev/null
  wait_for_health "http://127.0.0.1:${LIVE_PORT}/api/health/ready" "rollback internal"
  wait_for_health "$PUBLIC_URL/api/health/ready" "rollback public"
  echo "Rollback complete; previous release restored"
}
cleanup() {
  status=$?
  set +e
  docker rm -f "$CANDIDATE" >/dev/null 2>&1 || true
  if [ "$status" -ne 0 ] && [ "$CUTOVER_STARTED" -eq 1 ]; then
    echo "ROLLBACK: restoring stopped-write production release" >&2
    [ "$DB_MUTATED" -eq 1 ] && restore_database || true
    restore_previous_release || { echo "CRITICAL: manual recovery required; backup=${BACKUP}" >&2; status=90; }
  elif [ "$status" -ne 0 ] && [ "$LIVE_STOPPED" -eq 1 ]; then
    docker start "$LIVE" >/dev/null 2>&1 || { echo "CRITICAL: stopped live container could not restart" >&2; status=90; }
  fi
  [ -z "$ENV_FILE" ] || rm -f "$ENV_FILE"
  rmdir "$LOCK_DIR" 2>/dev/null || true
  exit "$status"
}
trap cleanup EXIT

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Another production deployment is already running" >&2
  exit 1
fi

docker inspect "$LIVE" >/dev/null
LIVE_PORT=$(docker inspect "$LIVE" --format '{{(index (index .NetworkSettings.Ports "3001/tcp") 0).HostPort}}')
test -n "$LIVE_PORT"
PREVIOUS_IMAGE_ID=$(docker inspect "$LIVE" --format '{{.Image}}')

install -d -m 700 /etc/taekwondo.d "$RELEASE_ROOT" "$BACKUP_DIR"
PRIVATE_KEY_FILE=/etc/taekwondo.d/offline-capability-production-private-key
PUBLIC_KEY_FILE=/etc/taekwondo.d/offline-capability-production-public-key
if [ ! -s "$PRIVATE_KEY_FILE" ] || [ ! -s "$PUBLIC_KEY_FILE" ]; then
  [ "$PROVISION_OFFLINE_KEYS" = 1 ] || { echo "Production offline capability keys are not provisioned" >&2; exit 1; }
  test ! -e "$PRIVATE_KEY_FILE" && test ! -e "$PUBLIC_KEY_FILE" || { echo "Refusing incomplete key pair" >&2; exit 1; }
  node - <<'NODE'
const { generateKeyPairSync } = require('crypto'); const fs = require('fs');
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
fs.writeFileSync('/etc/taekwondo.d/offline-capability-production-private-key', privateKey.export({type:'pkcs8',format:'der'}).toString('base64')+'\n', {mode:0o600});
fs.writeFileSync('/etc/taekwondo.d/offline-capability-production-public-key', publicKey.export({type:'spki',format:'der'}).toString('base64')+'\n', {mode:0o644});
NODE
fi
PRIVATE_KEY=$(tr -d '\r\n' < "$PRIVATE_KEY_FILE")
PUBLIC_KEY=$(tr -d '\r\n' < "$PUBLIC_KEY_FILE")
test -n "$PRIVATE_KEY" && test -n "$PUBLIC_KEY"

test "$(sha256sum "$ARCHIVE" | awk '{print $1}')" = "$ARCHIVE_SHA256"
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"
tar xzf "$ARCHIVE" -C "$RELEASE_DIR" --strip-components=1
echo "==> Building ${IMAGE} remotely from verified source"
docker build --label "org.opencontainers.image.revision=${RELEASE_SHA}" \
  --build-arg "VITE_OFFLINE_CAPABILITY_PUBLIC_KEY_BASE64=${PUBLIC_KEY}" -t "$IMAGE" "$RELEASE_DIR" >/tmp/bowin-build-${STAMP}.log 2>&1
test "$(docker image inspect "$IMAGE" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$RELEASE_SHA"

ENV_FILE=$(mktemp /tmp/bowin-production-env.XXXXXX)
chmod 600 "$ENV_FILE"
ALLOWED_ENV='^(DATABASE_URL|JWT_SECRET|METRICS_TOKEN|ADMIN_SETUP_KEY|MAILGUN_API_KEY|MAILGUN_DOMAIN|MAILGUN_BASE_URL|EMAIL_FROM_NAME|EMAIL_FROM_ADDRESS|RETENTION_PURGE_ENABLED|SOFT_DELETE_RETENTION_DAYS|REGISTRATION_CONSENT_VERSION|PRIVACY_NOTICE_URL|TOURNAMENT_TERMS_URL|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|STRIPE_STARTER_PRICE_ID|STRIPE_PRO_PRICE_ID|DEBUG|ENABLE_DEMO_LOGIN|DEMO_ISOLATED_DATA|DEMO_RATE_LIMIT_MAX|PUBLIC_APP_URL|ALLOWED_ORIGINS|OPENAI_API_KEY|OPENAI_MODEL|OPENAI_BASE_URL|SUPPORT_ALERT_EMAIL)='
docker inspect "$LIVE" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E "$ALLOWED_ENV" > "$ENV_FILE"
replace_env() {
  local key=$1 value=$2 next="${ENV_FILE}.next"
  grep -v "^${key}=" "$ENV_FILE" > "$next" || true
  printf '%s=%s\n' "$key" "$value" >> "$next"
  mv "$next" "$ENV_FILE"
}
replace_env REGISTRATION_CONSENT_VERSION "$REGISTRATION_CONSENT_VERSION"
replace_env PRIVACY_NOTICE_URL "$PRIVACY_NOTICE_URL"
replace_env TOURNAMENT_TERMS_URL "$TOURNAMENT_TERMS_URL"
printf 'OFFLINE_CAPABILITY_PRIVATE_KEY_BASE64=%s\n' "$PRIVATE_KEY" >> "$ENV_FILE"
grep -q '^DATABASE_URL=' "$ENV_FILE"; grep -q '^JWT_SECRET=' "$ENV_FILE"; grep -q '^METRICS_TOKEN=' "$ENV_FILE"
grep -q '^REGISTRATION_CONSENT_VERSION=' "$ENV_FILE"; grep -q '^PRIVACY_NOTICE_URL=' "$ENV_FILE"; grep -q '^TOURNAMENT_TERMS_URL=' "$ENV_FILE"

echo "==> Starting private candidate while production remains live"
# `--init` injects tini as PID 1, which forwards SIGTERM to its child and reaps
# zombie subprocesses. The Dockerfile's entrypoint then `exec`s node, so node
# is a direct child of tini and the graceful-shutdown block at
# `src/server/index.ts:412` runs on `docker stop`. Closes SH-8.
docker run -d --init --name "$CANDIDATE" --network markup-net --env-file "$ENV_FILE" "$IMAGE" >/dev/null
echo "Waiting for candidate health check..."
CANDIDATE_HEALTHY=0
for attempt in $(seq 1 45); do 
  if docker exec "$CANDIDATE" wget -q -O /dev/null http://127.0.0.1:3001/api/health/ready 2>/dev/null; then
    echo "Candidate health check PASSED on attempt ${attempt}/45"
    CANDIDATE_HEALTHY=1
    break
  fi
  sleep 1
done
if [ "$CANDIDATE_HEALTHY" -ne 1 ]; then
  echo "FAIL-CLOSED: Candidate health check FAILED after 45 attempts" >&2
  docker logs "$CANDIDATE" 2>&1 | tail -n 50 >&2
  exit 1
fi
docker rm -f "$CANDIDATE" >/dev/null

echo "==> Stopping production writes and validating backup"
docker rm -f "$ROLLBACK" >/dev/null 2>&1 || true
docker stop "$LIVE" >/dev/null
LIVE_STOPPED=1
docker rename "$LIVE" "$ROLLBACK"
PREVIOUS_RENAMED=1
CUTOVER_STARTED=1
BACKUP="$BACKUP_DIR/pre-${STAMP}.dump"
docker exec markup-postgres pg_dump -U markup -Fc --create taekwondo > "$BACKUP"
chmod 600 "$BACKUP" && test -s "$BACKUP"
docker exec -i markup-postgres pg_restore -U markup --list < "$BACKUP" >/dev/null

DB_MUTATED=1
echo "==> Migrating database"
# `--init` on the one-shot migrate container keeps signal handling consistent
# with the live container (Closes SH-8). The entrypoint runs the same
# `prisma migrate deploy` as the live container; the explicit CMD override
# below is belt-and-suspenders for clarity at the deploy log tail.
docker run --rm --init --network markup-net --env-file "$ENV_FILE" "$IMAGE" sh -c './node_modules/.bin/prisma migrate deploy'
if [ "$RESET_DEMO" = 1 ]; then
  grep -q '^DEMO_ISOLATED_DATA=1$' "$ENV_FILE" || { echo "Refusing demo reset outside an isolated synthetic environment" >&2; exit 1; }
  echo "==> Resetting marker-protected synthetic showcase"
  docker run --rm --init --network markup-net --env-file "$ENV_FILE" -e DEMO_RESET_CONFIRM=bowin-resettable-showcase-v1 "$IMAGE" npm run demo:reset:production
else
  echo "==> Demo reset skipped (not an isolated synthetic environment)"
fi

echo "==> Publishing new release on port ${LIVE_PORT}"
# `--init` makes tini PID 1; the entrypoint `exec`s node so node is tini's
# direct child, and SIGTERM from `docker stop` reaches the graceful-shutdown
# block at `src/server/index.ts:412`. Closes SH-8.
docker run -d --init --name "$LIVE" --restart unless-stopped --network markup-net -p "127.0.0.1:${LIVE_PORT}:3001" --env-file "$ENV_FILE" "$IMAGE" >/dev/null
wait_for_health "http://127.0.0.1:${LIVE_PORT}/api/health/ready" "new release internal" || {
  echo "FAIL-CLOSED: New release failed internal health check; initiating automatic rollback" >&2
  exit 1
}
wait_for_health "$PUBLIC_URL/api/health/ready" "new release public" || {
  echo "FAIL-CLOSED: New release failed public health check; initiating automatic rollback" >&2
  exit 1
}
ACTUAL_SHA=$(docker inspect "$LIVE" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')
if [ "$ACTUAL_SHA" != "$RELEASE_SHA" ]; then
  echo "FAIL-CLOSED: Deployed image SHA mismatch (expected ${RELEASE_SHA}, got ${ACTUAL_SHA})" >&2
  exit 1
fi
echo "SHA verification PASSED: deployed ${RELEASE_SHA}"

DB_MUTATED=0
CUTOVER_STARTED=0
DEPLOYED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
DEPLOYED_IMAGE=$(docker inspect "$LIVE" --format '{{.Image}}')
echo "==> Recording deployment evidence"
mkdir -p /opt/bowin-production-releases/deployments
cat > "/opt/bowin-production-releases/deployments/${STAMP}.json" <<DEPLOY_RECORD
{
  "revision": "${RELEASE_SHA}",
  "deployed_at": "${DEPLOYED_AT}",
  "deployed_by": "$(whoami)@$(hostname)",
  "image_id": "${DEPLOYED_IMAGE}",
  "backup": "$(basename "$BACKUP")",
  "rollback_container": "${ROLLBACK}",
  "public_url": "${PUBLIC_URL}",
  "health_check_passed": true
}
DEPLOY_RECORD
echo "DEPLOYED revision=${RELEASE_SHA} backup=$(basename "$BACKUP") rollback=${ROLLBACK} at=${DEPLOYED_AT}"
echo "Deployment record: /opt/bowin-production-releases/deployments/${STAMP}.json"
REMOTE

echo "Production release ${RELEASE_SHA} passed direct and public readiness gates."
echo "Deployment evidence recorded without exposing secrets."
