# Prisma's current stream dependency requires Node 22, so the build and
# runtime use the same pinned, supported baseline.
FROM node:22.18-alpine3.22 AS builder

ARG VITE_OFFLINE_CAPABILITY_PUBLIC_KEY_BASE64
ENV VITE_OFFLINE_CAPABILITY_PUBLIC_KEY_BASE64=${VITE_OFFLINE_CAPABILITY_PUBLIC_KEY_BASE64}

WORKDIR /app

# Install all dependencies (prisma needed for postinstall)
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

# Copy source code
COPY . .

# Generate prisma client, build frontend and backend
RUN ./node_modules/.bin/prisma generate && \
    npx vite build && \
    npx tsc -p tsconfig.server.json && \
    npx tsc -p tsconfig.demo.json

# ─── Production Dependencies Stage ─────────────────────────────────
FROM node:22.18-alpine3.22 AS deps

WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && ./node_modules/.bin/prisma generate

# ─── Production Image ────────────────────────────────────────────────
FROM node:22.18-alpine3.22 AS runner

WORKDIR /app

# Setup env variables
ENV NODE_ENV=production
# DATABASE_URL is provided at runtime via Coolify env vars
# (Coolify injects the linked Postgres service's connection string)

# Install OpenSSL 1.1 for Prisma engines (Alpine needs this)
RUN apk add --no-cache openssl

# Copy production dependencies and built code
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/dist-server ./dist-server
COPY --from=builder --chown=node:node /app/dist-demo ./dist-demo
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/prisma.config.ts ./prisma.config.ts
COPY --chown=node:node package.json ./
COPY --chown=node:node server.js ./

# Install the entrypoint that runs schema migrations and `exec`s the server.
# Closes SH-8 (silent-regression platform HIGH): the previous
# `CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node server.js"]`
# made `sh` PID 1 inside the container. `sh` exits on SIGTERM without
# forwarding the signal to its `node` child, so the graceful-shutdown block
# at `src/server/index.ts:412` was unreachable on every production
# restart, deploy, and `docker stop`. The entrypoint's `exec node server.js`
# replaces the shell with the node process, making node a direct child of
# PID 1 (or of tini when `--init` is set on `docker run`); SIGTERM is then
# delivered to node and the shutdown handler runs. The deploy scripts also
# pass `--init` for zombie reaping (Prisma engine workers).
COPY --chown=node:node docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Switch to node user for security
USER node

EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:3001/api/health/ready || exit 1

# Entry point is the script above; CMD is the default server invocation.
# Deploy scripts that need to run a one-shot (e.g. `prisma migrate deploy`
# alone, or `npm run demo:reset:production`) override CMD at `docker run`.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server.js"]
