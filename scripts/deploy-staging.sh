#!/usr/bin/env bash
# Deploy the exact tracked commit to the isolated Bowin staging stack.
# Run only after explicit action-time approval.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
VPS_HOST=${BOWIN_STAGING_VPS:-root@187.77.26.99}
SSH_KEY=${BOWIN_STAGING_SSH_KEY:-/c/Users/camst/.ssh/id_ed25519_hostinger}
STAGING_URL=https://staging-tkd.ashbi.ca
: "${BOWIN_OFFLINE_CAPABILITY_PUBLIC_KEY_BASE64:?Set the staging offline capability SPKI public key}"

cd "$ROOT"
if [ -n "$(git status --porcelain)" ]; then
  echo "Refusing staging deploy from a dirty worktree" >&2
  exit 1
fi
RELEASE_SHA=$(git rev-parse --verify HEAD)
IMAGE="bowin-release:${RELEASE_SHA}"
CONTEXT=$(mktemp -d "${TMPDIR:-/tmp}/bowin-staging-context.XXXXXX")
ARCHIVE=$(mktemp "${TMPDIR:-/tmp}/bowin-staging-image.XXXXXX.tar.gz")
trap 'rm -rf "$CONTEXT"; rm -f "$ARCHIVE"' EXIT

echo "==> Building immutable image from tracked commit ${RELEASE_SHA}"
git archive HEAD | tar -x -C "$CONTEXT"
docker build \
  --build-arg "VITE_OFFLINE_CAPABILITY_PUBLIC_KEY_BASE64=${BOWIN_OFFLINE_CAPABILITY_PUBLIC_KEY_BASE64}" \
  --label "org.opencontainers.image.revision=${RELEASE_SHA}" \
  -t "$IMAGE" "$CONTEXT"
test "$(docker image inspect "$IMAGE" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$RELEASE_SHA"
docker save "$IMAGE" | gzip -1 > "$ARCHIVE"
ARCHIVE_SHA256=$(sha256sum "$ARCHIVE" | awk '{print $1}')

echo "==> Uploading exact image artifact into a root-owned release directory"
ssh -i "$SSH_KEY" -o BatchMode=yes "$VPS_HOST" \
  "install -d -m 700 /opt/bowin-staging-releases/$RELEASE_SHA && umask 077 && cat > /opt/bowin-staging-releases/$RELEASE_SHA/image.tar.gz.part && mv /opt/bowin-staging-releases/$RELEASE_SHA/image.tar.gz.part /opt/bowin-staging-releases/$RELEASE_SHA/image.tar.gz" < "$ARCHIVE"

ssh -i "$SSH_KEY" -o BatchMode=yes "$VPS_HOST" \
  "RELEASE_SHA='$RELEASE_SHA' ARCHIVE_SHA256='$ARCHIVE_SHA256' STAGING_URL='$STAGING_URL' bash -s" <<'REMOTE'
set -euo pipefail

IMAGE="bowin-release:${RELEASE_SHA}"
RELEASE_DIR="/opt/bowin-staging-releases/${RELEASE_SHA}"
ARCHIVE="${RELEASE_DIR}/image.tar.gz"
BACKUP_DIR=/opt/bowin-staging-backups
ENV_FILE=$(mktemp /tmp/bowin-staging-env.XXXXXX)
chmod 600 "$ENV_FILE"
CUTOVER_STARTED=0
DB_MUTATION_STARTED=0
PREVIOUS_RENAMED=0
PREVIOUS_IMAGE_ID=''
BACKUP=''

wait_for_health() {
  URL=$1
  for _ in $(seq 1 60); do
    if curl -fsS "$URL" >/dev/null; then return 0; fi
    sleep 1
  done
  return 1
}

restore_database() {
  echo "ROLLBACK: restoring staging database from ${BACKUP}" >&2
  docker rm -f bowin-staging-app bowin-staging-candidate >/dev/null 2>&1 || true
  docker exec bowin-staging-db psql -U bowin_staging -d postgres -v ON_ERROR_STOP=1 \
    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='bowin_staging' AND pid <> pg_backend_pid();" >/dev/null || return 1
  docker exec -i bowin-staging-db pg_restore -U bowin_staging -d postgres \
    --clean --if-exists --create --exit-on-error < "$BACKUP" || return 1
}

