#!/bin/bash
# Deploy taekwondo-tournament to Hostinger VPS (coolify@187.77.26.99).
#
# Strategy: build client + server on Mac, tar the artifacts, scp to
# the VPS, extract to /opt/taekwondo-tournament/, build a small image,
# run the container with the prod DB URL.
#
# Pre-reqs on the VPS (one-time):
#   - The 'taekwondo' database already exists on the markup-postgres container
#   - /etc/taekwondo-jwt-secret file contains a strong random secret
#
# Rollback: docker rm -f taekwondo-tournament && rm -rf /opt/taekwondo-tournament

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

echo "==> Uploading to VPS"
scp "$TARBALL" "$VPS:/tmp/"

echo "==> Deploying on VPS"
ssh "$VPS" "set -e
    rm -rf $REMOTE_BUILD_DIR
    mkdir -p $REMOTE_BUILD_DIR
    cd $REMOTE_BUILD_DIR
    tar xzf $TARBALL
    rm $TARBALL

    # Minimal Dockerfile: pre-built artifacts only, no npm install.
    # We DO need node_modules with the Prisma engine binary, so install
    # prod deps once at deploy time.
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
CMD ['sh', '-c', './node_modules/.bin/prisma db push --skip-generate && node server.js']
DOCKERFILE

    # Install prod deps (with prisma engines) into the build dir so the
    # COPY above picks them up. ~120MB.
    npm ci --omit=dev

    echo '==> Building image'
    docker build -t camster91/taekwondo-tournament:build-latest .

    echo '==> Stopping old container (if any)'
    docker rm -f taekwondo-tournament 2>/dev/null || true

    echo '==> Starting new container'
    docker run -d \\
        --name taekwondo-tournament \\
        --restart unless-stopped \\
        -p 127.0.0.1:18301:3001 \\
        -e NODE_ENV=production \\
        -e PORT=3001 \\
        -e JWT_SECRET=\"\$(cat /etc/taekwondo-jwt-secret 2>/dev/null || echo dev-only-not-for-prod)\" \\
        -e DATABASE_URL=\"postgresql://markup:bKADG4...TH-w@markup-postgres:5432/taekwondo?schema=public\" \\
        camster91/taekwondo-tournament:build-latest

    echo '==> Container status:'
    sleep 3
    docker ps --filter 'name=taekwondo-tournament' --format '{{.Names}} {{.Status}} {{.Ports}}'
    echo '==> Recent logs:'
    docker logs --tail 20 taekwondo-tournament 2>&1 | head -30
"

echo "==> Done. Test at http://localhost:18301 (or via caddy once DNS is set)"
