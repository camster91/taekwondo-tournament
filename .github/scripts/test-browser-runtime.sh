#!/usr/bin/env bash
set -euo pipefail
[[ ${GITHUB_ACTIONS:-} == true && ${RELEASE_SHA:-} =~ ^[a-f0-9]{40}$ ]]
[[ ${BOWIN_CHECKED_IMAGE:-} == "bowin-rebuild-checked-runtime:$RELEASE_SHA" ]]
prefix="bowin-browser-${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}"
network="$prefix-network"
database="$prefix-database"
runtime="$prefix-runtime"
! docker inspect "$runtime" >/dev/null 2>&1
! docker inspect "$database" >/dev/null 2>&1
! docker network inspect "$network" >/dev/null 2>&1
cleanup() {
  docker rm -f "$runtime" "$database" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker network create "$network" >/dev/null
database_name=bowin_rebuild_qa_browser_ci
internal_url="postgres://postgres:QaDatabaseOnly-123456@$database:5432/$database_name"
docker run -d --name "$database" --network "$network" --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_PASSWORD=QaDatabaseOnly-123456 -e POSTGRES_DB="$database_name" postgres:16-alpine >/dev/null
for attempt in $(seq 1 60); do
  if docker exec "$database" pg_isready -U postgres -d "$database_name" >/dev/null 2>&1; then break; fi
  [[ $attempt != 60 ]] || exit 1
  sleep 1
done
for attempt in 1 2; do
  docker run --rm --network "$network" -e DATABASE_URL="$internal_url" \
    -e REBUILD_DATABASE_NAME="$database_name" "$BOWIN_CHECKED_IMAGE" node src/migrate.mjs
done
docker run -d --name "$runtime" --network "$network" -p 127.0.0.1:19401:3001 \
  -e DATABASE_URL="$internal_url" -e REBUILD_DATABASE_NAME="$database_name" \
  -e APP_ORIGIN=http://127.0.0.1:19401 -e LOCAL_QA=true \
  -e SETUP_TOKEN=QaSetupOnly-QaSetupOnly-QaSetupOnly-QaSetupOnly- "$BOWIN_CHECKED_IMAGE" >/dev/null
[[ $(docker exec "$runtime" id -u) == 1000 ]]
for attempt in $(seq 1 60); do
  if node --input-type=module -e 'const r=await fetch("http://127.0.0.1:19401/api/health/ready");const b=await r.json();if(!r.ok||b.revision!==process.env.RELEASE_SHA)process.exit(1)' >/dev/null 2>&1; then break; fi
  [[ $attempt != 60 ]] || exit 1
  sleep 1
done
export BROWSER_QA_REVISION="$RELEASE_SHA"
node replacement/test/browser-qa.cjs
docker rm -f "$runtime" "$database" >/dev/null
docker network rm "$network" >/dev/null
! docker inspect "$runtime" >/dev/null 2>&1
! docker inspect "$database" >/dev/null 2>&1
! docker network inspect "$network" >/dev/null 2>&1
echo 'Imported browser runtime workflows and disposable cleanup passed'
