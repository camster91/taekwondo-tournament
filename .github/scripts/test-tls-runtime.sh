#!/usr/bin/env bash
set -euo pipefail
[[ ${GITHUB_ACTIONS:-} == true && ${RELEASE_SHA:-} =~ ^[a-f0-9]{40}$ ]]
[[ ${BOWIN_CHECKED_IMAGE:-} == "bowin-rebuild-checked-runtime:$RELEASE_SHA" ]]
prefix="bowin-tls-${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}"
network="$prefix-network"; database="$prefix-database"; runtime="$prefix-runtime"; proxy="$prefix-proxy"
for name in "$database" "$runtime" "$proxy"; do ! docker inspect "$name" >/dev/null 2>&1; done
! docker network inspect "$network" >/dev/null 2>&1
fixture=$(mktemp -d)
cleanup() {
 docker rm -f "$proxy" "$runtime" "$database" >/dev/null 2>&1 || true
 docker network rm "$network" >/dev/null 2>&1 || true
 rm -rf -- "$fixture"
}
trap cleanup EXIT
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=127.0.0.1 \
 -addext subjectAltName=IP:127.0.0.1 -keyout "$fixture/key.pem" -out "$fixture/cert.pem" 2>/dev/null
cat > "$fixture/nginx.conf" <<EOF
server {
 listen 443 ssl;
 ssl_certificate /fixture/cert.pem;
 ssl_certificate_key /fixture/key.pem;
 location / {
  proxy_pass http://$runtime:3001;
  proxy_set_header Host \$http_host;
  proxy_set_header X-Forwarded-Proto https;
 }
}
EOF
docker network create "$network" >/dev/null
database_name=bowin_rebuild_qa_tls_ci
internal_url="postgres://postgres:QaDatabaseOnly-123456@$database:5432/$database_name"
docker run -d --name "$database" --network "$network" --label "bowin.qa.fixture=$prefix" \
 --tmpfs /var/lib/postgresql/data -e POSTGRES_PASSWORD=QaDatabaseOnly-123456 \
 -e POSTGRES_DB="$database_name" postgres:16-alpine >/dev/null
for attempt in $(seq 1 60); do
 if docker exec "$database" pg_isready -U postgres -d "$database_name" >/dev/null 2>&1; then break; fi
 [[ $attempt != 60 ]] || exit 1
 sleep 1
done
for attempt in 1 2; do
 docker run --rm --network "$network" -e DATABASE_URL="$internal_url" \
  -e REBUILD_DATABASE_NAME="$database_name" "$BOWIN_CHECKED_IMAGE" node src/migrate.mjs
done
docker run -d --name "$runtime" --network "$network" --label "bowin.qa.fixture=$prefix" \
 -e DATABASE_URL="$internal_url" -e REBUILD_DATABASE_NAME="$database_name" \
 -e APP_ORIGIN=https://127.0.0.1:19443 \
 -e SETUP_TOKEN=QaSetupOnly-QaSetupOnly-QaSetupOnly-QaSetupOnly- "$BOWIN_CHECKED_IMAGE" >/dev/null
[[ $(docker exec "$runtime" id -u) == 1000 ]]
! docker inspect "$runtime" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -q '^LOCAL_QA='
docker run -d --name "$proxy" --network "$network" -p 127.0.0.1:19443:443 \
 -v "$fixture:/fixture:ro" -v "$fixture/nginx.conf:/etc/nginx/conf.d/default.conf:ro" nginx:alpine >/dev/null
for attempt in $(seq 1 60); do
 if curl --connect-timeout 2 --max-time 3 --insecure --silent --fail https://127.0.0.1:19443/api/health/ready >/dev/null; then break; fi
 [[ $attempt != 60 ]] || exit 1
 sleep 1
done
export BROWSER_QA_REVISION="$RELEASE_SHA" BROWSER_QA_ORIGIN=https://127.0.0.1:19443 \
 BOWIN_TLS_QA_PREFIX="$prefix" BROWSER_QA_RESTART_SCRIPT=.github/scripts/restart-tls-fixture.sh
node replacement/test/browser-qa.cjs
docker rm -f "$proxy" "$runtime" "$database" >/dev/null
docker network rm "$network" >/dev/null
for name in "$database" "$runtime" "$proxy"; do ! docker inspect "$name" >/dev/null 2>&1; done
! docker network inspect "$network" >/dev/null 2>&1
echo 'Imported production-mode TLS browser, secure session and restart checks passed; disposable fixtures removed'
