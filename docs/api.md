# API reference (`/api/v1`)

**Conventions**
- JSON in and out. Errors use the shape `{ "error": { "code", "message", "details?" } }`.
- Auth uses the `lp_session` httpOnly cookie.
- Every `POST/PATCH/DELETE` must send the header `x-lifepilot-csrf: 1`, or it gets 403 `csrf`.
- Validation failures return 400 `validation_error`, with `details[]` listing `{path, message}`.
- Missing resources, and resources owned by another user, both return 404.
- Times are ISO-8601 with an offset; responses are UTC.

## Public

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | `{status:"ok"}` |
| GET | `/health/ready` | `{status, db, redis}` — 503 if degraded |
| GET | `/config` | `{demoMode, googleConfigured, aiProvider, webPushPublicKey, mailConfigured, supportEmail, supportResponseTime}`. The last two are `null` unless configured |

## Auth (`/auth`)

These endpoints share a limit of 20 requests per 15 minutes per client IP. Additionally, an account allows 10 **failed** sign-ins per 15 minutes from any IP, and an email address 5 reset requests per hour. All API requests are limited to 300 per minute per IP. Limits are shared across API instances (Redis). A limited request gets `429` with `{"error":{"code":"rate_limited",…}}` plus `RateLimit`, `RateLimit-Policy` and `Retry-After` headers.

| Method | Path | Body | Result |
|---|---|---|---|
| POST | `/register` | `{email, password(≥10), name, timezone?}` | 201 `{user, preferences, verificationSent}` and sets the cookie; 409 `email_taken` (also for simultaneous sign-ups) |
| POST | `/login` | `{email, password}` | `{user, preferences}`; 401 `invalid_credentials` |
| POST | `/logout` | – | 204 |
| GET | `/me` | – | `{user, preferences}`; 401 |
| POST | `/verify-email` | `{token}` | single-use, 48 h |
| POST | `/resend-verification` | – | 502 `email_failed` if the email couldn't be sent. Local development without SMTP also returns `devMail.link` (see below) |
| POST | `/request-password-reset` | `{email}` | always 200 `{ok: true}`. Local development without SMTP also returns `devMail: {link}` (`null` when no account has that email) |

`devMail` is returned only when all of these hold: `NODE_ENV=development`, `SMTP_URL` is empty, the request comes straight from the same machine (loopback address), and it carries no `X-Forwarded-For` / `Forwarded` header (so it is off through a tunnel or proxy). Production refuses to start without `SMTP_URL`, so it never appears there.
| POST | `/reset-password/check` | `{token}` | `{valid}`: whether a reset link is unused and unexpired. Doesn't use it up |
| POST | `/reset-password` | `{token, password}` | single-use, 1 h; cancels every other reset link, signs out all sessions, then emails a "password changed" notice |
| GET | `/sessions` | – | active sessions |
| POST | `/sessions/revoke-others` | – | |

## Preferences

| Method | Path | Notes |
|---|---|---|
| GET | `/preferences` | |
| PATCH | `/preferences` | Partial. Fields: `timezone`, `locale`, `workStartMin`, `workEndMin`, `sleepStartMin`, `sleepEndMin`, `quietHoursEnabled`, `quietStartMin`, `quietEndMin`, `reminderLeadMin`, `maxRemindersPerTask`, `notificationSound` (`daily_chime \| priority_alert \| deadline_alert \| none`), `escalateSounds`, `inAppEnabled`, `webPushEnabled`, `dailyPlanningMin`, `focusBlockMin`, `breakMin`, `bufferMin`, `aiEnabled`, `theme`, `onboardingCompleted`, `importantSenders[]`. Reminder-related changes re-sync all reminders. |

## Tasks

| Method | Path | Notes |
|---|---|---|
| GET | `/tasks` | Query: `status=open\|done\|all`, `q`, `priority`, `projectId`, `tag`, `dueBefore`, `sort=due\|priority\|created`, `limit`, `offset`. Returns `{items, total}` |
| POST | `/tasks` | `{title, description?, priority?, dueAt?, estimateMin?, category?, tags?, projectId?, recurrence?, dependsOnTaskId?, subtasks?[]}`. Creates reminders. |
| GET/PATCH/DELETE | `/tasks/:id` | PATCH also accepts `snoozedUntil` |
| POST | `/tasks/:id/complete` | `{task, next, cancelledReminders}`; `next` is the next occurrence of a recurring task |
| POST | `/tasks/:id/reopen` | |
| POST | `/tasks/:id/subtasks` | `{title}` |
| PATCH/DELETE | `/subtasks/:id` | `{title?, done?}` |
| GET/POST | `/projects` | Each project includes `openTasks`, `doneTasks`, `overdueTasks`, `nextDue {taskId,title,dueAt}` and `lastDueAt`. Colour is a hex value like `#4f46e5`. Names are unique per user (case-insensitive): 409 `project_exists`. |
| GET/PATCH/DELETE | `/projects/:id` | Read, rename or recolour; deleting keeps the tasks and clears their project. |

