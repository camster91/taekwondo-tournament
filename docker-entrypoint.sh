#!/bin/sh
# Container entrypoint: run schema migrations, then exec the server.
#
# Closes SH-8 (the silent-regression platform HIGH):
# The previous `CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node server.js"]`
# made `sh` PID 1 inside the container. When Docker / Coolify / `docker stop`
# sent SIGTERM, `sh` exited without forwarding the signal to its `node`
# child — so the graceful-shutdown block at `src/server/index.ts:412` was
# dead code on every production restart, deploy, and `docker stop`. In-flight
# scoreboard and billing-webhook requests 502'd; the Prisma connection pool
# leaked one connection per restart.
#
# The fix:
#   1. Use this entrypoint as PID 1 (or as tini's direct child when
#      `--init` is set on `docker run` / `init: true` in `docker-compose.yml`).
#   2. `exec node server.js "$@"` at the end. `exec` replaces this shell
#      with the node process, so node becomes a direct child of PID 1 (or
#      tini) and receives SIGTERM directly. Without `exec`, node would be
#      a child of this shell, and the shell would exit on SIGTERM without
#      forwarding — the same bug we are fixing.
#   3. Belt-and-suspenders: the deploy scripts also pass `--init` on
#      `docker run`, so tini is the actual PID 1 and reaps zombie
#      subprocesses (e.g. Prisma engine workers) in addition to forwarding
#      the signal.
#
# MIGRATE_SKIP=1 is honored to allow local/test runs that do not have a
# reachable database. Production / staging / demo deploys never set it.
set -eu

if [ "${MIGRATE_SKIP:-0}" != "1" ]; then
  ./node_modules/.bin/prisma migrate deploy
fi

exec node server.js "$@"
