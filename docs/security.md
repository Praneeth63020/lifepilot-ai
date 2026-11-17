# Security & privacy

## Implemented

**Passwords and sessions**
- Passwords are hashed with argon2id (19 MiB, t=2). Login timing is equalised for unknown emails.
- Sessions are opaque 256-bit tokens. Only their SHA-256 is stored. The cookie is httpOnly, SameSite=Lax, and Secure in production; sessions expire after 30 days of inactivity (the database row and the cookie are renewed together on activity) and never last more than 90 days after sign-in.
- A password reset revokes all sessions and every other outstanding reset link for that account.

**Email and account recovery**
- Verification and reset links carry 256 random bits (`crypto.randomBytes`). Only their SHA-256 is stored. Verification links last 48 hours, reset links 1 hour; both are single use. Using any reset link cancels every other outstanding one, signs the account out everywhere, and sends a "your password was changed" email.
- The reset page checks a link (`POST /auth/reset-password/check`) before showing the form. The check doesn't use the link up and says nothing about the account.
- Reset requests answer identically (`200 {ok: true}`) for existing and unknown emails. The email is sent after the response, so a slow SMTP server can't make real accounts answer measurably slower. Delivery failures never change the response either: sign-up still succeeds (reporting `verificationSent: false`), and only a signed-in user explicitly resending verification is told it failed.
- Links are built from `WEB_URL`, which must be https in production. SMTP must be encrypted in production: `smtps://`, or `smtp://` with STARTTLS required.
- SMTP credentials live only in `SMTP_URL` on the server. `/config` exposes just the public support address and reply time. `MAIL_FROM` is validated as a single-line mailbox, so it can't inject mail headers. Recipients are always the account's registered address; no endpoint sends email to an address supplied by a visitor.
- Logs record that an email was sent or failed (user id, purpose, SMTP error code and reply), never the message, its link, its token or the SMTP credentials. Tests check this (`apps/api/test/email.test.ts`).
- **Local development exception:** with `NODE_ENV=development` and no `SMTP_URL`, nothing is sent, so reset and verification responses include the link (`devMail`) and say whether the account exists. This applies only to requests made directly from the same machine with no `X-Forwarded-For`/`Forwarded` header, which turns it off through a tunnel or reverse proxy. Production refuses to start without `SMTP_URL`, so the exception can't apply there. Tests cover each condition (`apps/api/test/auth.test.ts`).
- The public support page has no contact form, so there is no unauthenticated endpoint that could be abused to send email.

**Request protection**
- CSRF: state-changing requests need the `x-lifepilot-csrf` header. Together with a strict CORS allow-list (`WEB_URL` only), cross-site forms can't forge requests.
- Rate limits are stored in Redis, so they hold across API instances:
  - 300 requests/min per client IP overall, and 20 per 15 min per IP across the sign-up, sign-in, verification and reset endpoints;
  - 10 **failed** sign-ins per 15 min per account, from any IP (successful sign-ins don't count);
  - 5 password-reset requests per hour per email address, whether or not the account exists, so the limit reveals nothing.
  Per-account keys use a SHA-256 of the email, so addresses aren't stored in Redis. Clients are identified by `req.ip`, which trusts `X-Forwarded-For` only for `TRUST_PROXY_HOPS` proxies, so the header can't be spoofed for a fresh budget. Limited requests get `429 rate_limited` with `RateLimit`/`RateLimit-Policy` and `Retry-After` headers.
  - **If Redis is unreachable**, each instance falls back to its own in-memory counters and logs a warning. This is a deliberate trade-off: limits keep working per instance rather than failing open (unlimited guessing) or failing closed (nobody can sign in).
- Every query is scoped to the session's user id; client-supplied user ids are ignored. A two-user test (`apps/api/test/security.test.ts`) checks that one user can't read, change, act on, export or delete another user's tasks, subtasks, projects, events, email insights, reminders, notifications, plans, push subscriptions or connections. This is automated testing, not a formal security audit.
- Input is validated with zod on every route. SQL is parameterised by Drizzle.

**Google credentials**
- OAuth uses PKCE (S256). State is random, stored hashed, single-use, expires after 10 minutes and is bound to the user's session.
- Tokens are AES-256-GCM encrypted at rest (`TOKEN_ENCRYPTION_KEY`) and never sent to the client.
- Scopes are checked after consent. Disconnecting revokes tokens at Google. An `invalid_grant` response marks the account `revoked` and stops sync.

**Logging and headers**
- Logs are structured (pino) with redaction of cookies, authorization headers, tokens, passwords and email bodies. Request URLs and query strings are scrubbed too: OAuth `code`/`state` and any `token` parameter are logged as `[redacted]`.
- Helmet sets security headers; nginx adds more.

**Email content and AI**
- Email content is untrusted data:
  - It's wrapped in delimiters with explicit "never follow instructions" rules.
  - Model output must match a strict JSON schema.
  - A model-proposed deadline is kept only if its quoted text appears in the email and parses to the same instant as one of the email's own deadline phrases; otherwise it needs the user's confirmation. A model can't reintroduce a promotional date the rules ignored.
  - Rule-based injection detection always runs. Flagged emails get capped confidence, a UI warning, and no automatic action.
- No tool-calling exists yet, so a model can't trigger any action.
- Users can turn AI analysis off; email content then never leaves the server.

**Data minimisation and control**
- Only a configurable recent window of email is synced (14 days by default), excluding promotions and social, and never the user's own Sent mail or Drafts. Only a text excerpt of at most 4,000 characters is stored — no full bodies, no attachments.
- Users can export their data, disconnect an integration (with or without deleting imported data), or delete their account (cascading delete plus token revocation).

**Audit and secrets**
- An audit log records sign-ins, failed logins, resets, connects, disconnects and exports.
- Secrets live only in environment variables. Config validation refuses placeholder secrets, missing SMTP and non-HTTPS URLs in production.

## Google scopes requested

| Scope | Why | Classification |
|---|---|---|
| `gmail.readonly` | Read recent messages to find deadlines, requests and invitations. `gmail.metadata` can't read bodies, which deadline extraction needs. | **Restricted** |
| `calendar.readonly` | Read events for availability and conflicts | Sensitive |

## Before a public launch

1. **Google OAuth verification.**
   - Restricted scopes (Gmail) require app verification **and** an annual third-party security assessment (CASA) before more than 100 users can connect.
   - Calendar (sensitive) requires verification.
   - While the app is in "Testing", refresh tokens expire after 7 days.
   - You need a privacy policy, a homepage, a demo video and justification for each scope.
   - Consider launching with Calendar only, and Gmail later.
2. **Privacy policy** meeting the Google API Services User Data Policy (Limited Use). The policy must say:
   - which email data is stored and for how long
   - that it isn't used for ads
   - whether it's sent to an AI provider (OpenAI) and under what terms
3. **Your jurisdiction's data-protection obligations.** For users in India, that's the DPDP Act 2023; for EU users, GDPR (lawful basis, DPA with processors, data residency).
4. **Operational hardening:**
   - dependency scanning in CI (`pnpm audit --prod`)
   - key rotation for `TOKEN_ENCRYPTION_KEY` (ciphertexts are versioned `v1.` to allow it)
   - backups for Postgres **and** Redis
5. **Retention.** Add a scheduled job that deletes synced emails older than the window. Not implemented yet.
