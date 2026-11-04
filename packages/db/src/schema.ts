import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** All timestamps are stored as timestamptz (UTC); rendered in the user's timezone by clients. */
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () =>
  ts("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const id = () => uuid("id").primaryKey().defaultRandom();

// ── Enums ──
export const priorityEnum = pgEnum("priority", ["low", "medium", "high", "urgent"]);
export const taskStatusEnum = pgEnum("task_status", ["open", "done"]);
export const sourceTypeEnum = pgEnum("source_type", ["manual", "email", "calendar", "chat"]);
export const recurrenceEnum = pgEnum("recurrence", ["none", "daily", "weekly", "monthly"]);
export const providerEnum = pgEnum("provider", ["google", "demo"]);
export const productEnum = pgEnum("product", ["gmail", "calendar"]);
export const connectionStatusEnum = pgEnum("connection_status", [
  "active",
  "error",
  "revoked",
  "disconnected",
]);
export const emailCategoryEnum = pgEnum("email_category", [
  "urgent",
  "requires_action",
  "deadline",
  "meeting",
  "work_education",
  "financial",
  "travel",
  "informational",
  "low_priority",
]);
export const deadlineCertaintyEnum = pgEnum("deadline_certainty", [
  "explicit",
  "inferred",
  "ambiguous",
  "none",
]);
export const insightStatusEnum = pgEnum("insight_status", [
  "new",
  "reviewed",
  "dismissed",
  "task_created",
]);
export const eventSourceEnum = pgEnum("event_source", ["google", "local", "demo"]);
export const reminderKindEnum = pgEnum("reminder_kind", ["prep", "due", "event", "custom"]);
export const reminderStatusEnum = pgEnum("reminder_status", ["scheduled", "fired", "cancelled"]);
export const notificationChannelEnum = pgEnum("notification_channel", ["in_app", "web_push"]);
/**
 * Delivery status is deliberately honest:
 *  - available: stored and visible in-app (not yet seen)
 *  - accepted:  a push service accepted the message (NOT proof it reached the device)
 *  - suppressed: not sent (duplicate / quiet hours collapse / limit reached)
 */
export const notificationStatusEnum = pgEnum("notification_status", [
  "pending",
  "available",
  "accepted",
  "failed",
  "suppressed",
  "seen",
  "dismissed",
]);
export const soundEnum = pgEnum("notification_sound", [
  "daily_chime",
  "priority_alert",
  "deadline_alert",
  "none",
]);
export const planStatusEnum = pgEnum("plan_status", ["proposed", "accepted", "rejected", "superseded"]);
export const planItemKindEnum = pgEnum("plan_item_kind", ["task", "event", "prep", "break"]);
export const authTokenKindEnum = pgEnum("auth_token_kind", ["verify_email", "reset_password"]);
export const syncStatusEnum = pgEnum("sync_status", ["queued", "running", "succeeded", "failed", "skipped"]);
export const themeEnum = pgEnum("theme", ["system", "light", "dark"]);

// ── Identity ──
export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  emailVerifiedAt: ts("email_verified_at"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Times of day are stored as minutes after local midnight in the user's timezone. */
export const userPreferences = pgTable("user_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  timezone: text("timezone").notNull().default("UTC"),
  locale: text("locale").notNull().default("en-US"),
  workStartMin: integer("work_start_min").notNull().default(9 * 60),
  workEndMin: integer("work_end_min").notNull().default(18 * 60),
  sleepStartMin: integer("sleep_start_min").notNull().default(23 * 60),
  sleepEndMin: integer("sleep_end_min").notNull().default(7 * 60),
  quietHoursEnabled: boolean("quiet_hours_enabled").notNull().default(true),
  quietStartMin: integer("quiet_start_min").notNull().default(22 * 60),
  quietEndMin: integer("quiet_end_min").notNull().default(7 * 60),
  reminderLeadMin: integer("reminder_lead_min").notNull().default(60),
  maxRemindersPerTask: integer("max_reminders_per_task").notNull().default(3),
  notificationSound: soundEnum("notification_sound").notNull().default("daily_chime"),
  escalateSounds: boolean("escalate_sounds").notNull().default(true),
  inAppEnabled: boolean("in_app_enabled").notNull().default(true),
  webPushEnabled: boolean("web_push_enabled").notNull().default(false),
  dailyPlanningMin: integer("daily_planning_min").notNull().default(8 * 60 + 30),
  focusBlockMin: integer("focus_block_min").notNull().default(90),
  breakMin: integer("break_min").notNull().default(10),
  bufferMin: integer("buffer_min").notNull().default(10),
  aiEnabled: boolean("ai_enabled").notNull().default(true),
  /** Sender addresses or domains the user marks important (boosts email importance). */
  importantSenders: text("important_senders").array().notNull().default(sql`'{}'::text[]`),
  theme: themeEnum("theme").notNull().default("system"),
  onboardingCompletedAt: ts("onboarding_completed_at"),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 of the opaque cookie token; the raw token never touches the DB. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userAgent: text("user_agent"),
    ip: text("ip"),
    createdAt: createdAt(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const authTokens = pgTable("auth_tokens", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: authTokenKindEnum("kind").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: createdAt(),
});

// ── Integrations ──
/** Short-lived, single-use OAuth state with PKCE verifier (encrypted). */
export const oauthStates = pgTable("oauth_states", {
  stateHash: text("state_hash").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  product: productEnum("product").notNull(),
  codeVerifierEnc: text("code_verifier_enc").notNull(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: createdAt(),
});

/** One row per (user, provider, product). Tokens are AES-256-GCM encrypted at rest. */
export const connectedAccounts = pgTable(
  "connected_accounts",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: providerEnum("provider").notNull(),
    product: productEnum("product").notNull(),
    externalEmail: text("external_email"),
    scopes: text("scopes").notNull().default(""),
    accessTokenEnc: text("access_token_enc"),
    refreshTokenEnc: text("refresh_token_enc"),
    tokenExpiresAt: ts("token_expires_at"),
    status: connectionStatusEnum("status").notNull().default("active"),
    syncCursor: text("sync_cursor"),
    lastSyncAt: ts("last_sync_at"),
    lastSyncError: text("last_sync_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("connected_accounts_unique").on(t.userId, t.provider, t.product)],
);

export const syncJobs = pgTable(
  "sync_jobs",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").references(() => connectedAccounts.id, { onDelete: "cascade" }),
    product: productEnum("product").notNull(),
    status: syncStatusEnum("status").notNull().default("queued"),
    itemsProcessed: integer("items_processed").notNull().default(0),
    error: text("error"),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    createdAt: createdAt(),
  },
  (t) => [index("sync_jobs_user_idx").on(t.userId, t.createdAt)],
);

export const syncedEmails = pgTable(
  "synced_emails",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => connectedAccounts.id, { onDelete: "cascade" }),
    providerMessageId: text("provider_message_id").notNull(),
    threadId: text("thread_id"),
    subject: text("subject").notNull().default(""),
    fromAddress: text("from_address").notNull().default(""),
    fromName: text("from_name"),
    receivedAt: ts("received_at").notNull(),
    snippet: text("snippet").notNull().default(""),
    /** Truncated plain-text excerpt (max 4,000 chars) used only for extraction. Full bodies are not stored. */
    bodyExcerpt: text("body_excerpt").notNull().default(""),
    labels: text("labels").array().notNull().default(sql`'{}'::text[]`),
    webLink: text("web_link"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("synced_emails_unique").on(t.accountId, t.providerMessageId),
    index("synced_emails_user_received_idx").on(t.userId, t.receivedAt),
  ],
);

export const emailInsights = pgTable(
  "email_insights",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    emailId: uuid("email_id")
      .notNull()
      .unique()
      .references(() => syncedEmails.id, { onDelete: "cascade" }),
    category: emailCategoryEnum("category").notNull(),
    userCategory: emailCategoryEnum("user_category"),
    importanceScore: integer("importance_score").notNull(),
    summary: text("summary").notNull(),
    whyItMatters: text("why_it_matters").notNull(),
    requiredAction: text("required_action"),
    deadlineAt: ts("deadline_at"),
    deadlineText: text("deadline_text"),
    deadlineCertainty: deadlineCertaintyEnum("deadline_certainty").notNull().default("none"),
    clarificationQuestion: text("clarification_question"),
    confidence: real("confidence").notNull(),
    /** Email contained text that tries to instruct an AI. Never auto-acted on. */
    suspicious: boolean("suspicious").notNull().default(false),
    proposedTaskTitle: text("proposed_task_title"),
    proposedEstimateMin: integer("proposed_estimate_min"),
    extractor: text("extractor").notNull(),
    status: insightStatusEnum("status").notNull().default("new"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("email_insights_user_idx").on(t.userId, t.status)],
);

// ── Work ──
export const projects = pgTable("projects", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color"),
  archivedAt: ts("archived_at"),
  createdAt: createdAt(),
});

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description"),
    status: taskStatusEnum("status").notNull().default("open"),
    priority: priorityEnum("priority").notNull().default("medium"),
    dueAt: ts("due_at"),
    estimateMin: integer("estimate_min"),
    category: text("category"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    sourceType: sourceTypeEnum("source_type").notNull().default("manual"),
    sourceId: text("source_id"),
    recurrence: recurrenceEnum("recurrence").notNull().default("none"),
    dependsOnTaskId: uuid("depends_on_task_id"),
    snoozedUntil: ts("snoozed_until"),
    completedAt: ts("completed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("tasks_user_status_idx").on(t.userId, t.status, t.dueAt),
    // Idempotency: one task per external source item per user.
    uniqueIndex("tasks_source_unique")
      .on(t.userId, t.sourceType, t.sourceId)
      .where(sql`${t.sourceId} is not null`),
  ],
);

export const subtasks = pgTable("subtasks", {
  id: id(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  done: boolean("done").notNull().default(false),
  position: integer("position").notNull().default(0),
  createdAt: createdAt(),
});

export const taskCompletions = pgTable("task_completions", {
  id: id(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  completedAt: ts("completed_at").notNull(),
  reopenedAt: ts("reopened_at"),
});

export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** null for locally created events */
    accountId: uuid("account_id").references(() => connectedAccounts.id, { onDelete: "cascade" }),
    source: eventSourceEnum("source").notNull(),
    calendarId: text("calendar_id").notNull().default("local"),
    providerEventId: text("provider_event_id"),
    recurringEventId: text("recurring_event_id"),
    title: text("title").notNull(),
    description: text("description"),
    location: text("location"),
    startAt: ts("start_at").notNull(),
    endAt: ts("end_at").notNull(),
    allDay: boolean("all_day").notNull().default(false),
    timezone: text("timezone"),
    status: text("status").notNull().default("confirmed"),
    needsPrep: boolean("needs_prep").notNull().default(false),
    prepMin: integer("prep_min").notNull().default(15),
    htmlLink: text("html_link"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("calendar_events_user_time_idx").on(t.userId, t.startAt),
    uniqueIndex("calendar_events_provider_unique")
      .on(t.accountId, t.calendarId, t.providerEventId)
      .where(sql`${t.providerEventId} is not null`),
  ],
);

// ── Reminders & notifications ──
export const reminders = pgTable(
  "reminders",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").references(() => calendarEvents.id, { onDelete: "cascade" }),
    kind: reminderKindEnum("kind").notNull(),
    remindAt: ts("remind_at").notNull(),
    status: reminderStatusEnum("status").notNull().default("scheduled"),
    priority: priorityEnum("priority").notNull().default("medium"),
    note: text("note"),
    snoozeCount: integer("snooze_count").notNull().default(0),
    /** Bumped on every reschedule; the queue job id is `${id}:${version}` so stale jobs no-op. */
    version: integer("version").notNull().default(1),
    /** e.g. task:<id>:due — prevents duplicate reminders for the same purpose. */
    idempotencyKey: text("idempotency_key").notNull().unique(),
    firedAt: ts("fired_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("reminders_due_idx").on(t.status, t.remindAt)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reminderId: uuid("reminder_id").references(() => reminders.id, { onDelete: "set null" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    eventId: uuid("event_id").references(() => calendarEvents.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    priority: priorityEnum("priority").notNull().default("medium"),
    sound: soundEnum("sound").notNull(),
    channel: notificationChannelEnum("channel").notNull(),
    status: notificationStatusEnum("status").notNull().default("pending"),
    error: text("error"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    deliveredAt: ts("delivered_at"),
    seenAt: ts("seen_at"),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)],
);

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  failureCount: integer("failure_count").notNull().default(0),
  lastSuccessAt: ts("last_success_at"),
  createdAt: createdAt(),
});

// ── Planning ──
export const dailyPlans = pgTable(
  "daily_plans",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Local calendar date in the user's timezone, YYYY-MM-DD */
    date: text("date").notNull(),
    status: planStatusEnum("status").notNull().default("proposed"),
    generator: text("generator").notNull(),
    details: jsonb("details").notNull(),
    generatedAt: ts("generated_at").notNull().defaultNow(),
  },
  (t) => [index("daily_plans_user_date_idx").on(t.userId, t.date)],
);

export const dailyPlanItems = pgTable("daily_plan_items", {
  id: id(),
  planId: uuid("plan_id")
    .notNull()
    .references(() => dailyPlans.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: planItemKindEnum("kind").notNull(),
  taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
  eventId: uuid("event_id").references(() => calendarEvents.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  startAt: ts("start_at").notNull(),
  endAt: ts("end_at").notNull(),
  reason: text("reason"),
  /** true = imported/confirmed fact (an existing event); false = suggestion */
  isFact: boolean("is_fact").notNull(),
  position: integer("position").notNull(),
});

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: jsonb("metadata"),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_logs_user_idx").on(t.userId, t.createdAt)],
);
