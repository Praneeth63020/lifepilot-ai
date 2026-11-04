# LifePilot AI

**An AI-powered personal productivity assistant that brings tasks, email, calendar events, and reminders together into one realistic daily plan.**

<sub>🚧 **Status: Actively Under Development | Phase 1**</sub>

LifePilot AI is an evolving personal productivity platform that I am actively building, testing, and improving.

The current implementation includes a web application, backend API, background workers, task management, intelligent daily planning, email processing, calendar management, and AI-powered information extraction.

**This is an ongoing project, not a completed or production-ready product.** Development is continuing, with a focus on resolving bugs, improving reliability, validating external integrations, refining the user experience, and expanding AI capabilities.

Features and integrations will continue to evolve as development progresses. Some components are implemented but still require additional real-world testing and validation.

---

## What LifePilot AI Does

LifePilot AI is designed to reduce the effort involved in managing everyday responsibilities.

The goal is to bring scattered information from tasks, emails, calendars, and reminders into a single productivity system that helps users understand what needs attention and plan their day realistically.

Key capabilities include:

- Intelligent daily planning with prioritized tasks.
- Email categorization and deadline extraction.
- Calendar management and scheduling conflict detection.
- Persistent reminders with customizable quiet hours.
- Task management with subtasks and recurring schedules.
- AI-assisted information extraction.
- Secure account management and data controls.

## Current Implementation Status

| Area | Current Status |
|---|---|
| Email/password authentication, verification, password reset, and sessions | Implemented and tested |
| Onboarding (timezone, working hours, sleep hours, quiet hours, reminder preferences) | Implemented |
| Task management: CRUD, completion, subtasks, recurrence, tags, search, filters, sorting, and postponement | Implemented and tested |
| Daily planning engine: prioritized top three tasks, scheduling, preparation blocks, breaks, overload warnings, and replanning | Implemented and tested |
| Calendar: day, week, month views, local events, conflict detection, and alternative time suggestions | Implemented |
| Smart inbox: email categories, importance scoring, and deadline extraction | Implemented and tested |
| Prompt-injection handling and email-based deadline verification | Implemented and tested |
| Persistent reminders using BullMQ and PostgreSQL | Implemented and tested |
| In-app notifications with three original notification sounds | Implemented |
| Web push notifications using VAPID | Implemented, device verification pending |
| Gmail and Google Calendar OAuth integrations | Tested against mocked Google endpoints; real-service validation pending |
| OpenAI structured information extraction with fallback | Tested with a mock client; real API validation pending |
| Demo mode with synthetic data and mock AI | Implemented |
| Data export, account deletion, and imported-data removal | Implemented and tested |

**Note:** Implemented functionality does not necessarily mean production validation is complete. The status of external integrations is documented separately where applicable.

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
│   └── nginx/
│
├── scripts/
│   └── generate-sounds.mjs
│
├── docs/
│   ├── architecture
│   ├── setup
│   ├── api
│   ├── deployment
│   └── security
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

- Node.js 22+
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

- [ ] Validate Google integrations with real accounts.
- [ ] Validate OpenAI integration with the real API.
- [ ] Test web push notifications across devices and browsers.
- [ ] Identify and resolve remaining bugs and edge cases.
- [ ] Improve error handling and application reliability.
- [ ] Improve performance and database efficiency.
- [ ] Refine the frontend and responsive layouts.
- [ ] Improve task recommendations and planning accuracy.
- [ ] Complete unfinished project management interfaces.

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
- **OpenAI integration:** AI extraction has been tested using a mock client. Real API validation remains pending.
- **Gmail permissions:** Gmail uses a restricted scope. Production use requires attention to Google's OAuth verification and security assessment requirements.
- **Web push:** Implemented but not yet verified on an actual device. Custom notification sounds currently play in-app while the browser tab is open.
- **Projects interface:** Project functionality exists in the API but does not yet have a complete frontend interface.
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

**Current Stage:** Phase 1 – Web Application, Backend API, and Background Worker

**Project Status:** Actively Under Development

---

*LifePilot AI is a work in progress. Features, architecture, documentation, and implementation details may change as development continues.*