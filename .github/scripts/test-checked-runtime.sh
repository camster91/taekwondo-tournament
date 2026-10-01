#!/usr/bin/env bash
set -euo pipefail
[[ ${GITHUB_ACTIONS:-} == true && ${RELEASE_SHA:-} =~ ^[a-f0-9]{40}$ ]]
[[ ${BOWIN_CHECKED_IMAGE:-} == "bowin-rebuild-checked-runtime:$RELEASE_SHA" ]]
prefix="bowin-checked-${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}"
network="$prefix-network"
database="$prefix-database"
runtime="$prefix-runtime"
cleanup() {
  docker rm -f "$runtime" "$database" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT
# A dedicated bridge supplies loopback-only published ports to the host test
# client. Docker's internal-only bridge can omit these bindings on newer engines.
# Neither database nor application is published on an external interface.
docker network create "$network" >/dev/null
password="QaDatabaseOnly-123456"
setup_token="QaSetupOnly-QaSetupOnly-QaSetupOnly-QaSetupOnly-"
database_name=bowin_rebuild_qa_checked_ci
internal_url="postgres://postgres:$password@$database:5432/$database_name"
docker run -d --name "$database" --network "$network" \
  -p 127.0.0.1::5432 --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD="$password" -e POSTGRES_DB="$database_name" \
  postgres:16-alpine >/dev/null
for attempt in $(seq 1 60); do
  if docker exec "$database" pg_isready -U postgres -d "$database_name" >/dev/null 2>&1; then break; fi
  [[ $attempt != 60 ]] || exit 1
  sleep 1
done
for attempt in 1 2; do
  docker run --rm --network "$network" -e DATABASE_URL="$internal_url" \
    -e REBUILD_DATABASE_NAME="$database_name" "$BOWIN_CHECKED_IMAGE" node src/migrate.mjs
done
docker run -d --name "$runtime" --network "$network" -p 127.0.0.1::3001 \
  -e DATABASE_URL="$internal_url" -e REBUILD_DATABASE_NAME="$database_name" \
  -e APP_ORIGIN=https://qa.example.invalid -e SETUP_TOKEN="$setup_token" \
  "$BOWIN_CHECKED_IMAGE" >/dev/null
[[ $(docker exec "$runtime" id -u) == 1000 ]]
runtime_port=$(docker inspect --format '{{(index (index .NetworkSettings.Ports "3001/tcp") 0).HostPort}}' "$runtime")
database_port=$(docker inspect --format '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}' "$database")
export BOWIN_CHECKED_RUNTIME_URL="http://127.0.0.1:$runtime_port"
export DATABASE_URL="postgres://postgres:$password@127.0.0.1:$database_port/$database_name"
export REBUILD_DATABASE_NAME="$database_name"
ready() {
  for attempt in $(seq 1 60); do
    if node --input-type=module -e 'const r=await fetch(process.env.BOWIN_CHECKED_RUNTIME_URL+"/api/health/ready");const b=await r.json();if(!r.ok||b.revision!==process.env.RELEASE_SHA)process.exit(1)' >/dev/null 2>&1; then return; fi
    sleep 1
  done
  echo 'Checked runtime readiness did not recover' >&2
  docker inspect --format '{{.State.Status}} exit={{.State.ExitCode}}' "$runtime" >&2
  return 1
}
ready
(cd replacement && node --test test/isolation.test.mjs)
# Save data identity, run the image migrations twice again, and restart the
# same tested runtime. Migrations/restart must preserve every application row.
snapshot() {
  docker exec -i "$database" psql -X -q -A -t -v ON_ERROR_STOP=1 -U postgres -d "$database_name" <<'SQL'
SELECT format('SELECT %L || ''|'' || count(*)::text || ''|'' || md5(coalesce(string_agg(row_to_json(t)::text,chr(10) ORDER BY row_to_json(t)::text COLLATE "C"),'''')) FROM %I.%I t;',tablename,schemaname,tablename)
FROM pg_tables WHERE schemaname='bowin_rebuild' ORDER BY tablename
\gexec
SQL
}
before=$(snapshot)
for attempt in 1 2; do
  docker run --rm --network "$network" -e DATABASE_URL="$internal_url" \
    -e REBUILD_DATABASE_NAME="$database_name" "$BOWIN_CHECKED_IMAGE" node src/migrate.mjs
done
docker restart "$runtime" >/dev/null
# Docker may assign a new ephemeral loopback host port on restart.
runtime_port=$(docker inspect --format '{{(index (index .NetworkSettings.Ports "3001/tcp") 0).HostPort}}' "$runtime")
export BOWIN_CHECKED_RUNTIME_URL="http://127.0.0.1:$runtime_port"
ready
after=$(snapshot)
[[ "$before" == "$after" && -n "$before" ]]
node --input-type=module -e 'const r=await fetch(process.env.BOWIN_CHECKED_RUNTIME_URL+"/api/me");if(r.status!==401)process.exit(1)'
echo 'Imported checked runtime: full API isolation journey, migrations and restart data preservation passed'