restore_previous_release() {
  echo "ROLLBACK: restoring previous staging application" >&2
  if [ "$PREVIOUS_RENAMED" -eq 1 ]; then
    docker inspect bowin-staging-rollback >/dev/null 2>&1 || return 1
    docker rm -f bowin-staging-app >/dev/null 2>&1 || true
    docker rename bowin-staging-rollback bowin-staging-app || return 1
  else
    docker inspect bowin-staging-app >/dev/null 2>&1 || return 1
  fi
  test "$(docker inspect bowin-staging-app --format '{{.Image}}')" = "$PREVIOUS_IMAGE_ID" || return 1
  docker start bowin-staging-app >/dev/null || return 1
  wait_for_health http://127.0.0.1:18302/api/health/ready || return 1
  wait_for_health "$STAGING_URL/api/health/ready" || return 1
}

cleanup_on_exit() {
  STATUS=$?
  set +e
  if [ "$STATUS" -ne 0 ]; then
    docker logs --tail 80 bowin-staging-candidate >&2 2>/dev/null || true
    docker logs --tail 80 bowin-staging-app >&2 2>/dev/null || true
    docker rm -f bowin-staging-candidate >/dev/null 2>&1 || true
    ROLLBACK_OK=1
    if [ "$DB_MUTATION_STARTED" -eq 1 ]; then restore_database || ROLLBACK_OK=0; fi
    if [ "$CUTOVER_STARTED" -eq 1 ]; then restore_previous_release || ROLLBACK_OK=0; fi
    if [ "$ROLLBACK_OK" -ne 1 ]; then
      echo "CRITICAL: staging rollback failed; manual recovery required from ${BACKUP}" >&2
      STATUS=90
    fi
  fi
  rm -f "$ENV_FILE"
  exit "$STATUS"
}
trap cleanup_on_exit EXIT

echo "==> Proving isolated staging identity"
test "$(docker inspect bowin-staging-db --format '{{.Config.Image}}')" = postgres:16-alpine
test "$(docker inspect bowin-staging-db --format '{{.HostConfig.NetworkMode}}')" = bowin-staging-net
test "$(docker inspect bowin-staging-app --format '{{.HostConfig.NetworkMode}}')" = bowin-staging-net
test "$(docker inspect bowin-staging-db --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}')" = bowin-staging-pgdata

ALLOWED_ENV='^(DATABASE_URL|JWT_SECRET|METRICS_TOKEN|ADMIN_SETUP_KEY|MAILGUN_API_KEY|MAILGUN_DOMAIN|MAILGUN_BASE_URL|EMAIL_FROM_NAME|EMAIL_FROM_ADDRESS|OFFLINE_CAPABILITY_PRIVATE_KEY_BASE64|RETENTION_PURGE_ENABLED|SOFT_DELETE_RETENTION_DAYS|REGISTRATION_CONSENT_VERSION|PRIVACY_NOTICE_URL|TOURNAMENT_TERMS_URL|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|STRIPE_STARTER_PRICE_ID|STRIPE_PRO_PRICE_ID|DEBUG)='
docker inspect bowin-staging-app --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -E "$ALLOWED_ENV" > "$ENV_FILE"
if ! grep -q '^OFFLINE_CAPABILITY_PRIVATE_KEY_BASE64=' "$ENV_FILE"; then
  # First rollout of offline-capability support: the existing image predates
  # this variable, so use the root-owned staging key provisioned for it.
  test -s /etc/taekwondo.d/offline-capability-staging-private-key
  printf 'OFFLINE_CAPABILITY_PRIVATE_KEY_BASE64=%s\n' \
    "$(tr -d '\r\n' < /etc/taekwondo.d/offline-capability-staging-private-key)" >> "$ENV_FILE"
