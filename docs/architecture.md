# Architecture

```
 Browser (React SPA) ──/api/v1──▶ API (Express) ──▶ PostgreSQL (source of truth)
                                   │    ▲
                         enqueue   │    │ reads/writes
                                   ▼    │
                                 Redis (BullMQ) ──▶ Worker ──▶ Google APIs / Web Push / OpenAI
```

## Principles

- **Deterministic first.** Scheduling, scoring, conflict detection, quiet hours and deadline parsing are plain code in `packages/shared`. The AI provider only classifies and summarises; its output is schema-validated and cross-checked.
- **DB is the source of truth, the queue is a timer.** Every job re-reads the database and no-ops if the reminder was cancelled, rescheduled (version mismatch), or its task completed. The worker re-enqueues all scheduled reminders on startup, so a lost Redis doesn't lose reminders.
- **Idempotency everywhere.** These are unique keys, not application checks:
  - reminders: `idempotency_key` (`task:<id>:prep`, `task:<id>:due`)
  - queue jobs: `rem_<id>_v<version>`
  - notifications: `<reminder>:v<version>:<channel>`
  - emails: `(account, provider_message_id)`
  - events: `(account, calendar, provider_event_id)`
  - insights: one per email
  - tasks from sources: `(user, source_type, source_id)`
- **Suggestions, not actions.** Plans are proposals until accepted. Calendar alternatives never touch Google. Email-derived tasks need user approval. Ambiguous deadlines need a user-supplied date.
- **Honest status.** A web-push notification is `accepted` (by the push service), never "delivered". Demo connections are `provider=demo` and labelled everywhere.

## Packages

| Package | Responsibility |
|---|---|
| `shared` | Browser-safe pure logic + zod request schemas + DTO types |
| `db` | Drizzle schema, migrations, `createDb` |
| `jobs` | Queue names, job-id scheme, `JobScheduler` interface + BullMQ implementation |
| `core` | Server services. Takes a `CoreContext` (db, config, logger, jobs, extractor, mailer, push, fetch, clock) so tests can inject fakes |
| `api` | Routing, auth/session/CSRF, validation, serialisation |
| `worker` | `reminders` queue (delivery) and `sync` queue (Gmail/Calendar/demo) |
| `web` | SPA |

## Key flows

**Task with a due time** → `syncTaskReminders` computes the desired reminders (prep at due − lead, and due). Prep reminders that fall in quiet hours move earlier; others move to the end of quiet hours. It then upserts by idempotency key and enqueues/dequeues jobs. Completing a task cancels its reminders. Editing the deadline bumps the version and re-enqueues. Changing reminder-related preferences re-syncs every open task.

**Reminder fires** → `processReminderJob`: stale/cancelled/completed → skip. If now is in quiet hours (preferences may have changed) → defer. Otherwise insert notification rows per enabled channel (unique keys), send web push, record the outcome, and mark the reminder `fired`. Final failure after retries → a visible `delivery_failed` notification.

**Gmail sync** → First run: messages from the last N days, excluding promotions/social, read *and* unread. After that: `users.history` since the stored `historyId`, falling back to a full window on 404. Only new IDs are fetched. A truncated text excerpt (≤4,000 chars) is stored, then the anticipation engine (`core/services/insights.ts`) creates one insight per email.

**Calendar sync** → Windowed resync (now−1d … now+N days, `singleEvents=true` so recurring instances are expanded). It upserts, preserves user fields (`needsPrep`, `prepMin`), and deletes events that vanished from the window. `syncToken` isn't used because Google doesn't allow it together with a time window.

**Planner** → `generateDailyPlan` (pure):
1. Events are facts; all-day events don't block time.
2. Busy time = events plus a buffer after each.
3. Prep blocks are added where there's free time.
4. Free slots = working hours (from now, if today) minus busy time.
5. Tasks are scored by priority and deadline proximity, with dependencies ordered first, and placed greedily in chunks up to the focus-block length, with breaks.
6. Leftovers go to "needs time soon" or "can wait"; overload produces a warning.
7. Replanning diffs against the previous plan.

## Data model

See `packages/db/src/schema.ts`. All timestamps are `timestamptz` (UTC). Times of day in preferences are minutes after local midnight, interpreted in the user's IANA timezone with Luxon (DST-safe). Every user-owned table has `user_id` with `ON DELETE CASCADE`, and every query filters by the session's user.
