# syntax=docker/dockerfile:1.7

# Build the Vite application.
FROM oven/bun:1.3.13 AS web-build

WORKDIR /app/web
COPY web/package.json web/bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --cache-dir=/root/.bun/install/cache
COPY VERSION /app/VERSION
COPY CHANGELOG.md /app/CHANGELOG.md
COPY web ./
RUN --mount=type=secret,id=app_env,target=/app/.env,required=false bun run build

# Compile the same-origin storage API and retain production dependencies only.
FROM node:20-alpine AS storage-build

WORKDIR /app/storage-server
COPY storage-server/package.json storage-server/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY storage-server ./
RUN npm run build && npm prune --omit=dev

# Serve both the SPA and /api/storage from one origin.
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production \
    STATIC_DIR=/app/web/dist \
    STORAGE_API_PORT=3000 \
    INFINITE_CANVAS_ENV_JS=/app/web/dist/env.js

COPY --from=web-build /app/web/dist /app/web/dist
COPY --from=storage-build /app/storage-server/dist /app/storage-server/dist
COPY --from=storage-build /app/storage-server/migrations /app/storage-server/migrations
COPY --from=storage-build /app/storage-server/package.json /app/storage-server/package.json
COPY --from=storage-build /app/storage-server/node_modules /app/storage-server/node_modules
COPY docker/runtime-env.sh /app/runtime-env.sh
RUN chmod +x /app/runtime-env.sh

EXPOSE 3000
ENTRYPOINT ["/app/runtime-env.sh"]
CMD ["node", "/app/storage-server/dist/server.js"]
