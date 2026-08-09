#!/bin/bash
# Deploy taekwondo-tournament to Hostinger VPS (coolify@187.77.26.99).
#
# One-time VPS setup (before first deploy):
#   1. Database: docker exec markup-postgres createdb -U markup taekwondo
#      (or use the existing 'taekwondo' DB on markup-postgres)
#   2. JWT secret: openssl rand -base64 48 > /etc/taekwondo.d/jwt-secret && chmod 600
#   3. Caddy entry: append "tkd.ashbi.ca { reverse_proxy 127.0.0.1:18301 }"
#      to /opt/caddy/Caddyfile, then systemctl reload caddy
#   4. DNS: A record tkd.ashbi.ca -> 187.77.26.99 (already set)
#
# Strategy (mirrors the jw-habits pattern from memory):
#   1. Build dist/ + dist-server/ locally
#   2. Tar them
#   3. Pipe to the VPS via ssh + cat (scp tends to fail on this box)
#   4. Extract into /opt/taekwondo-tournament/, install prod deps, build
#   5. Run the container with --network markup-net so it can reach the
#      existing markup-postgres instance
#
# Rollback: ssh coolify "docker rm -f taekwondo-tournament && rm -rf /opt/taekwondo-tournament"

set -e
PROJECT="$HOME/taekwondo-tournament"
VPS="coolify"
REMOTE_BUILD_DIR="/opt/taekwondo-tournament"
TARBALL="/tmp/taekwondo-tournament-build.tar.gz"

echo "==> Building client + server locally"
cd "$PROJECT"
npm run build

echo "==> Creating tarball"
tar czf "$TARBALL" \
    -C "$PROJECT" \
    dist dist-server dist-demo prisma prisma.config.ts server.js package.json package-lock.json

echo "==> Uploading to VPS via ssh cat pipe (scp is unreliable here)"
cat "$TARBALL" | ssh "$VPS" "cat > $TARBALL && rm -rf $REMOTE_BUILD_DIR && mkdir -p $REMOTE_BUILD_DIR && cd $REMOTE_BUILD_DIR && tar xzf $TARBALL && rm $TARBALL && echo 'extracted to ' \$(pwd)"

echo "==> Building + starting container on VPS"
ssh "$VPS" <<'DEPLOY_SCRIPT'
set -e
cd /opt/taekwondo-tournament

# Minimal Dockerfile: pre-built artifacts only, no npm install at deploy.
# We DO need node_modules with the Prisma engine binary, so install
# prod deps once at deploy time. ~120MB.
cat > Dockerfile <<'DOCKERFILE'
FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production
COPY --chown=node:node dist ./dist
COPY --chown=node:node dist-server ./dist-server
COPY --chown=node:node dist-demo ./dist-demo
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node prisma.config.ts ./
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node server.js ./
COPY --chown=node:node node_modules ./node_modules
USER node
EXPOSE 3001
# Prisma migrate deploy: replays the checked-in prisma/migrations/
# directory. Schema changes now require a new migration file in
# the PR (closes D1 + D2 — the old `db push --accept-data-loss`
# silently applied destructive changes).
#
# Node 22 LTS is required because prisma 7.x's CLI transitively
# requires `zeptomatch` (ESM-only) from a CommonJS context via
# `require(esm)`. Node 20.x has the feature behind a flag and
# recurses infinitely on circular ESM imports (verified on
# 20.18.0). Node 22.12+ enables require(esm) by default with
# the recursion bug fixed.
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node server.js"]
DOCKERFILE

echo "==> Installing prod deps (1-2 min)"
npm ci --omit=dev 2>&1 | tail -3

echo "==> Reading DB password from markup-postgres"
DB_PW=$(docker exec markup-postgres printenv POSTGRES_PASSWORD)
echo "DB password length: ${#DB_PW}"

echo "==> Reading JWT secret"
JWT_SECRET=$(cat /etc/taekwondo.d/jwt-secret)
echo "JWT secret length: ${#JWT_SECRET}"

echo "==> Writing .env (prisma.config.ts loads this via dotenv/config at config-load time)"
cat > /opt/taekwondo-tournament/.env <<ENVEOF
NODE_ENV=production
PORT=3001
DATABASE_URL=postgresql://markup:${DB_PW}@markup-postgres:5432/taekwondo?schema=public
JWT_SECRET=${JWT_SECRET}
ENABLE_DEMO_LOGIN=1
DEMO_ISOLATED_DATA=1
DEMO_RATE_LIMIT_MAX=30
PUBLIC_APP_URL=https://tkd.ashbi.ca
# ALLOWED_ORIGINS gates the CORS middleware in src/server/index.ts
# and is also required at startup by the production env-validation
# check (added in commit e2759c5 — closes D9). Hardcoded to the
# single public origin of this deployment; add additional origins
# comma-separated if you stand up a second frontend (e.g. a
# staging URL behind a different hostname).
ALLOWED_ORIGINS=https://tkd.ashbi.ca
ENVEOF
for var in MAILGUN_API_KEY MAILGUN_DOMAIN MAILGUN_BASE_URL EMAIL_FROM_NAME EMAIL_FROM_ADDRESS; do
    val=$(grep -E "^${var}=" /etc/taekwondo.d/app-env 2>/dev/null | head -1 | cut -d= -f2-)
    if [ -n "$val" ]; then
        printf "%s=%s\n" "$var" "$val" >> /opt/taekwondo-tournament/.env
    fi