fi
DATABASE_URL=$(grep '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)
DATABASE_TARGET=${DATABASE_URL#*://}
DATABASE_TARGET=${DATABASE_TARGET#*@}
case "$DATABASE_TARGET" in
  bowin-staging-db:5432/bowin_staging|bowin-staging-db:5432/bowin_staging\?*) ;;
  *) echo "Refusing non-staging DATABASE_URL" >&2; exit 1 ;;
esac
LIVE_DATABASE_URL=$(docker inspect taekwondo-tournament --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep '^DATABASE_URL=' | cut -d= -f2-)
test "$DATABASE_URL" != "$LIVE_DATABASE_URL"

grep -q '^JWT_SECRET=' "$ENV_FILE"
grep -q '^METRICS_TOKEN=' "$ENV_FILE"
grep -q '^OFFLINE_CAPABILITY_PRIVATE_KEY_BASE64=' "$ENV_FILE"
printf '%s\n' \
  'NODE_ENV=production' \
  'PORT=3001' \
  'PUBLIC_APP_URL=https://staging-tkd.ashbi.ca' \
  'ALLOWED_ORIGINS=https://staging-tkd.ashbi.ca' \
  'ENABLE_DEMO_LOGIN=1' \
  'DEMO_ISOLATED_DATA=1' \
  'DEMO_RATE_LIMIT_MAX=30' >> "$ENV_FILE"

echo "==> Verifying and loading immutable artifact"
test "$(sha256sum "$ARCHIVE" | awk '{print $1}')" = "$ARCHIVE_SHA256"
gzip -dc "$ARCHIVE" | docker load >/dev/null
test "$(docker image inspect "$IMAGE" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$RELEASE_SHA"

echo "==> Stopping staging writes and retaining the current release"
docker rm -f bowin-staging-rollback >/dev/null 2>&1 || true
PREVIOUS_IMAGE_ID=$(docker inspect bowin-staging-app --format '{{.Image}}')
CUTOVER_STARTED=1
docker stop bowin-staging-app >/dev/null
docker rename bowin-staging-app bowin-staging-rollback
PREVIOUS_RENAMED=1

echo "==> Capturing and validating pre-migration database backup"
install -d -m 700 "$BACKUP_DIR"
BACKUP=$(mktemp "$BACKUP_DIR/bowin-staging-pre-${RELEASE_SHA}.XXXXXX.dump")
docker exec bowin-staging-db pg_dump -U bowin_staging -d bowin_staging \
  --format=custom --create > "$BACKUP"
chmod 600 "$BACKUP"
test -s "$BACKUP"
docker exec -i bowin-staging-db pg_restore --list < "$BACKUP" >/dev/null

echo "==> Running migrations and reset in a private candidate"
DB_MUTATION_STARTED=1
docker rm -f bowin-staging-candidate >/dev/null 2>&1 || true
docker run -d \
  --name bowin-staging-candidate \
  --network bowin-staging-net \
  --env-file "$ENV_FILE" \
  "$IMAGE" >/dev/null
for _ in $(seq 1 60); do
  if docker exec bowin-staging-candidate wget -q -O /dev/null \
    http://127.0.0.1:3001/api/health/ready; then CANDIDATE_HEALTHY=1; break; fi
  sleep 1
done
test "${CANDIDATE_HEALTHY:-0}" -eq 1
docker exec -e DEMO_RESET_CONFIRM=bowin-resettable-showcase-v1 \
  bowin-staging-candidate npm run demo:reset:production

echo "==> Publishing validated release"
docker rm -f bowin-staging-candidate >/dev/null
docker run -d \
  --name bowin-staging-app \
  --restart unless-stopped \
  --network bowin-staging-net \
  -p 127.0.0.1:18302:3001 \
  --env-file "$ENV_FILE" \
  "$IMAGE" >/dev/null

wait_for_health http://127.0.0.1:18302/api/health/ready
test "$(docker inspect bowin-staging-app --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$RELEASE_SHA"
wait_for_health "$STAGING_URL/api/health/ready"
PUBLIC_TOURNAMENT=$(curl -fsS "$STAGING_URL/api/public/tournaments/bowin-demo-open-registration")
printf '%s' "$PUBLIC_TOURNAMENT" | docker exec -i bowin-staging-app node -e '
  let body = "";
  process.stdin.on("data", (chunk) => { body += chunk; });
  process.stdin.on("end", () => {
    const tournament = JSON.parse(body);
    if (tournament.name !== "Future Stars Open Registration (Demo)" || tournament.status !== "registration") process.exit(1);
  });
'

DB_MUTATION_STARTED=0
CUTOVER_STARTED=0
echo "Staging release ${RELEASE_SHA} is healthy"
echo "Rollback container: bowin-staging-rollback"
echo "Verified pre-migration backup: ${BACKUP}"
REMOTE

echo "Staging now runs ${RELEASE_SHA}; execute the rehearsal before promotion."
