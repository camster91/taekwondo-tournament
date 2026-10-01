# Prisma's current stream dependency requires Node 22, so the build and
# runtime use the same pinned, supported baseline.
FROM node:22.18-alpine3.22 AS builder

# Client build variables. Vite inlines every VITE_* value into the bundle
# at `vite build`, so they must be build args (Coolify: "Build Variable");
# setting them only at runtime has no effect. All are public values.
ARG VITE_OFFLINE_CAPABILITY_PUBLIC_KEY_BASE64
ARG VITE_SENTRY_DSN
ARG VITE_SENTRY_ENVIRONMENT
ARG VITE_CRISP_WEBSITE_ID
ARG VITE_POSTHOG_KEY
ARG VITE_TUTORIAL_QUICKSTART_URL
ARG VITE_TUTORIAL_IMPORT_URL
ARG VITE_TUTORIAL_RUN_EVENT_URL
ENV VITE_OFFLINE_CAPABILITY_PUBLIC_KEY_BASE64=${VITE_OFFLINE_CAPABILITY_PUBLIC_KEY_BASE64} \
    VITE_SENTRY_DSN=${VITE_SENTRY_DSN} \
    VITE_SENTRY_ENVIRONMENT=${VITE_SENTRY_ENVIRONMENT} \
    VITE_CRISP_WEBSITE_ID=${VITE_CRISP_WEBSITE_ID} \
    VITE_POSTHOG_KEY=${VITE_POSTHOG_KEY} \
    VITE_TUTORIAL_QUICKSTART_URL=${VITE_TUTORIAL_QUICKSTART_URL} \
    VITE_TUTORIAL_IMPORT_URL=${VITE_TUTORIAL_IMPORT_URL} \
    VITE_TUTORIAL_RUN_EVENT_URL=${VITE_TUTORIAL_RUN_EVENT_URL}

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
# Git revision reported by /api/health. The deploy scripts and CI pass
# --build-arg BUILD_SHA=<sha>; Coolify supplies SOURCE_COMMIT.
ARG SOURCE_COMMIT=unknown
ARG BUILD_SHA=${SOURCE_COMMIT}
ENV BUILD_SHA=${BUILD_SHA}
# DATABASE_URL and the other secrets are provided at runtime by the
# platform (Coolify environment variables, or --env-file on the VPS).

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

# Persistent upload storage (organization logos, LOGO_STORAGE_PATH).
# Created node-owned so the unprivileged server can write it; mount a
# volume / persistent storage here or uploads are lost on redeploy.
ENV LOGO_STORAGE_PATH=/app/data/logos
RUN mkdir -p /app/data/logos && chown -R node:node /app/data
VOLUME ["/app/data"]

# Switch to node user for security
USER node

EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-3001}/api/health/ready" || exit 1

# Run schema migrations and start server (use local prisma binary to ensure correct version).
# Closes D1 + D2: previously the deploy used `prisma db push --accept-data-loss`,
# which silently applies schema changes that Prisma considers "potentially
# destructive" (column drops, type changes that lose data). The new flow
# uses `migrate deploy`, which replays the checked-in `prisma/migrations/`
# directory. Schema changes now require a new migration file in the PR.
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node server.js"]
