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
    dist dist-server prisma server.js package.json package-lock.json

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
FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production
COPY --chown=node:node dist ./dist
COPY --chown=node:node dist-server ./dist-server
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node server.js ./
COPY --chown=node:node node_modules ./node_modules
USER node
EXPOSE 3001
# Prisma 7 db push needs the URL set BEFORE the config loads. The CLI
# --url flag passes it directly so it works without dotenv.
# --accept-data-loss allows additive changes that Prisma considers
# potentially-destructive (e.g. adding a UNIQUE constraint to a
# column that already has rows). For our deployments the new
# `publicSlug` column is added as NULL and the constraint is safe
# to add (all existing rows are NULL, NULL is allowed in a UNIQUE
# column in Postgres).
CMD ["sh", "-c", "./node_modules/.bin/prisma db push --accept-data-loss --url=\"$DATABASE_URL\" && node server.js"]
DOCKERFILE

echo "==> Installing prod deps (1-2 min)"
npm ci --omit=dev 2>&1 | tail -3

echo "==> Building image"
docker build -t camster91/taekwondo-tournament:build-latest . 2>&1 | tail -3

echo "==> Stopping old container"
docker rm -f taekwondo-tournament 2>/dev/null || true

echo "==> Reading DB password from markup-postgres"
DB_PW=$(docker exec markup-postgres printenv POSTGRES_PASSWORD)
echo "DB password length: ${#DB_PW}"

echo "==> Reading JWT secret"
JWT_SECRET=$(cat /etc/taekwondo.d/jwt-secret)
echo "JWT secret length: ${#JWT_SECRET}"

echo "==> Exporting JWT_SECRET into the docker run environment"
# Write env to a temp file so the secret never appears on the docker run cmdline
ENV_FILE=$(mktemp /tmp/tkd-env.XXXXXX)
chmod 600 "$ENV_FILE"
echo "NODE_ENV=production" > "$ENV_FILE"
echo "PORT=3001" >> "$ENV_FILE"
printf "JWT_SECRET=%s\n" "$JWT_SECRET" >> "$ENV_FILE"
echo "DATABASE_URL=postgresql://markup:${DB_PW}@markup-postgres:5432/taekwondo?schema=public" >> "$ENV_FILE"
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
DEPLOY_SCRIPT

echo "==> Done. Live at https://tkd.ashbi.ca"
