# LifePilot AI

**An AI-powered personal productivity assistant that brings tasks, email, calendar events, and reminders together into one realistic daily plan.**

<sub>🚧 **Status: Actively Under Development | Phase 2: Stability and Improvements**</sub>

LifePilot AI is an evolving personal productivity platform that I am actively building, testing, and improving.

The current implementation includes a web application, backend API, background workers, task management, intelligent daily planning, email processing, calendar management, and AI-powered information extraction.

**This is an ongoing project, not a completed or production-ready product.** Development is continuing, with a focus on resolving bugs, improving reliability, validating external integrations, refining the user experience, and expanding AI capabilities.

Features and integrations will continue to evolve as development progresses. Some components are implemented but still require additional real-world testing and validation.

---

## What LifePilot AI Does

LifePilot AI is designed to reduce the effort involved in managing everyday responsibilities.

The goal is to bring scattered information from tasks, emails, calendars, and reminders into a single productivity system that helps users understand what needs attention and plan their day realistically.

Key capabilities include:

- Intelligent daily planning with prioritized tasks, deadline-aware scheduling, and warnings when a plan goes out of date.
- Email categorization and deadline extraction, including deadline changes and emails with several dates.
- Calendar management and scheduling conflict detection.
- Persistent reminders with customizable quiet hours, in-app alerts, and browser push notifications.
- Task management with subtasks and recurring schedules.
- Projects with progress tracking and upcoming deadlines.
- AI-assisted information extraction.
- Secure account management and data controls.

## Current Implementation Status

Statuses are kept separate on purpose: **Implemented** means the feature exists; **Tested** means automated tests cover it; **Tested with mocks** means tests run against fake versions of an external service; **Validated** means it was checked against the real service.

