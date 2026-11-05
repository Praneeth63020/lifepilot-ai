# LifePilot AI — Railway demo deployment (no OpenAI credits)

This is a deployment recipe for the existing monorepo. It deploys five Railway services:

- `api` — Express API (private service, port 4000)
- `worker` — BullMQ background worker (private service)
- `web` — Nginx serving the SPA and proxying `/api` to `api.railway.internal:4000` (public, port 8080)
- Postgres — managed Railway PostgreSQL
- Redis — managed Railway Redis

## Deployment-specific files

Use these Dockerfiles with the repository root as the build context:

- API service: `infrastructure/Dockerfile.railway-api`
- Worker service: `infrastructure/Dockerfile.railway-worker`
- Web service: `infrastructure/Dockerfile.railway-web`

The web Dockerfile uses `infrastructure/nginx.railway.conf.template`. Name the Railway API service exactly `api` so its private hostname is `api.railway.internal`.

## Demo-mode settings

Set on both `api` and `worker` services:

```env
NODE_ENV=production
LOG_LEVEL=info
API_PORT=4000
DEMO_MODE=true
AI_PROVIDER=mock
OPENAI_MODEL=gpt-4.1-mini
AI_TIMEOUT_MS=15000
```

Do not set `OPENAI_API_KEY`. Do not configure Google OAuth variables for this demo deployment. The app will use its built-in rule-based extractor and synthetic Gmail/Calendar data.

Set `DATABASE_URL` as a Railway reference to the Postgres service's `DATABASE_URL`, and `REDIS_URL` as a reference to the Redis service's `REDIS_URL`.

Generate strong secrets locally:

```bash
openssl rand -base64 48   # SESSION_SECRET
openssl rand -base64 32   # TOKEN_ENCRYPTION_KEY
```

Add the outputs as `SESSION_SECRET` and `TOKEN_ENCRYPTION_KEY` in Railway Variables. Generate distinct values for separate deployments and retain them safely. Never commit them.

## Production URLs

After creating the `web` service and generating its Railway domain, set both variables on `api` and `worker` to the public web URL:

```env
API_URL=https://YOUR-WEB-DOMAIN.up.railway.app
WEB_URL=https://YOUR-WEB-DOMAIN.up.railway.app
```

The app deliberately serves web and API from one origin so its httpOnly session cookie remains same-origin. The API does not need a public domain. Configure the `web` service's public domain to target port `8080`.

On the `web` service set:

```env
API_UPSTREAM=api.railway.internal:4000
```

## SMTP requirement

The current `packages/core/src/config.ts` requires `SMTP_URL` whenever `NODE_ENV=production`, even when `DEMO_MODE=true`. Configure a transactional SMTP provider on both `api` and `worker` services. Brevo's free plan currently includes 300 email sends per day; verify a sender and use the SMTP login and SMTP key (not the Brevo API key). Example format:

```env
SMTP_URL=smtp://URL_ENCODED_SMTP_LOGIN:URL_ENCODED_SMTP_KEY@smtp-relay.brevo.com:587
MAIL_FROM=LifePilot AI <YOUR_VERIFIED_SENDER_EMAIL>
```

URL-encode any reserved characters in SMTP username/password. Keep credentials only in Railway Variables.

## Service setup sequence

1. Create an Empty Project in Railway.
2. Add a managed PostgreSQL service and a managed Redis service.
3. Add `api` from GitHub repo `Praneeth63020/lifepilot-ai`; set Dockerfile path to `infrastructure/Dockerfile.railway-api`; add all API variables above; reference Postgres and Redis variables.
4. Add `worker` from the same GitHub repo; set Dockerfile path to `infrastructure/Dockerfile.railway-worker`; add the same shared variables and database references. Do not generate a public domain for the worker.
5. Add `web` from the same GitHub repo; set Dockerfile path to `infrastructure/Dockerfile.railway-web`; set `API_UPSTREAM=api.railway.internal:4000`; expose port `8080` and generate a public domain.
6. Copy the generated web domain into `API_URL` and `WEB_URL` on API and worker, then redeploy those services.
7. Wait for API startup logs to show database migrations applied and API listening. Check `https://YOUR-WEB-DOMAIN.up.railway.app/api/v1/health/ready`.
8. Open the public web URL, register an account, finish onboarding, and choose **Load demo data**. This creates synthetic emails, calendar events, and tasks. No real Google account or OpenAI API credits are used.

## Notes

- The API Dockerfile runs database migrations before starting the API.
- API and worker must share the same Postgres and Redis references.
- `NODE_ENV=production` requires HTTPS `API_URL` and `WEB_URL`, strong secrets, and `SMTP_URL` in the current application code.
- Keep Google OAuth variables unset for the demo deployment; Google connection buttons will be unavailable, and synthetic data is loaded from Settings/Onboarding.
- Railway hosting is separate from OpenAI billing. Railway's trial and ongoing resource charges/limits are described on its pricing pages. Monitor Railway usage before leaving services running.
- Do not seed the demo account with `pnpm db:seed` in production; that script explicitly refuses production. Create a normal account and load synthetic data through the UI.
