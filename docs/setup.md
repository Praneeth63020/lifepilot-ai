# Setup

## Prerequisites

- Node.js 22+ and pnpm 10 (`corepack enable`)
- PostgreSQL 16 and Redis 7 — run them with Docker: `docker compose -f infrastructure/docker-compose.yml up -d postgres redis`
  (Redis must persist data — the compose file enables AOF — because scheduled reminders live there.)

## 1. Install and configure

```bash
pnpm install
cp .env.example .env
openssl rand -base64 48   # → SESSION_SECRET
openssl rand -base64 32   # → TOKEN_ENCRYPTION_KEY
```

Every variable is documented in `.env.example`. The API and worker validate configuration at startup and exit with a list of problems if anything is wrong.

## 2. Database

```bash
pnpm db:migrate        # applies packages/db/migrations
pnpm db:seed           # optional: demo@lifepilot.local / demo-password-123 (refuses to run in production)
```

After changing `packages/db/src/schema.ts`: `pnpm db:generate` creates a new SQL migration — review it, then `pnpm db:migrate`.

## 3. Run

```bash
pnpm dev               # or separately: pnpm dev:api, pnpm dev:worker, pnpm dev:web
```

- Web: http://localhost:5173 (proxies `/api` to the API, so cookies are first-party)
- API: http://localhost:4000/api/v1/health
- Without SMTP configured, verification and reset links are printed in the API log.

## 4. Tests

```bash
createdb lifepilot_test   # or: psql -c "CREATE DATABASE lifepilot_test OWNER lifepilot"
pnpm test                 # migrates lifepilot_test automatically
pnpm dev &                # e2e needs the running stack, DEMO_MODE=true
pnpm --filter @lifepilot/web exec playwright install chromium
pnpm test:e2e
```

Override with `TEST_DATABASE_URL`. Tests use Redis databases 1 and 2.

## Google OAuth

Needed only for real Gmail / Calendar. Without it the app runs on manual data and demo mode.

1. https://console.cloud.google.com → create a project.
2. **APIs & Services → Library**: enable **Gmail API** and **Google Calendar API**.
3. **OAuth consent screen**: External, add your email as a test user. Add scopes
   `https://www.googleapis.com/auth/gmail.readonly` and `https://www.googleapis.com/auth/calendar.readonly`.
4. **Credentials → Create credentials → OAuth client ID → Web application**.
   Authorized redirect URI: `http://localhost:4000/api/v1/integrations/google/callback`
   (production: `https://<your-api-host>/api/v1/integrations/google/callback`).
5. Put the client ID and secret into `.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; set `GOOGLE_REDIRECT_URI` if it differs from the default) and restart the API and worker.
6. In the app: **Settings → Connections → Connect Gmail / Connect Google Calendar**.

How to verify it end to end (not yet done for this build):
- After connecting, the card shows your Google address and "first sync pending", then "synced … ago" within a minute.
- **Settings → Connections → Recent sync activity** shows a `succeeded` job.
- Revoke access at https://myaccount.google.com/permissions, press **Sync now** → the card should switch to `revoked` with a reconnect prompt.

Testing-mode caveats: refresh tokens expire after 7 days, and only listed test users can connect. See [security.md](security.md) for production verification requirements.

## OpenAI (optional)

`AI_PROVIDER=openai`, `OPENAI_API_KEY=…`, optionally `OPENAI_MODEL`. Any API error, timeout or malformed output falls back to the built-in rule engine. Each insight records which extractor produced it. Users can switch AI analysis off in **Settings → General**.

## Web push (optional)

```bash
pnpm --filter @lifepilot/core exec web-push generate-vapid-keys
```

Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`, restart, then enable **Settings → Notifications → Browser push**. It requires HTTPS outside localhost. On iOS/iPadOS it only works for sites added to the Home Screen.
