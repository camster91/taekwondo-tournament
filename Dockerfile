FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Generate Prisma client and build
RUN npx prisma generate && \
    npx vite build && \
    npx tsc -p tsconfig.server.json

# ─── Production image ────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Install production deps only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma ./prisma
COPY server.js ./

# Create data directory for SQLite
RUN mkdir -p /data
ENV DATABASE_URL="file:/data/tournament.db"

EXPOSE 3001

# Run migrations then start
CMD ["sh", "-c", "node -e \"require('child_process').execSync('./node_modules/.bin/prisma db push --accept-data-loss', {stdio:'inherit'})\" && node server.js"]
