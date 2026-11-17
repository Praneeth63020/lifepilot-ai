# Validating real integrations

LifePilot's Google, OpenAI and web-push code is covered by automated tests against fake versions of each service. The steps below check each one against the **real** service. They need your own accounts, keys and devices, so they are run by hand.

Keep the results honest: a feature is "validated" only after it worked against the real service. Record the date and result in the README's status table.

Never paste keys or secrets into chats, issues or screenshots. Enter them directly in `.env` (git-ignored) or the provider's console.

## OpenAI

**Status (2026-11-15):** the API key is recognised and the fallback is verified live (a call returned `429 You have no credits remaining` and LifePilot used the rule engine as designed). A successful live extraction has **not** been validated yet: the account needs credits.

1. Check credits and usage at <https://platform.openai.com/settings/organization/billing/> and <https://platform.openai.com/usage>. The organisation must have a positive credit balance (or a payment method on a paid plan).
2. `.env` needs `OPENAI_API_KEY` (and optionally `OPENAI_MODEL`, default `gpt-4.1-mini`). `AI_PROVIDER` does not need to change for the smoke test.
3. Run the smoke test:

   ```bash
   pnpm smoke:openai
   ```

   It sends **exactly one** request (SDK retries are disabled, so a 429 or 5xx can't turn into several calls) with this synthetic email:

   > **Subject:** Assignment submission deadline
   > **Body:** Please submit your Chemical Engineering assignment by November 20, 2026 at 5 PM IST.

   Cost: one short request of a few hundred tokens on the configured model.
4. It passes only if every check passes: one request, answered by OpenAI (no fallback), a deadline-related category, a required action, an explicit deadline of **20 Nov 2026, 17:00 Asia/Kolkata** (`2026-11-20T11:30:00Z`) quoted from the email, no invented extra deadline, and not flagged as suspicious.
5. To use OpenAI in the app, set `AI_PROVIDER=openai` and restart the API and worker. Every newly synced email is then one request; inbox items show "Analysed by openai:<model>". Users can still turn AI analysis off per account.

Failure handling (timeouts, 429, authentication errors, invalid or partial JSON, invented deadlines, AI turned off) is covered by automated tests with a fake client: `packages/core/test/extractor.test.ts` and `apps/api/test/stability.test.ts`.

## Google (Gmail and Calendar)

**Status (2026-11-15):** not validated against real Google. OAuth client credentials are not configured yet.

### Accounts: keep three roles separate

| Role | Used for |
|---|---|
| Google Cloud administrator | Owns project `lifepilot-ai-514000`, configures the consent screen and OAuth client |
| Dedicated LifePilot **test** Gmail account | The only account authorised in LifePilot; holds test emails and calendar events |
| LifePilot support email | Shown on the consent screen and used as the web-push contact; never connected for syncing |

Do not authorise a personal inbox.

### Console setup (project `lifepilot-ai-514000`)

1. Sign in as the Cloud administrator and complete any MFA prompt.
2. **APIs & Services → Library**: confirm **Gmail API** and **Google Calendar API** are enabled.
3. **Google Auth Platform → Branding**: app name "LifePilot AI", support email = the LifePilot support address, developer contact email.
4. **Audience**: user type **External**, publishing status **Testing**. Under **Test users**, add the dedicated test Gmail account (up to 100 test users).
5. **Data access**: add exactly these scopes, nothing else:
   - `https://www.googleapis.com/auth/gmail.readonly` (restricted)
   - `https://www.googleapis.com/auth/calendar.readonly` (sensitive)
6. **Clients → Create client**: type **Web application**. Authorised redirect URI, exactly:

   ```
   http://localhost:4000/api/v1/integrations/google/callback
   ```

   No authorised JavaScript origins are needed: the browser never talks to Google directly.
7. Copy the client ID and secret straight into `.env` (don't paste them anywhere else):

   ```env
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_REDIRECT_URI=http://localhost:4000/api/v1/integrations/google/callback
   ```

   Then restart `pnpm dev`. `GET /api/v1/config` should report `googleConfigured: true`.

### What Testing mode means

- Google shows a **"Google hasn't verified this app"** screen. As a listed test user, choose **Continue**.
- **Refresh tokens expire after 7 days** for External apps in Testing status that request Gmail or Calendar scopes. LifePilot then gets `invalid_grant`, marks the connection **revoked**, stops syncing and asks to reconnect. This is expected in Testing mode, not a bug. Production needs verification (and, for `gmail.readonly`, a security assessment); see `docs/security.md`.
- Only listed test users can authorise the app.

### Connect and check

Open the app at **`http://localhost:5173`**, not `127.0.0.1`: the OAuth callback on `localhost:4000` needs the same host to receive the session cookie.

1. Sign in to LifePilot, go to **Settings → Connections → Connect Gmail**, choose the test account, approve. You should return to Settings with "Gmail connected".
2. Repeat with **Connect Google Calendar**.
3. Check:
   - The connection shows the **test account's address**.
   - **Inbox** shows recent emails (last 14 days, promotions and social excluded) with categories and deadlines.
   - Emails you **sent** and **drafts** never appear (send yourself a reply to check).
   - **Calendar** shows timed events, all-day events on the right day, and recurring events as separate instances, all marked read-only.
   - **Sync now** twice in a row adds nothing new (no duplicates). Sending a new email to the test account and syncing adds exactly one.
   - **Settings → Connections** lists sync jobs with their status; a failed job shows its error.
   - **Disconnect** stops syncing; **Disconnect and delete** removes imported emails and events.
   - Removing LifePilot at <https://myaccount.google.com/permissions> (signed in as the test account) marks the connection "revoked" on the next sync.

History expiry, rejected tokens, rate limits, pagination and truncated fetches are covered by automated tests with fake Google endpoints (`apps/api/test/google-sync.test.ts`); they are hard to trigger on demand with a real account.

## Web push

**Status (2026-11-15):** validated in **desktop Chrome 157 on macOS 26.0** against the real push service. VAPID keys are configured locally. `VAPID_SUBJECT` is still the placeholder `mailto:admin@example.com`; set it to the LifePilot support address.

### Results so far

| Check | Chrome 157 (macOS 26) | How |
|---|---|---|
| Permission reported correctly | Passed | Automated, real Chrome |
| Enable push, service worker registers | Passed | Automated, real Chrome |
| Browser subscription created (Google FCM) | Passed | Automated, real Chrome |
| Subscription stored by the backend | Passed | Automated, real Chrome |
| Push accepted by the push service | Passed | Automated, real Chrome |
| Delivered with the app tab **closed** (browser running), shown by the service worker, links to `/notifications` | Passed | Automated, real Chrome |
| Disable push removes the subscription (browser and server) | Passed | Automated, real Chrome |
| Subscription dropped by the browser is removed after the push service reports it gone | Passed | Automated, real Chrome |
| Removed after 5 consecutive failures | Passed | Automated test with a fake push service (can't be triggered safely on demand) |
| In-app toast while the tab is open: Snooze 15 min, Dismiss, Mark done | Passed | Automated, real Chrome and live worker |
| System notification banner appears; clicking it opens LifePilot on Notifications | **To check by hand** | Needs a person watching the screen |
| Background tab (not closed) shows a browser notification | **To check by hand** | |
| Quiet hours defer delivery | Passed | Automated test |
| No duplicates on job retry; pending push resent after a worker crash | Passed | Automated tests |
| Reminders survive a worker restart | Passed | Automated test (worker persistence) |

Re-run the Chrome check any time (sends one real push through Google FCM):

```bash
LIVE_PUSH=1 E2E_BASE_URL=http://localhost:5173 \
PW_CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
pnpm --filter @lifepilot/web exec playwright test e2e/push-live.spec.ts
```

Add `HEADED=1` to watch it.

### Manual checks

1. Open `http://localhost:5173`, sign in, **Settings → Notifications → Browser push notifications**, allow the prompt.
2. macOS: make sure **System Settings → Notifications → [browser]** allows notifications, and Focus is off.
3. **Send a test reminder**, then:
   - keep the tab open: an in-app toast with the LifePilot sound;
   - switch to another tab: a system notification;
   - close the LifePilot tab (keep the browser running): a system notification; click it and LifePilot should open on **Notifications**.
4. Background and closed-tab notifications use the **browser's/system's** sound. The custom LifePilot sounds play only while LifePilot is open.

### Device and browser matrix

| Platform | Status | What's needed |
|---|---|---|
| Chrome desktop (macOS) | Automated live checks passed; banner and click to confirm by hand | — |
| Safari 26 (macOS 26) | Not tested | Try on `http://localhost:5173`. If Safari refuses push there, it needs HTTPS (see below). |
| Firefox desktop | Not tested | Firefox isn't installed on this Mac |
| iPhone / iPad (iOS/iPadOS 16.4+) | Not tested | HTTPS with a certificate the device trusts, and **Add to Home Screen** first; push only works when opened from the home-screen icon |

**HTTPS for phones.** Push needs a secure origin, and `localhost` is only secure on the same machine. Options, in order of preference:

1. A **private deployment** (for example the Railway setup in `docs/railway-demo-deployment.md`) with its own VAPID keys and `NODE_ENV=production`. Only deploy with your explicit decision.
2. A **local HTTPS certificate** (e.g. `mkcert`) for the Mac's LAN address, with the mkcert root certificate installed and trusted on the iPhone. API and web URLs, cookies and the OAuth redirect must then use that HTTPS address.

Don't expose the development stack through a public tunnel: it carries development secrets and demo accounts.