## Calendar (`/calendar`)

| Method | Path | Notes |
|---|---|---|
| GET | `/events?from&to` | Range of at most 62 days |
| POST | `/events` | Local event: `{title, startAt, endAt, allDay?, location?, description?, needsPrep?, prepMin?}` |
| GET/PATCH/DELETE | `/events/:id` | Imported events: only `needsPrep`/`prepMin` are editable (otherwise 403 `read_only_event`); they can't be deleted |
| GET | `/conflicts?from&to` | Overlapping timed events |
| GET | `/events/:id/alternatives` | Up to 3 suggested slots. Nothing is moved. |

## Smart inbox (`/insights`)

| Method | Path | Notes |
|---|---|---|
| GET | `/insights?status=open\|new\|reviewed\|dismissed\|task_created\|all&category=` | Sorted by importance |
| GET | `/insights/:id` | |
| PATCH | `/insights/:id` | `{status?, userCategory?}` — corrects the AI. Never modifies the email. |
| POST | `/insights/:id/task` | `{title?, dueAt?, estimateMin?, priority?}`. Omitting `dueAt` uses the extracted deadline. An ambiguous deadline returns 422 `clarification_required`; pass `dueAt: null` to create the task without one. Idempotent. |

## Integrations (`/integrations`)

| Method | Path | Notes |
|---|---|---|
| GET | `/integrations` | Status per product |
| GET | `/integrations/sync-jobs` | Last 20 sync jobs |
| POST | `/integrations/:product/connect` | `gmail\|calendar` → `{url}` (Google consent URL; state + PKCE). 503 if not configured. |
| GET | `/integrations/google/callback` | OAuth redirect target; redirects to `WEB_URL/settings/connections?connected=…` or `?error=…` |
| POST | `/integrations/demo` | Loads synthetic data (demo mode only) |
| POST | `/integrations/:product/sync` | 202 queued; 409 if not connected |
| DELETE | `/integrations/:product[?deleteData=true]` | Revokes tokens at Google and stops sync. With `deleteData`, also deletes imported emails, insights and events. |

## Planning & dashboard

| Method | Path | Notes |
|---|---|---|
| GET | `/plans/current?date=YYYY-MM-DD` | Accepted plan, else the latest proposal, else `null`. `drift[]` lists what no longer fits (new overlapping meetings, tasks due today not in the plan); the plan itself is never changed. |
| POST | `/plans/generate` | `{date?}`. Returns a new proposal; earlier proposals are superseded. |
| POST | `/plans/replan` | Today, from the current time. Includes `changes[]`. |
| POST | `/plans/:id/accept`, `/plans/:id/reject` | |
| PATCH | `/plans/:id/items` | `{items:[{id,startAt,endAt}]}`. Suggested blocks only; can't overlap events. |
| GET | `/dashboard` | Everything for the home screen. `recommendations[]` are `{kind, text}` with kind `overdue`, `conflict`, `unclear_deadline`, `suspicious_email`, `no_estimate`, `not_planned` or `plan_outdated`. |
| GET | `/dashboard/week` | 7-day summary |

## Reminders & notifications

| Method | Path | Notes |
|---|---|---|
| GET | `/reminders?status=scheduled\|fired\|cancelled\|all` | |
| POST | `/reminders` | `{taskId?, eventId?, remindAt, note?}`. Adjusted for quiet hours. |
| POST | `/reminders/:id/snooze` | `{minutes}`; at most 5 snoozes (409 `snooze_limit`) |
| DELETE | `/reminders/:id` | Cancel |
| GET | `/notifications?unseen=true&limit=` | History |
| POST | `/notifications/:id/seen\|dismiss\|complete` | |
| POST | `/notifications/:id/snooze` | `{minutes}` |
| POST | `/notifications/seen-all` | |
| POST/DELETE | `/push/subscriptions` | Web-push subscription `{endpoint, keys:{p256dh, auth}}` / `{endpoint}` |
| GET | `/push/subscriptions` | `{count, configured}` |

## Account

| Method | Path | Notes |
|---|---|---|
| GET | `/account/export` | JSON of all user data; secrets are excluded |
| DELETE | `/account` | `{password}` — revokes Google access, cancels jobs and deletes everything |
