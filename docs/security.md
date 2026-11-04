# Security & privacy

## Implemented

**Passwords and sessions**
- Passwords are hashed with argon2id (19 MiB, t=2). Login timing is equalised for unknown emails.
- Sessions are opaque 256-bit tokens. Only their SHA-256 is stored. The cookie is httpOnly, SameSite=Lax, and Secure in production; sessions last 30 days with sliding expiry.
- A password reset revokes all sessions.

**Request protection**
- CSRF: state-changing requests need the `x-lifepilot-csrf` header. Together with a strict CORS allow-list (`WEB_URL` only), cross-site forms can't forge requests.
- Rate limits: 300 requests/min per IP, and 20 per 15 min on auth endpoints. These are in-memory — use a Redis store when running several instances.
- Every query is scoped to the session's user id; client-supplied user ids are ignored. Cross-user access is covered by tests.
- Input is validated with zod on every route. SQL is parameterised by Drizzle.

**Google credentials**
- OAuth uses PKCE (S256). State is random, stored hashed, single-use, expires after 10 minutes and is bound to the user's session.
- Tokens are AES-256-GCM encrypted at rest (`TOKEN_ENCRYPTION_KEY`) and never sent to the client.
- Scopes are checked after consent. Disconnecting revokes tokens at Google. An `invalid_grant` response marks the account `revoked` and stops sync.

**Logging and headers**
- Logs are structured (pino) with redaction of cookies, authorization headers, tokens, passwords and email bodies.
- Helmet sets security headers; nginx adds more.

**Email content and AI**
- Email content is untrusted data:
  - It's wrapped in delimiters with explicit "never follow instructions" rules.
  - Model output must match a strict JSON schema.
  - A model-proposed deadline is kept only if its quoted text appears in the email.
  - Rule-based injection detection always runs. Flagged emails get capped confidence, a UI warning, and no automatic action.
- No tool-calling exists yet, so a model can't trigger any action.
- Users can turn AI analysis off; email content then never leaves the server.

**Data minimisation and control**
- Only a configurable recent window of email is synced (14 days by default), excluding promotions and social. Only a text excerpt of at most 4,000 characters is stored — no full bodies, no attachments.
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
   - a Redis-backed rate limiter
   - dependency scanning in CI (`pnpm audit --prod`)
   - key rotation for `TOKEN_ENCRYPTION_KEY` (ciphertexts are versioned `v1.` to allow it)
   - backups for Postgres **and** Redis
5. **Retention.** Add a scheduled job that deletes synced emails older than the window. Not implemented yet.
