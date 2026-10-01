FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY src ./src
COPY migrations ./migrations
FROM base AS test
COPY test ./test
CMD ["npm","test"]
FROM base AS runtime
ARG SOURCE_COMMIT
ENV RELEASE_SHA=$SOURCE_COMMIT
LABEL org.opencontainers.image.revision=$SOURCE_COMMIT
ENV NODE_ENV=production PORT=3001
USER node
EXPOSE 3001
CMD ["node","src/server.mjs"]
