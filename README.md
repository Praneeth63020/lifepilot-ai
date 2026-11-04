# LifePilot AI

Personal life manager: tasks, calendar and email turned into one realistic daily plan, with reminders that respect your quiet hours.

**Status: phase 1 (web + API + worker).** The mobile app, AI chat assistant and native push are not built yet — see [Known limitations](#known-limitations).

## What works

| Area | Status |
|---|---|
| Email/password auth, verification, password reset, sessions | ✅ tested |
| Onboarding (timezone, working/sleep hours, quiet hours, reminder lead, sound) | ✅ |
| Tasks: CRUD, complete/reopen, subtasks, recurrence, tags, search/filter/sort, postpone | ✅ tested |
| Deterministic daily planner: top 3 + reasons, fits around events, prep blocks, breaks, overload warnings, accept/reject/edit, replan with diff | ✅ tested |
| Calendar: day/week/month, local events, conflict detection, alternative slots (suggestions only) | ✅ tested |
| Smart inbox: categories, importance score, deadline extraction (explicit / inferred / ambiguous), user correction, approve → task | ✅ tested |
| Prompt-injection handling (flagged, never obeyed; model deadlines verified against email text) | ✅ tested |
| Persistent reminders (BullMQ + Postgres), quiet hours, snooze, dismiss, complete, idempotent delivery | ✅ tested incl. worker restart |
| In-app notifications with 3 original sounds; web push (VAPID) | in-app ✅ · web push implemented, **not verified on a device** |
| Gmail + Google Calendar OAuth (PKCE, encrypted tokens, incremental Gmail sync, revocation) | ✅ tested against faked Google endpoints · **not verified against real Google** |
| OpenAI extraction with structured output + fallback | ✅ tested with a fake client · **not verified against the real API** |
| Demo mode (synthetic data, persistent label, mock AI) | ✅ |
| Data export, account deletion, disconnect + delete imported data | ✅ tested |

## Quick start

Requires Node 22+, pnpm 10, PostgreSQL 16, Redis 7 (or Docker for the last two).

```bash
pnpm install
cp .env.example .env
# Fill SESSION_SECRET (openssl rand -base64 48) and TOKEN_ENCRYPTION_KEY (openssl rand -base64 32)
docker compose -f infrastructure/docker-compose.yml up -d postgres redis
pnpm db:migrate
pnpm db:seed           # demo@lifepilot.local / demo-password-123
pnpm dev               # API :4000, worker, web :5173
```

Open http://localhost:5173. Details: [docs/setup.md](docs/setup.md).

## Repo layout

```
apps/
  api/        Express REST API (/api/v1) — HTTP layer only
  worker/     BullMQ consumers: reminder delivery, Gmail/Calendar sync
  web/        React + Vite + Tailwind client (+ Playwright e2e)
packages/
  shared/     Pure logic shared by all: planner, conflicts, extraction, reminders, time, zod schemas, DTO types
  core/       Server services: config, crypto, Google clients, AI providers, sync, delivery, demo data
  db/         Drizzle schema + SQL migrations
  jobs/       Queue contracts (names, job ids, scheduler facade)
infrastructure/  docker-compose, Dockerfile, nginx
scripts/         generate-sounds.mjs (synthesises the notification sounds)
docs/            architecture, setup, api, deployment, security
```

## Commands

| | |
|---|---|
| `pnpm dev` | API + worker + web with reload |
| `pnpm test` | unit + integration tests (needs Postgres + Redis; uses `lifepilot_test` DB and Redis db 1/2) |
| `pnpm test:e2e` | Playwright against a running `pnpm dev` stack |
| `pnpm typecheck` / `pnpm build` | all packages |
| `pnpm db:generate` | new migration from schema changes |
| `pnpm sounds` | regenerate notification sounds |

## Known limitations

- **No mobile app yet** (React Native/Expo). The backend, sounds (`apps/web/public/sounds/*.wav`) and notification model are ready for it.
- **No AI chat assistant yet.** Deliberately deferred: it needs tool-calling with per-action approval and should be built on the anticipation engine once that's been used with real data.
- **Prisma → Drizzle.** The spec asked for Prisma; its engine binaries couldn't be downloaded in the build environment, so the data layer uses Drizzle ORM with plain SQL migrations on the same PostgreSQL.
- **Real Google and OpenAI integrations are unverified** — code paths are tested against faked endpoints only. See [docs/setup.md](docs/setup.md#google-oauth).
- **Gmail uses a restricted scope.** Beyond 100 test users you need Google's OAuth verification plus a paid third-party security assessment. While the app is in "Testing", Google expires refresh tokens after 7 days. See [docs/security.md](docs/security.md).
- **Web push not verified on a device.** Custom sounds can't be attached to web push (browser limitation); they play in-app while a tab is open.
- Projects exist in the API but have no UI yet. Google sign-in (as a login method) isn't implemented.
- Docker images are defined but were not built in the development environment (no Docker daemon).
- Rate limiting uses in-memory stores — use a Redis store when running more than one API instance.
