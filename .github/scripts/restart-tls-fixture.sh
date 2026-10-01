#!/usr/bin/env bash
set -euo pipefail
[[ ${GITHUB_ACTIONS:-} == true ]]
[[ ${BOWIN_TLS_QA_PREFIX:-} =~ ^bowin-tls-[0-9]+-[0-9]+$ ]]
database="$BOWIN_TLS_QA_PREFIX-database"
runtime="$BOWIN_TLS_QA_PREFIX-runtime"
[[ $(docker inspect "$database" --format '{{index .Config.Labels "bowin.qa.fixture"}}') == "$BOWIN_TLS_QA_PREFIX" ]]
[[ $(docker inspect "$runtime" --format '{{index .Config.Labels "bowin.qa.fixture"}}') == "$BOWIN_TLS_QA_PREFIX" ]]
echo "Restarting disposable Bowin TLS fixture: ${1:-unknown}"
case ${1:-} in
 database)
  started=$(docker inspect "$runtime" --format '{{.State.StartedAt}}')
  docker restart "$database" >/dev/null
  for attempt in $(seq 1 60); do
   if docker exec "$database" pg_isready -U postgres >/dev/null 2>&1; then break; fi
   [[ $attempt != 60 ]] || exit 1
   sleep 1
  done
  [[ $(docker inspect "$runtime" --format '{{.State.StartedAt}}') == "$started" ]]
  [[ $(docker inspect "$runtime" --format '{{.State.Running}}') == true ]]
  ;;
 runtime) docker restart "$runtime" >/dev/null ;;
 *) exit 1 ;;
esac
