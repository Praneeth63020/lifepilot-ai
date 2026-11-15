# Validating real integrations

LifePilot's Google, OpenAI and web-push code is covered by automated tests against mocked services. These steps check each one against the real service. They need your own accounts and keys, so they are run by hand.

Record the date and result of each run in the README's status table.

## OpenAI

**Status (2026-11-15):** the API key is valid and the failure path is verified. A live call returned `429 You have no credits remaining`, and LifePilot fell back to the built-in rule engine as designed. The success path needs credits.

1. Add credits at <https://platform.openai.com/settings/organization/billing/>.
2. Make sure `.env` has `OPENAI_API_KEY` (and optionally `OPENAI_MODEL`, default `gpt-4.1-mini`).
3. Run the smoke test. It sends one synthetic email (no personal data) and costs a fraction of a cent:

   ```bash
   pnpm smoke:openai
   ```

4. Expect `LIVE OPENAI TEST PASSED`, provider `openai:<model>`, and an extracted deadline of `2026-11-10T11:30:00.000Z` (5 PM IST).
5. To use it in the app, set `AI_PROVIDER=openai` and restart the API and worker. Inbox items then show "Analysed by openai:<model>".

## Google (Gmail and Calendar)

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and enable the **Gmail API** and **Google Calendar API**.
2. Configure the **OAuth consent screen**: user type *External*, publishing status *Testing*, and add your own Google account under **Test users**. `gmail.readonly` is a restricted scope; Testing mode avoids Google's verification review for your own account.
3. Create an **OAuth client ID** of type *Web application* with this authorized redirect URI (exact match):

   ```
   http://localhost:4000/api/v1/integrations/google/callback
   ```

4. Put the credentials in `.env`, then restart `pnpm dev`:

   ```env
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_REDIRECT_URI=http://localhost:4000/api/v1/integrations/google/callback
   ```

5. In the app: **Settings → Connections → Connect Gmail**, approve, and confirm you return to Settings with "Gmail connected". Repeat for Calendar.
6. Check:
   - **Inbox** shows recent emails (last 14 days, promotions and social excluded) with categories and deadlines.
   - **Calendar** shows your primary calendar's events, marked read-only.
   - **Sync now** adds a new email you send yourself within a minute (worker running).
   - **Disconnect** stops syncing; **Disconnect and delete** removes imported emails and events.
   - Revoking access at <https://myaccount.google.com/permissions> marks the connection "revoked" on the next sync.

## Web push

1. Generate VAPID keys and add them to `.env`, then restart:

   ```bash
   pnpm --filter @lifepilot/core exec web-push generate-vapid-keys
   ```

   ```env
   VAPID_PUBLIC_KEY=...
   VAPID_PRIVATE_KEY=...
   VAPID_SUBJECT=mailto:you@example.com
   ```

2. Push needs a secure origin: `http://localhost` works on the same machine. For a phone, use an HTTPS tunnel or a deployed instance.
3. In **Settings → Notifications**, enable browser notifications and allow the permission prompt.
4. Create a task due 3 minutes from now with reminder lead time 0, close the tab, and wait for the notification. Clicking it should open **Notifications**.
5. Test on each target:

   | Browser / device | Notes |
   |---|---|
   | Chrome (macOS, Windows, Android) | Standard Web Push |
   | Firefox (desktop, Android) | Standard Web Push |
   | Safari (macOS 13+) | Standard Web Push |
   | Safari (iOS/iPadOS 16.4+) | Only after **Add to Home Screen**; open from the home-screen icon |

6. Signing out should stop notifications in that browser (the subscription is removed).
