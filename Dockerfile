FROM node:20-alpine AS builder

WORKDIR /app

# Install all dependencies
COPY package*.json ./
RUN npm ci

# Copy source code
COPY . .

# Generate prisma client, build frontend and backend
RUN ./node_modules/.bin/prisma generate && \
    npx vite build && \
    npx tsc -p tsconfig.server.json

# ─── Production Dependencies Stage ─────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && ./node_modules/.bin/prisma generate

# ─── Production Image ────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Setup env variables
ENV NODE_ENV=production
ENV DATABASE_URL="file:/data/tournament.db"

# Create data directory for SQLite and make it writable
RUN mkdir -p /data && chown node:node /data

# Copy production dependencies and built code
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/dist-server ./dist-server
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --chown=node:node package.json ./
COPY --chown=node:node server.js ./

# Switch to node user for security
USER node

EXPOSE 3001

# Run schema sync and start server (use local prisma binary to ensure correct version)
CMD ["sh", "-c", "./node_modules/.bin/prisma db push --skip-generate && node server.js"]