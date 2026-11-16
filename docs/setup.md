# Setup

## Prerequisites

- Node.js 22.9+ and pnpm 10 (`corepack enable`)
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
- Without `SMTP_URL`, no email is sent: the Forgot password page and Settings → Security show the link directly when you use the app on this machine (see [Email](#email)).

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

## Email

LifePilot uses two separate addresses:

| | Variable | What it does |
|---|---|---|
| **Support mailbox**, e.g. `support@yourdomain.com` | `SUPPORT_EMAIL` | Receives customer email. Shown on the website (footer, `/support`), in the app (Help & support, Settings → Support) and in every email. Hosted by a mailbox provider (Zoho Mail, Google Workspace…). |
| **Automated sender**, e.g. `no-reply@yourdomain.com` | `MAIL_FROM`, `SMTP_URL` | Sends verification, password-reset and password-changed emails through any SMTP provider (Resend, Postmark, Amazon SES…). Replies go to `MAIL_REPLY_TO`, which defaults to `SUPPORT_EMAIL`. |

### Emails LifePilot sends

| Email | When | Link |
|---|---|---|
| Verify your email address | Sign-up; Settings → Security → Resend | `WEB_URL/verify-email?token=…`, valid 48 hours, single use |
| Reset your password | Forgot password page | `WEB_URL/reset-password?token=…`, valid 1 hour, single use; using any reset link cancels every other one |
| Your password was changed | After a successful reset | Points to Forgot password, in case it wasn't the account owner |

Each email has an HTML version (LifePilot branding, a button, the link repeated as text) and a plain-text version. The templates are in [`packages/core/src/email-templates.ts`](../packages/core/src/email-templates.ts).

### Development

- **No SMTP (default):** nothing is sent. When you use the app on your own machine, the Forgot password page and Settings → Security show the link directly. The API log records only that an email wasn't sent, never its link.
- **Local inbox (Mailpit):** catches real SMTP deliveries without sending anything out.

  ```bash
  docker compose -f infrastructure/docker-compose.yml --profile mail up -d mailpit
  # .env: SMTP_URL=smtp://localhost:1025   then restart pnpm dev
  open http://localhost:8025
  ```

### Production setup, step by step

You need a domain you own (for example `yourdomain.com`). The steps below use placeholders; copy the exact DNS values from each provider's dashboard, because they differ by account and region.

**1. Support mailbox (receives email).** With Zoho Mail (other providers are similar):

1. Sign up for Zoho Mail and add your domain.
2. Verify the domain: add the TXT (or CNAME) record Zoho shows at your DNS host.
3. Add Zoho's **MX** records exactly as shown (they depend on your data centre, e.g. `zoho.com`, `zoho.in` or `zoho.eu`), and remove any old MX records.
4. Add Zoho's **SPF** TXT record on the root domain, e.g. `v=spf1 include:zoho.in ~all`. A hostname can have only one SPF record; merge if one already exists.
5. Add Zoho's **DKIM** TXT record (Zoho generates it, usually at `zmail._domainkey`).
6. Create the `support@` mailbox (or an alias), then send it a message from a personal address to confirm it arrives.

**2. Automated sending (SMTP).** With Resend:

1. Create a Resend account. **Domains → Add domain**, enter your domain.
2. Add the DNS records Resend shows: an **MX** and an **SPF** TXT record on the `send` subdomain (bounce handling) and a **DKIM** TXT record (`resend._domainkey`). They don't conflict with the mailbox records above.
3. Wait for Resend to show the domain as **Verified**.
4. **API Keys → Create API key** with *Sending access* only, limited to this domain. Copy it once; Resend won't show it again.

**3. DMARC** (both providers must be set up first). Add a TXT record at `_dmarc.yourdomain.com`:
`v=DMARC1; p=none; rua=mailto:support@yourdomain.com`. Once reports show everything passing (a week or two), tighten it to `p=quarantine`.

**4. Configure LifePilot.** Edit `.env` yourself. Never paste the API key into a chat, ticket or commit.

```bash
SMTP_URL=smtps://resend:<your Resend API key>@smtp.resend.com:465
MAIL_FROM="LifePilot AI <no-reply@yourdomain.com>"
SUPPORT_EMAIL=support@yourdomain.com
# MAIL_REPLY_TO=           # optional; defaults to SUPPORT_EMAIL
# SUPPORT_RESPONSE_TIME="within 2 business days"   # optional; shown only if set
```

Port 587 with `smtp://` (STARTTLS) also works. Percent-encode special characters in a password (`@` → `%40`). Restart the API afterwards.

**5. Check it.**

```bash
pnpm mail:check                                  # SET/MISSING + SMTP login; sends nothing
pnpm mail:check --send-to you@your-personal.com  # sends ONE test email
```

In the received email, open **Show original** (Gmail) or **View source**: SPF, DKIM and DMARC should all say **PASS**. Reply to it and confirm the reply lands in the support mailbox. Then run the real journey: register, open the verification link, use Forgot password, reset, sign in with the new password.

**Production rules.** With `NODE_ENV=production` the API refuses to start unless `SMTP_URL` is set (`smtps://` or `smtp://`), `MAIL_FROM` isn't the `example.com` placeholder, and `WEB_URL`/`API_URL` use https. Unencrypted SMTP is refused: `smtp://` must upgrade with STARTTLS.

