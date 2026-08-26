#!/usr/bin/env bash
# Deploy the exact tracked revision to the isolated Bowin public demo only.
# Requires explicit action-time approval. It never targets staging or
# production, and retains the current demo container for rollback.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
VPS_HOST=${BOWIN_DEMO_VPS:-root@187.77.26.99}
SSH_KEY=${BOWIN_DEMO_SSH_KEY:-/c/Users/camst/.ssh/id_ed25519_hostinger}
DEMO_URL=${BOWIN_DEMO_URL:-https://demo.tkd.ashbi.ca}

cd "$ROOT"
git diff --quiet || { echo "Refusing demo deploy with unstaged tracked changes" >&2; exit 1; }
RELEASE_SHA=$(git rev-parse --verify HEAD)
ARCHIVE=$(mktemp "${TMPDIR:-/tmp}/bowin-demo-${RELEASE_SHA}.XXXXXX.tar.gz")
trap 'rm -f "$ARCHIVE"' EXIT
git archive --format=tar.gz --prefix=app/ --output="$ARCHIVE" "$RELEASE_SHA"
ARCHIVE_SHA256=$(sha256sum "$ARCHIVE" | awk '{print $1}')

ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=8 "$VPS_HOST" \
  "install -d -m 700 /opt/bowin-demo-releases"
scp -O -i "$SSH_KEY" -o BatchMode=yes "$ARCHIVE" \
  "${VPS_HOST}:/opt/bowin-demo-releases/${RELEASE_SHA}.tar.gz.part"
ssh -i "$SSH_KEY" -o BatchMode=yes "$VPS_HOST" \
  "mv /opt/bowin-demo-releases/${RELEASE_SHA}.tar.gz.part /opt/bowin-demo-releases/${RELEASE_SHA}.tar.gz"

ssh -i "$SSH_KEY" -o BatchMode=yes "$VPS_HOST" \
  "RELEASE_SHA='$RELEASE_SHA' ARCHIVE_SHA256='$ARCHIVE_SHA256' DEMO_URL='$DEMO_URL' bash -s" <<'REMOTE'
set -euo pipefail

LIVE=bowin-demo
ROLLBACK=bowin-demo-rollback
CANDIDATE=bowin-demo-candidate
IMAGE="bowin-demo-release:${RELEASE_SHA}"
RELEASE_ROOT=/opt/bowin-demo-releases
ARCHIVE="$RELEASE_ROOT/${RELEASE_SHA}.tar.gz"
RELEASE_DIR="$RELEASE_ROOT/${RELEASE_SHA}"
ENV_FILE=""
CUTOVER_STARTED=0
PREVIOUS_RENAMED=0
PREVIOUS_IMAGE_ID=""

cleanup() {
  status=$?
  set +e
  docker rm -f "$CANDIDATE" >/dev/null 2>&1 || true
  if [ "$status" -ne 0 ] && [ "$CUTOVER_STARTED" -eq 1 ] && [ "$PREVIOUS_RENAMED" -eq 1 ]; then
    docker rm -f "$LIVE" >/dev/null 2>&1 || true
    docker rename "$ROLLBACK" "$LIVE" >/dev/null 2>&1 || true
    docker start "$LIVE" >/dev/null 2>&1 || true
  fi
  [ -z "$ENV_FILE" ] || rm -f "$ENV_FILE"
  exit "$status"
}
trap cleanup EXIT

wait_for_ready() {
  local url=$1
  for _ in $(seq 1 60); do
    curl -fsS --max-time 5 "$url" >/dev/null && return 0
    sleep 1
  done
  return 1
}

docker inspect "$LIVE" >/dev/null
test "$(docker inspect "$LIVE" --format '{{.HostConfig.NetworkMode}}')" = markup-net
test "$(docker inspect "$LIVE" --format '{{(index (index .NetworkSettings.Ports "3001/tcp") 0).HostPort}}')" = 18305

ENV_FILE=$(mktemp /tmp/bowin-demo-env.XXXXXX)
chmod 600 "$ENV_FILE"
ALLOWED_ENV='^(DATABASE_URL|JWT_SECRET|METRICS_TOKEN|ADMIN_SETUP_KEY|MAILGUN_API_KEY|MAILGUN_DOMAIN|MAILGUN_BASE_URL|EMAIL_FROM_NAME|EMAIL_FROM_ADDRESS|OFFLINE_CAPABILITY_PRIVATE_KEY_BASE64|RETENTION_PURGE_ENABLED|SOFT_DELETE_RETENTION_DAYS|REGISTRATION_CONSENT_VERSION|PRIVACY_NOTICE_URL|TOURNAMENT_TERMS_URL|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|STRIPE_STARTER_PRICE_ID|STRIPE_PRO_PRICE_ID|DEBUG|ENABLE_DEMO_LOGIN|DEMO_ISOLATED_DATA|DEMO_RATE_LIMIT_MAX|PUBLIC_APP_URL|ALLOWED_ORIGINS|OPENAI_API_KEY|OPENAI_MODEL|OPENAI_BASE_URL|SUPPORT_ALERT_EMAIL)='
docker inspect "$LIVE" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E "$ALLOWED_ENV" > "$ENV_FILE"

grep -q '^ENABLE_DEMO_LOGIN=1$' "$ENV_FILE"
grep -q '^DEMO_ISOLATED_DATA=1$' "$ENV_FILE"
for integration_key in MAILGUN_API_KEY STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET OPENAI_API_KEY SUPPORT_ALERT_EMAIL; do
  if grep -q "^${integration_key}=." "$ENV_FILE"; then
    echo "Refusing demo deploy with configured external integration: ${integration_key}" >&2
    exit 1
  fi
done
DEMO_DATABASE_URL=$(grep '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)
LIVE_DATABASE_URL=$(docker inspect taekwondo-tournament --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^DATABASE_URL=' | cut -d= -f2-)
test -n "$DEMO_DATABASE_URL"
test "$DEMO_DATABASE_URL" != "$LIVE_DATABASE_URL"

test "$(sha256sum "$ARCHIVE" | awk '{print $1}')" = "$ARCHIVE_SHA256"
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"
tar xzf "$ARCHIVE" -C "$RELEASE_DIR" --strip-components=1
PUBLIC_KEY=$(tr -d '\r\n' < /etc/taekwondo.d/offline-capability-demo-public-key)
test -n "$PUBLIC_KEY"
docker build \
  --build-arg "VITE_OFFLINE_CAPABILITY_PUBLIC_KEY_BASE64=${PUBLIC_KEY}" \
  --label "org.opencontainers.image.revision=${RELEASE_SHA}" \
  -t "$IMAGE" "$RELEASE_DIR" >/tmp/bowin-demo-build-${RELEASE_SHA}.log 2>&1
test "$(docker image inspect "$IMAGE" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$RELEASE_SHA"

docker rm -f "$CANDIDATE" >/dev/null 2>&1 || true
docker run -d --name "$CANDIDATE" --network markup-net --env-file "$ENV_FILE" "$IMAGE" >/dev/null
wait_for_ready "http://$(docker inspect "$CANDIDATE" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'):3001/api/health/ready"
docker rm -f "$CANDIDATE" >/dev/null

docker rm -f "$ROLLBACK" >/dev/null 2>&1 || true
PREVIOUS_IMAGE_ID=$(docker inspect "$LIVE" --format '{{.Image}}')
docker stop "$LIVE" >/dev/null
docker rename "$LIVE" "$ROLLBACK"
PREVIOUS_RENAMED=1
CUTOVER_STARTED=1
docker run -d --name "$LIVE" --restart unless-stopped --network markup-net -p 127.0.0.1:18305:3001 --env-file "$ENV_FILE" "$IMAGE" >/dev/null
wait_for_ready http://127.0.0.1:18305/api/health/ready
wait_for_ready "$DEMO_URL/api/health/ready"
test "$(docker inspect "$LIVE" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$RELEASE_SHA"
CUTOVER_STARTED=0
echo "DEPLOYED demo revision=${RELEASE_SHA} rollback_image=${PREVIOUS_IMAGE_ID}"
REMOTE

echo "Demo release ${RELEASE_SHA} passed private and public readiness checks."