done
chmod 600 /opt/taekwondo-tournament/.env

echo "==> Building image"
docker build -t camster91/taekwondo-tournament:build-latest . 2>&1 | tail -3

echo "==> Stopping old container"
docker rm -f taekwondo-tournament 2>/dev/null || true

echo "==> Exporting JWT_SECRET into the docker run environment"
# Write env to a temp file so the secret never appears on the docker run cmdline
ENV_FILE=$(mktemp /tmp/tkd-env.XXXXXX)
chmod 600 "$ENV_FILE"
echo "NODE_ENV=production" > "$ENV_FILE"
echo "PORT=3001" >> "$ENV_FILE"
printf "JWT_SECRET=%s\n" "$JWT_SECRET" >> "$ENV_FILE"
echo "DATABASE_URL=postgresql://markup:${DB_PW}@markup-postgres:5432/taekwondo?schema=public" >> "$ENV_FILE"
# ALLOWED_ORIGINS must also reach the runtime container (the
# CORS middleware reads it from process.env at request time, NOT
# from the .env file that prisma loads — the docker run env is
# the runtime source of truth). The .env has the same value for
# the startup check; this ENV_FILE line is the runtime copy.
echo "ALLOWED_ORIGINS=https://tkd.ashbi.ca" >> "$ENV_FILE"
# tkd.ashbi.ca is a demo deployment. The landing page advertises
# "Try the demo. Full access for 4 hours" as the primary CTA, so
# /api/auth/demo must be reachable in this environment. The route
# creates unique, expiring principals against this deployment's
# synthetic-only database. Both production safety gates are explicit.
echo "ENABLE_DEMO_LOGIN=1" >> "$ENV_FILE"
echo "DEMO_ISOLATED_DATA=1" >> "$ENV_FILE"
echo "DEMO_RATE_LIMIT_MAX=30" >> "$ENV_FILE"
# Magic-link emails must point at the public URL so the link
# the parent clicks opens the verify page on tkd.ashbi.ca,
# not the dev origin. Used by /api/auth/request-magic-link
# to build the magicUrl.
echo "PUBLIC_APP_URL=https://tkd.ashbi.ca" >> "$ENV_FILE"
# Pass through any MAILGUN_* / EMAIL_* vars from /etc/taekwondo.d/app-env.
# Optional — if absent, the server boots in "SMTP not configured" mode
# and the magic-link auth path is a 500 to the user (the route refuses
# to enqueue a token without a real recipient). When present, this is
# what enables /api/auth/request-magic-link to deliver the link email.
for var in MAILGUN_API_KEY MAILGUN_DOMAIN MAILGUN_BASE_URL EMAIL_FROM_NAME EMAIL_FROM_ADDRESS; do
    val=$(grep -E "^${var}=" /etc/taekwondo.d/app-env 2>/dev/null | head -1 | cut -d= -f2-)
    if [ -n "$val" ]; then
        printf "%s=%s\n" "$var" "$val" >> "$ENV_FILE"
    fi
done
trap "rm -f $ENV_FILE" EXIT

echo "==> Starting container"
docker run -d \
    --name taekwondo-tournament \
    --restart unless-stopped \
    --network markup-net \
    -p 127.0.0.1:18301:3001 \
    --env-file "$ENV_FILE" \
    camster91/taekwondo-tournament:build-latest

echo "==> Container status:"
sleep 8
docker ps --filter name=taekwondo-tournament --format "{{.Names}} {{.Status}} {{.Ports}}"

echo "==> Recent logs:"
docker logs --tail 20 taekwondo-tournament 2>&1

echo "==> Healthcheck gate (closes D17)"
HEALTHY=0
for i in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:18301/api/health/ready" >/dev/null 2>&1; then
        echo "    ready after ${i}s"
        HEALTHY=1
        break
    fi
    sleep 1
done
if [ "$HEALTHY" -ne 1 ]; then
    echo "DEPLOY FAILED — /api/health/ready never returned 200"
    echo "Recent logs:"
    docker logs --tail 50 taekwondo-tournament 2>&1
    exit 1
fi

echo "==> Resetting the marker-protected synthetic showcase"
docker exec \
    -e DEMO_RESET_CONFIRM=bowin-resettable-showcase-v1 \
    taekwondo-tournament npm run demo:reset:production
DEPLOY_SCRIPT

echo "==> Done. Live at https://tkd.ashbi.ca"
