import { sql } from "drizzle-orm";
import supertest from "supertest";
import { createDb } from "@lifepilot/db";
import type { JobScheduler, SyncJobData } from "@lifepilot/jobs";
import {
  MockExtractor,
  createLogger,
  createMailer,
  createPushSender,
  loadConfig,
  type CoreContext,
  type FetchLike,
} from "@lifepilot/core";
import { createApp } from "../src/app.js";

export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? "postgresql://lifepilot:lifepilot@localhost:5432/lifepilot_test";

/** Records queue operations instead of talking to Redis, so API tests are deterministic. */
export class RecordingScheduler implements JobScheduler {
  scheduled = new Map<string, { reminderId: string; version: number; at: Date }>();
  cancelled: string[] = [];
  syncs: { accountId: string; reason: SyncJobData["reason"] }[] = [];
  recurring = new Set<string>();
  async scheduleReminder(reminderId: string, version: number, at: Date) {
    this.scheduled.set(`${reminderId}:${version}`, { reminderId, version, at });
  }
  async cancelReminder(reminderId: string, version: number) {
    this.cancelled.push(`${reminderId}:${version}`);
    this.scheduled.delete(`${reminderId}:${version}`);
  }
  async enqueueSync(accountId: string, reason: SyncJobData["reason"]) {
    this.syncs.push({ accountId, reason });
  }
  async startRecurringSync(accountId: string) {
    this.recurring.add(accountId);
  }
  async stopRecurringSync(accountId: string) {
    this.recurring.delete(accountId);
  }
  async close() {}
}

/** Monday 2 Nov 2026, 09:00 in Asia/Kolkata. */
export const FIXED_NOW = new Date("2026-11-02T03:30:00.000Z");

const shared = createDb(TEST_DB_URL, { max: 5 });

export function makeCtx(over: { now?: () => Date; fetch?: FetchLike; google?: boolean; demoMode?: boolean } = {}) {
  const config = loadConfig({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    DATABASE_URL: TEST_DB_URL,
    REDIS_URL: "redis://localhost:6379/1",
    SESSION_SECRET: "test-session-secret-test-session-secret-123",
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    DEMO_MODE: over.demoMode === false ? "false" : "true",
    AI_PROVIDER: "mock",
    WEB_URL: "http://localhost:5173",
    API_URL: "http://localhost:4000",
    GOOGLE_CLIENT_ID: over.google ? "test-client-id.apps.googleusercontent.com" : "",
    GOOGLE_CLIENT_SECRET: over.google ? "test-client-secret" : "",
    GOOGLE_REDIRECT_URI: "http://localhost:4000/api/v1/integrations/google/callback",
    SMTP_URL: "",
    VAPID_PUBLIC_KEY: "",
    VAPID_PRIVATE_KEY: "",
  });
  const logger = createLogger("silent", "test");
  const jobs = new RecordingScheduler();
  const mailer = createMailer(undefined, "test@example.com", logger);
  let current = FIXED_NOW;
  const ctx: CoreContext = {
    db: shared.db,
    config,
    logger,
    jobs,
    extractor: new MockExtractor(),
    mailer,
    push: createPushSender(null),
    fetch: over.fetch ?? (async () => new Response("unexpected network call in test", { status: 599 })),
    now: over.now ?? (() => current),
  };
  const app = createApp(ctx);
  return {
    ctx,
    jobs,
    mailer,
    app,
    setNow(d: Date) {
      current = d;
    },
  };
}

export async function resetDb() {
  await shared.db.execute(sql`
    TRUNCATE users, sessions, auth_tokens, oauth_states, connected_accounts, sync_jobs, synced_emails, email_insights,
      projects, tasks, subtasks, task_completions, calendar_events, reminders, notifications, push_subscriptions,
      daily_plans, daily_plan_items, audit_logs, user_preferences RESTART IDENTITY CASCADE`);
}

export async function closeDb() {
  await shared.pool.end();
}

/** A logged-in supertest agent (cookie jar + CSRF header on every request). */
export async function signUp(app: ReturnType<typeof makeCtx>["app"], email = `u${Math.random().toString(36).slice(2)}@example.com`, timezone = "Asia/Kolkata") {
  const agent = supertest.agent(app);
  agent.set("x-lifepilot-csrf", "1");
  const res = await agent.post("/api/v1/auth/register").send({ email, password: "correct-horse-battery", name: "Test User", timezone });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, user: res.body.user as { id: string; email: string }, email };
}
