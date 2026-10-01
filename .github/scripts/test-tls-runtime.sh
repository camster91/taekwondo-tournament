#!/usr/bin/env bash
set -euo pipefail
[[ ${GITHUB_ACTIONS:-} == true && ${RELEASE_SHA:-} =~ ^[a-f0-9]{40}$ ]]
[[ ${BOWIN_CHECKED_IMAGE:-} == "bowin-rebuild-checked-runtime:$RELEASE_SHA" ]]
export BOWIN_TLS_QA_PREFIX="bowin-tls-${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}"
export BOWIN_PRODUCTION_COMPOSE_QA=true
python3 replacement/test/production-compose-qa.py run
