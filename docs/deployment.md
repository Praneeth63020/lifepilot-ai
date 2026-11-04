# Deployment

Three processes share one PostgreSQL and one Redis:
- **api** — stateless; can run several instances
- **worker** — one or more instances. BullMQ guarantees each job runs on a single worker.
- **web** — static files plus a reverse proxy for `/api`

## Requirements

- Managed PostgreSQL 16 (for example Neon, RDS, Cloud SQL or Supabase).
- Managed Redis 7 **with persistence** and `maxmemory-policy noeviction` (for example Upstash with the eviction policy disabled, ElastiCache or Redis Cloud). Eviction would silently drop scheduled reminders. The worker re-enqueues everything still `scheduled` in Postgres on startup, but don't rely on that alone.
- A host for long-running Node processes, such as Render, Railway, Fly.io, ECS or Cloud Run with min instances ≥ 1 for the worker.
- HTTPS. Serve the web app and API on the **same site** (for example `app.example.com` and `api.example.com`, or one domain with `/api` proxied) so the SameSite=Lax session cookie is sent.

## Environment (production)

- `NODE_ENV=production`, `DATABASE_URL`, `REDIS_URL`
- `API_URL=https://…`, `WEB_URL=https://…`
- Fresh `SESSION_SECRET` and `TOKEN_ENCRYPTION_KEY`
- `SMTP_URL` (required in production)
- `DEMO_MODE=false`
- Google, OpenAI and VAPID variables as needed

Startup validation refuses placeholder secrets, missing SMTP and plain http.

## Docker

```bash
docker build -f infrastructure/Dockerfile --target api    -t lifepilot-api .
docker build -f infrastructure/Dockerfile --target worker -t lifepilot-worker .
docker build -f infrastructure/Dockerfile --target web    -t lifepilot-web .
# Or run everything locally:
docker compose -f infrastructure/docker-compose.yml --profile app up -d --build
```

- The `api` image runs migrations, then starts. With multiple replicas, run `node dist/scripts/migrate.js` as a one-off release step and start with `node dist/server.js`.
- The `web` image is nginx serving the SPA and proxying `/api` to `http://api:4000`. Change `infrastructure/nginx.conf` for your topology.
- Behind a load balancer, the API trusts one proxy hop in production (`trust proxy = 1`) for client IPs and secure cookies.

> These Dockerfiles were written but not built in the development environment (no Docker daemon was available). The bundled `dist/` outputs and the hoisted `pnpm deploy` layout they use *were* run and verified.

## Without Docker

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm db:migrate
node apps/api/dist/server.js
node apps/worker/dist/main.js
# serve apps/web/dist with any static host and proxy /api to the API
```

## Health and monitoring

- `GET /api/v1/health` is for liveness. `GET /api/v1/health/ready` checks Postgres and Redis and returns only up/down flags.
- Logs are JSON on stdout (pino); ship them to your log platform. Useful messages:
  - `Reminder processed` — includes the outcome
  - `Reminder delivery failed permanently`
  - `Sync attempt failed`
  - `AI extraction failed; using rule-based fallback`
- Failed jobs stay in Redis for 30 days. Inspect them with any BullMQ dashboard (for example `bull-board`) pointed at prefix `lifepilot`, queues `reminders` and `sync`.
- In-app, users can see sync history (**Settings → Connections**) and delivery status per notification (**Notifications**).

## Mobile (phase 2, not built)

Native verification will need:
- an Expo/EAS project
- an Apple Developer account (for APNs and custom sounds on iOS)
- Firebase/FCM credentials for Android
- physical devices

The `.wav` assets in `apps/web/public/sounds` can be bundled as Android notification-channel sounds and iOS notification sounds (they're under 30 s).