| Area | Implementation | Automated tests | Real-service validation |
|---|---|---|---|
| Email/password authentication, verification, password reset, sliding sessions | Implemented | Tested | Not applicable |
| Onboarding (timezone, working/sleep/quiet hours, reminder preferences) | Implemented | Tested (end-to-end) | Not applicable |
| Tasks: CRUD, subtasks, recurrence, tags, search, filters, sorting, postponement | Implemented | Tested | Not applicable |
| Projects: page with progress and deadlines, create/edit/delete, assign, filter | Implemented | Tested (API and end-to-end) | Not applicable |
| Daily planner: top three, deadline-aware scheduling, sleep hours, prep blocks, breaks, overload warnings, replanning, out-of-date plan detection | Implemented | Tested | Not applicable |
| Calendar: day/week/month views, local events, conflicts, alternative times | Implemented | Tested | Not applicable |
| Smart inbox: categories, importance, deadline extraction (changes, multiple dates, time zones, promotions) | Implemented | Tested | Not applicable |
| Prompt-injection handling and deadline verification | Implemented | Tested | Not applicable |
| Persistent reminders (BullMQ + PostgreSQL), quiet hours, snooze | Implemented | Tested | Not applicable |
| In-app notifications and the three LifePilot sounds | Implemented | Delivery tested; sounds checked by hand | Not applicable |
| Web push (VAPID) | Implemented | Tested with mocks (fake push service) | **Partial:** validated live in desktop Chrome 157 on 2026-11-15 (subscription, delivery with the tab closed, cleanup); Safari, Firefox and iPhone pending ([guide](docs/validation.md#web-push)) |
| Gmail and Google Calendar (OAuth, PKCE, sync) | Implemented | Tested with mocks (fake Google endpoints) | **Pending:** needs an OAuth client and a dedicated test account ([guide](docs/validation.md#google-gmail-and-calendar)) |
| OpenAI extraction with deterministic fallback | Implemented | Tested with mocks | **Partial:** key and fallback verified live on 2026-11-15; success path needs account credits ([guide](docs/validation.md#openai)) |
| Demo mode with synthetic data and rule-based AI | Implemented | Tested | Not applicable |
| Data export, account deletion, imported-data removal | Implemented | Tested | Not applicable |

**Note:** Implemented functionality does not necessarily mean production validation is complete. The status of external integrations is documented separately where applicable.

---

## OpenAI Integration Architecture

LifePilot AI includes an OpenAI integration in its backend AI extraction layer.

The application uses the official OpenAI Node.js SDK and Responses API.

**Implementation:** `packages/core/src/ai/extractor.ts`

### Request and processing flow

1. Email content, sender information, subject, and user timezone are prepared for extraction.
2. The OpenAI client sends a request using `responses.create()`.
3. The request uses the configured model and strict JSON Schema structured output.
4. Returned JSON is validated using Zod.
5. Extracted deadlines are checked against the original email using application-side verification.
6. Prompt-injection detection and untrusted-input handling protect the extraction workflow.
7. Timeouts and provider errors trigger a deterministic rule-based fallback.

### Implementation files

| File | Responsibility |
|---|---|
| `packages/core/src/ai/extractor.ts` | OpenAI SDK integration, request construction, structured output, validation, and fallback |
| `packages/core/src/config.ts` | Application and AI configuration |
| `packages/core/src/bootstrap.ts` | Core service initialization |
| `packages/core/scripts/smoke-openai.ts` | Live API smoke-test script |

The OpenAI client is configured with the API key, selected model, and SDK retry settings. The extraction request also uses an application-level timeout and disables response storage with `store: false`.

### Testing and verification

Mock-based tests are used to validate extraction behavior without requiring successful external API requests.

A separate smoke test (`pnpm smoke:openai`) sends **exactly one** real request (SDK retries disabled) with a synthetic email and passes only if the extracted deadline, action and category are correct. Mock-based tests cover timeouts, HTTP 429, authentication errors, invalid or partial JSON, invented deadlines, multiple dates, and AI-disabled mode.

**Current verification status:**

- Official OpenAI SDK integration: implemented.
- Responses API request construction: implemented.
- Structured JSON output and Zod validation: implemented.
- Deadline verification and deterministic fallback: implemented.
- Mock-based tests: available.
- Successful live API response: not yet verified.

The live API test was attempted but returned HTTP 429 because the API account had no remaining credits. Live API validation remains pending.

---

## Google API Integration Architecture

LifePilot AI integrates with Gmail and Google Calendar through Google's REST APIs.

The implementation uses native HTTP requests through an injectable `fetch` function rather than the Google Node.js client SDK.

### Integration files

| File | Responsibility |
|---|---|
| `packages/core/src/google/client.ts` | OAuth, PKCE, token exchange, refresh, revocation, and shared API requests |
| `packages/core/src/google/gmail.ts` | Gmail REST API requests and email parsing |
| `packages/core/src/google/calendar.ts` | Google Calendar REST API requests and event mapping |
| `packages/core/src/services/connections.ts` | OAuth state management, credential storage, and synchronization |
| `apps/api/src/routes/integrations.ts` | Integration API routes and OAuth callback |

### OAuth 2.0 and PKCE

The Google authorization flow includes:

- OAuth 2.0 authorization URL generation.
- Random state generation and SHA-256 hashing before database storage.
- State expiration after 10 minutes.
- Single-use OAuth state validation.
- Binding authorization state to the authenticated user.
- PKCE S256 challenge generation.
- Encrypted storage of the PKCE verifier.
- Server-side authorization-code exchange.
- Required OAuth scope validation.
- Access-token and refresh-token handling.
- Token revocation and account disconnection.

### Credential security

Google credentials and PKCE verifiers are encrypted before database storage.

The encryption implementation is in `packages/core/src/crypto.ts` and uses AES-256-GCM with a randomly generated initialization vector and authentication tag.

The encryption key is supplied through `TOKEN_ENCRYPTION_KEY` as a base64-encoded 32-byte key.

Additional security and reliability measures include:

- Refreshing access tokens when they approach expiration.
- Persisting refreshed tokens in encrypted form.
- Detecting revoked or rejected authorization.
- Clearing credentials when an account is marked revoked.
- Attempting Google token revocation during disconnection.
- Keeping provider credentials on the server.

### Gmail integration

The Gmail integration is read-only and implements:

- Retrieving Gmail profile information.
- Listing recent email messages.
- Filtering promotions, social messages, and chats.
- Excluding the user's own sent mail and drafts.
- Handling paginated results.
- Retrieving full message details.
- Incremental synchronization using the Gmail History API.
- Handling expired history identifiers.
- Parsing sender, subject, date, labels, and message content.
- Supporting plain-text and HTML email content.
- Converting HTML messages into readable text.
- Limiting stored body excerpts to 4,000 characters.
- Refreshing an access token once when Google rejects it, and marking the connection revoked if that fails.
- Retrying rate-limited and temporary Google errors with backoff.

Email information is processed through the application's smart inbox and AI extraction workflow.

### Google Calendar integration

The Calendar integration is read-only and implements:

- Retrieving the primary calendar.
- Fetching events within a specified date range.
- Handling paginated responses.
- Expanding recurring events into individual instances.
- Ordering events by start time.
- Mapping timed events into JavaScript dates.
- Handling all-day events using the calendar timezone and Luxon.
- Preserving event titles, descriptions, locations, statuses, and links.
- Removing events deleted or cancelled in Google, but never deleting events when a fetch was cut short by the page limit.

Calendar information is used by the application's scheduling and conflict-detection functionality.

### Google integration testing

Automated integration tests use mocked Google endpoints.

The tests cover OAuth parameters, PKCE, OAuth state validation, authorization-code exchange, encrypted token storage, token refresh and revocation, sent-mail and draft exclusion, history-ID expiry, rate-limit retries, calendar pagination, recurring and all-day events, duplicate prevention, and recovery of interrupted sync jobs.

**Current verification status:**

- Google OAuth and PKCE implementation: implemented.
- OAuth state validation: implemented.
- Encrypted credential storage: implemented.
- Gmail REST API integration: implemented.
- Google Calendar REST API integration: implemented.
- Mock-based integration tests: available.
- Real Google account authorization and synchronization: validation pending.

Mocked endpoint tests do not establish successful synchronization with a real Google account. Setup steps for the Google Cloud project, the consent screen and a dedicated test account are in [docs/validation.md](docs/validation.md#google-gmail-and-calendar). While the app is in Google's **Testing** status, refresh tokens expire after 7 days, so the test account must reconnect weekly.

---

## Technology Stack

### Frontend
- React
- TypeScript
- Vite
- Tailwind CSS
- Playwright for end-to-end testing

### Backend
- Node.js
- Express.js
- TypeScript
- REST API architecture

### Database and Background Processing
- PostgreSQL
- Drizzle ORM
- BullMQ
- Redis

### AI and Integrations
- OpenAI API
- Gmail API
- Google Calendar API
- OAuth 2.0 with PKCE
- Structured AI outputs

### Infrastructure and Development
- Docker
- Docker Compose
- Nginx
- pnpm workspaces
- Vitest

---

## Architecture and Repository Structure

The project follows a modular monorepo structure with separate applications and reusable packages.

```text
lifepilot-ai/
│
├── apps/
│   ├── api/          # Express REST API
│   ├── worker/       # Background job processing
│   └── web/          # React + Vite frontend
│
├── packages/
│   ├── shared/       # Shared logic, validation and DTOs
│   ├── core/         # Server services, AI and integrations
│   ├── db/           # Drizzle schema and SQL migrations
│   └── jobs/         # Background job contracts
│
├── infrastructure/
│   ├── docker-compose.yml
│   ├── Dockerfile
│   ├── Dockerfile.railway-{api,web,worker}
│   ├── nginx.conf
│   └── nginx.railway.conf.template
│
├── scripts/
│   └── generate-sounds.mjs
│
├── docs/
│   ├── architecture
│   ├── setup
│   ├── api
│   ├── deployment
│   ├── railway-demo-deployment
│   ├── security
│   └── validation
│
├── .env.example
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
└── README.md
```

### Application Components

**Web Application**

Provides the user interface for authentication, onboarding, task management, calendar views, smart inbox, daily planning, reminders, and notifications.

**Backend API**

Handles authentication, application logic, task operations, scheduling, email processing, calendar integrations, and data management through REST endpoints.

**Background Worker**

Processes asynchronous jobs, including reminder delivery and Gmail/Google Calendar synchronization.

**Shared Packages**

Contain reusable business logic, validation schemas, types, database functionality, and queue contracts.

---

## Getting Started

The following instructions describe the local development setup.

### Prerequisites

Make sure you have the following installed:

- Node.js 22.9+
- pnpm 10+
- PostgreSQL 16
- Redis 7
- Docker (recommended for running PostgreSQL and Redis)

### 1. Clone the repository

```bash
git clone https://github.com/Praneeth63020/lifepilot-ai.git

cd lifepilot-ai
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Configure environment variables

Create your local environment file:

```bash
cp .env.example .env
```

Generate the required secrets:

```bash
openssl rand -base64 48
openssl rand -base64 32
```

Configure the generated values in `.env`:

- `SESSION_SECRET`
- `TOKEN_ENCRYPTION_KEY`

Also configure the required database, Redis, Google OAuth, and OpenAI settings according to `docs/setup.md`.

Never commit your actual `.env` file or expose API keys and credentials.

### 4. Start PostgreSQL and Redis

```bash
docker compose -f infrastructure/docker-compose.yml up -d postgres redis
```

### 5. Run database migrations

```bash
pnpm db:migrate
```

### 6. Seed demo data

```bash
pnpm db:seed
```

The development seed provides:

- Email: `demo@lifepilot.local`
- Password: `demo-password-123`

Use these credentials only in your local development environment.

### 7. Start the application

```bash
pnpm dev
```

The development services run on:

| Service | Address |
|---|---|
| Web application | http://localhost:5173 |
| Backend API | http://localhost:4000 |
| API base path | `/api/v1` |

Refer to `docs/setup.md` for detailed configuration and integration instructions.

---

## Available Development Commands

| Command | Description |
|---|---|
| `pnpm dev` | Starts API, worker, and web application with reload |
| `pnpm test` | Runs unit and integration tests |
| `pnpm test:e2e` | Runs Playwright end-to-end tests |
| `pnpm typecheck` | Checks TypeScript types |
| `pnpm build` | Builds all packages |
| `pnpm db:generate` | Generates database migrations |
| `pnpm db:migrate` | Applies database migrations |
| `pnpm db:seed` | Seeds development data |
| `pnpm sounds` | Regenerates notification sounds |
| `pnpm smoke:openai` | Sends one real OpenAI request to validate live extraction (needs API credits) |
| `LIVE_PUSH=1 pnpm --filter @lifepilot/web exec playwright test e2e/push-live.spec.ts` | Opt-in live web-push check in Chrome (needs VAPID keys; see [docs/validation.md](docs/validation.md#web-push)) |

**Testing requirements:** The integration tests require PostgreSQL and Redis. The test configuration uses the `lifepilot_test` database and Redis databases 1 and 2.

---

## Development Roadmap

LifePilot AI is being developed incrementally. The following roadmap represents planned improvements and features that I intend to work on as the project evolves.

### Phase 1: Core Platform

- [x] Initial monorepo architecture
- [x] React web application
- [x] Express backend API
- [x] PostgreSQL database integration
- [x] Authentication and session management
- [x] Task management
- [x] Intelligent daily planning engine
- [x] Calendar management
- [x] Smart email inbox
- [x] Background reminder processing
- [x] In-app notifications
- [x] Initial Gmail and Google Calendar OAuth implementation
- [x] AI-powered information extraction

### Phase 2: Stability and Improvements

`[x]` completed and verified · `[ ]` not completed · `[!]` blocked or needs external validation

- [!] Validate Google integrations with real accounts. *Sync reliability is hardened and tested against fake Google endpoints; real validation needs an OAuth client and a dedicated test account ([guide](docs/validation.md#google-gmail-and-calendar)).*
- [!] Validate OpenAI integration with the real API. *Key and fallback verified live; the success path needs account credits.*
- [!] Test web push notifications across devices and browsers. *Desktop Chrome validated live; Safari, Firefox and iPhone still need testing ([checklist](docs/validation.md#web-push)).*
- [x] Identify and resolve remaining bugs and edge cases.
- [x] Improve error handling and application reliability.
- [x] Improve performance and database efficiency. *(indexes measured: index scans instead of full table scans on hot lookups)*
- [x] Refine the frontend and responsive layouts.
- [x] Improve task recommendations and planning accuracy. *(deadline-aware ordering, sleep hours, out-of-date plan detection; real-usage tuning continues)*
- [x] Complete unfinished project management interfaces.

### Phase 3: Advanced AI Capabilities

- [ ] Develop an AI chat assistant.
- [ ] Introduce controlled agentic workflows and tool calling.
- [ ] Add per-action user approval for sensitive operations.
- [ ] Improve contextual understanding of tasks, emails, and schedules.
- [ ] Explore proactive task suggestions and intelligent automation.

### Phase 4: Extended Platform

- [ ] Develop a mobile application using React Native / Expo.
- [ ] Implement native push notifications.
- [ ] Improve cross-device synchronization.
- [ ] Expand personalization features.
- [ ] Explore additional productivity integrations.

**Roadmap note:** These are development goals, not claims that the features have already been implemented. Priorities may change based on testing results, technical challenges, and feedback.

---

## Current Limitations

The project is still evolving, and some capabilities are intentionally deferred.

- **Mobile application:** A React Native / Expo application has not been built yet. The existing backend, notification model, and notification sounds provide a foundation for future development.
- **AI chat assistant:** The autonomous AI chat assistant is not implemented yet. It is planned around controlled tool calling and per-action user approval.
- **Database ORM:** The initial specification referenced Prisma. The current project uses Drizzle ORM with PostgreSQL and SQL migrations because Prisma engine binaries could not be downloaded in the original build environment.
- **Google integrations:** Gmail and Google Calendar integration code has been tested against mocked endpoints, but real-account validation is still pending.
- **OpenAI integration:** AI extraction is tested with a mock client. The API key and fallback were verified live; a successful live extraction is pending account credits.
- **Gmail permissions:** Gmail uses a restricted scope. Production use requires attention to Google's OAuth verification and security assessment requirements.
- **Web push:** Validated live in desktop Chrome. Safari, Firefox and iPhone/iPad are not yet tested; iPhone testing needs HTTPS and a Home Screen install. Custom LifePilot sounds play only while the app is open; background notifications use the browser's or system's sound.
- **Google sign-in:** Google OAuth is implemented for service integrations, but Google sign-in as an authentication method is not implemented.
- **Docker:** Docker images and configuration are defined, but the images have not yet been verified through a complete build in the original development environment.
- **Rate limiting:** Current rate limiting uses in-memory stores. A shared Redis-backed implementation is needed for multiple API instances.

These limitations will be addressed progressively as development continues.

---

## Development and Issue Tracking

I am continuing to improve LifePilot AI through incremental implementation, testing, debugging, and architectural refinement.

Areas of ongoing work include:

- Identifying and fixing bugs.
- Testing existing functionality and edge cases.
- Validating third-party integrations.
- Improving application performance and reliability.
- Refining existing features based on testing.
- Implementing new capabilities as the platform evolves.

Bug reports, feature requests, and improvement ideas can be tracked through [GitHub Issues](https://github.com/Praneeth63020/lifepilot-ai/issues).

When reporting an issue, include the affected feature, expected behavior, actual behavior, and relevant error logs or reproduction steps. Never include secrets, API keys, or private user information.

---

## Project Philosophy

The goal of LifePilot AI is to build a practical productivity system that helps people manage their daily responsibilities more intelligently.

Rather than creating another basic task manager, I want to explore how AI, contextual information, background processing, and intelligent scheduling can work together to make everyday planning more useful.

I believe useful AI applications should be reliable, transparent, and designed around real user needs.

This project is an ongoing learning and engineering effort, and I plan to continue improving it through implementation, testing, and iteration.

---

## Repository

**GitHub:** https://github.com/Praneeth63020/lifepilot-ai

**Developer:** Praneeth Bothumanchi

**Current Stage:** Phase 2 – Stability and Improvements

**Project Status:** Actively Under Development

---

*LifePilot AI is a work in progress. Features, architecture, documentation, and implementation details may change as development continues.*