/**
 * Real Redis + real BullMQ + real Postgres: reminders survive a worker restart,
 * fire exactly once, and are cancelled when the task is completed first.
 */
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, notifications, reminders, userPreferences, users } from "@lifepilot/db";
import { BullJobScheduler, createRedis } from "@lifepilot/jobs";
import {
  MockExtractor,
  completeTask,
  createLogger,
  createMailer,
  createPushSender,
  createTask,
  loadConfig,
  runSync,
  connectDemo,
  type CoreContext,
} from "@lifepilot/core";
import { startWorkers } from "../src/workers.js";

const DB_URL = process.env.TEST_DATABASE_URL ?? "postgresql://lifepilot:lifepilot@localhost:5432/lifepilot_test";
const REDIS_URL = "redis://localhost:6379/2";
const prefix = `lptest${Date.now()}`;
const { db, pool } = createDb(DB_URL);
const redis = createRedis(REDIS_URL);
const jobs = new BullJobScheduler(redis, prefix);
const logger = createLogger("silent", "worker-test");
const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_URL: DB_URL,
  REDIS_URL,
  SESSION_SECRET: "x".repeat(40),
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
  DEMO_MODE: "true",
  AI_PROVIDER: "mock",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
});
const ctx: CoreContext = {
  db,
  config,
  logger,
  jobs,
  extractor: new MockExtractor(),
  mailer: createMailer(undefined, "x@example.com", logger),
  push: createPushSender(null),
  fetch: async () => new Response("no network", { status: 599 }),
  now: () => new Date(),
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn: () => Promise<boolean>, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(200);
  }
  return false;
}

let userId: string;
beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../packages/db/migrations") });
  await db.execute(sql`TRUNCATE users RESTART IDENTITY CASCADE`);
  const [u] = await db.insert(users).values({ email: "worker@example.com", name: "W", passwordHash: "x" }).returning();
  userId = u!.id;
  await db.insert(userPreferences).values({ userId, timezone: "UTC", quietHoursEnabled: false, reminderLeadMin: 60 });
});

afterAll(async () => {
  await jobs.reminders.obliterate({ force: true }).catch(() => undefined);
  await jobs.sync.obliterate({ force: true }).catch(() => undefined);
  await jobs.close();
  await redis.quit();
  await pool.end();
});

describe("persistent reminder queue", () => {
  it("fires after a worker restart, once, and skips completed tasks", async () => {
    const dueAt = new Date(Date.now() + 60 * 60_000 + 3_000); // prep reminder fires in ~3s
    const keep = await createTask(ctx, userId, { title: "Survives restart", priority: "medium", dueAt: dueAt.toISOString(), tags: [], recurrence: "none" });
    const done = await createTask(ctx, userId, { title: "Completed early", priority: "medium", dueAt: dueAt.toISOString(), tags: [], recurrence: "none" });

    // Worker #1 starts and "crashes" before the reminders are due.
    const conn1 = createRedis(REDIS_URL);
    const w1 = startWorkers(ctx, conn1, prefix);
    await sleep(300);
    await w1.close();
    await conn1.quit();

    await completeTask(ctx, userId, done.task.id);

    // Worker #2 comes up later; the delayed job is still in Redis.
    await sleep(3500);
    const conn2 = createRedis(REDIS_URL);
    const w2 = startWorkers(ctx, conn2, prefix);
    const fired = await waitFor(async () => {
      const r = await db.query.reminders.findFirst({ where: eq(reminders.idempotencyKey, `task:${keep.task.id}:prep`) });
      return r?.status === "fired";
    });
    expect(fired).toBe(true);

    const ns = await db.select().from(notifications).where(eq(notifications.userId, userId));
    expect(ns).toHaveLength(1);
    expect(ns[0]!.title).toBe("Coming up: Survives restart");
    expect(ns[0]!.status).toBe("available");

    // Re-enqueueing the same (reminder, version) is a no-op — no duplicate notification.
    const r = (await db.query.reminders.findFirst({ where: eq(reminders.idempotencyKey, `task:${keep.task.id}:prep`) }))!;
    await jobs.scheduleReminder(r.id, r.version, new Date());
    await sleep(1500);
    expect(await db.select().from(notifications).where(eq(notifications.userId, userId))).toHaveLength(1);

    const cancelled = await db.query.reminders.findMany({ where: eq(reminders.taskId, done.task.id) });
    expect(cancelled.every((x) => x.status === "cancelled")).toBe(true);
    await w2.close();
    await conn2.quit();
  }, 30_000);

  it("processes sync jobs and stops after disconnection", async () => {
    const acct = await connectDemo(ctx, userId, "calendar");
    await jobs.startRecurringSync(acct.id);
    expect((await jobs.sync.getJobSchedulers()).map((s) => s.key)).toContain(`sync_${acct.id}`);
    expect((await runSync(ctx, acct.id)).status).toBe("succeeded");
    // Disconnect → scheduler removed and any queued job is skipped.
    const { disconnect } = await import("@lifepilot/core");
    await disconnect(ctx, userId, "calendar", false);
    expect((await jobs.sync.getJobSchedulers()).map((s) => s.key)).not.toContain(`sync_${acct.id}`);
    expect((await runSync(ctx, acct.id)).status).toBe("skipped");
  });
});
