# Multi-stage build for the API, worker and web app.
#   docker build -f infrastructure/Dockerfile --target api    -t lifepilot-api .
#   docker build -f infrastructure/Dockerfile --target worker -t lifepilot-worker .
#   docker build -f infrastructure/Dockerfile --target web    -t lifepilot-web .
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @lifepilot/api --filter @lifepilot/worker --filter @lifepilot/web build
# Flat production node_modules for each server app (workspace code is already bundled into dist/).
RUN pnpm --filter @lifepilot/api deploy --prod --legacy --config.node-linker=hoisted /out/api \
 && pnpm --filter @lifepilot/worker deploy --prod --legacy --config.node-linker=hoisted /out/worker \
 && cp -r packages/db/migrations /out/api/migrations

FROM node:22-bookworm-slim AS api
ENV NODE_ENV=production MIGRATIONS_DIR=/app/migrations
WORKDIR /app
COPY --from=build /out/api/node_modules ./node_modules
COPY --from=build /out/api/dist ./dist
COPY --from=build /out/api/migrations ./migrations
COPY --from=build /out/api/package.json ./package.json
USER node
EXPOSE 4000
# Run migrations, then start. Use a separate release step instead if you run several API replicas.
CMD ["sh", "-c", "node dist/scripts/migrate.js && node dist/server.js"]

FROM node:22-bookworm-slim AS worker
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/worker/node_modules ./node_modules
COPY --from=build /out/worker/dist ./dist
COPY --from=build /out/worker/package.json ./package.json
USER node
CMD ["node", "dist/main.js"]

FROM nginx:1.27-alpine AS web
COPY infrastructure/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
