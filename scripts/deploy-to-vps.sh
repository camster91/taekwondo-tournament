#!/usr/bin/env bash
# Compatibility entry point. The former implementation had an unsafe mutable
# release directory and stale host assumptions; all deployments now use the
# immutable, backup-and-rollback guarded production workflow.
set -euo pipefail

exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy-production.sh" "$@"
