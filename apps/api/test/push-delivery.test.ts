import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { notifications, pushSubscriptions, reminders } from "@lifepilot/db";
import { MAX_PUSH_FAILURES, processReminderJob, type PushResult, type PushSender } from "@lifepilot/core";
import { closeDb, makeCtx, resetDb, signUp } from "./helpers.js";

afterAll(closeDb);
beforeEach(resetDb);

const IST = (iso: string) => new Date(`${iso}+05:30`);

/** Fake push service: records sends and answers with the scripted result. */
function fakePush(result: () => PushResult) {
  const sent: { endpoint: string; payload: Record<string, unknown> }[] = [];
  const sender: PushSender = {
    configured: true,
    publicKey: "test-public-key",
    async send(target, payload) {
      sent.push({ endpoint: target.endpoint, payload: payload as Record<string, unknown> });
      return result();
    },
  };
  return { sender, sent };
}

async function setup(result: () => PushResult) {
  const h = makeCtx();
  const push = fakePush(result);
  h.ctx.push = push.sender;
  const s = await signUp(h.app);
  // In-app off so these tests look only at the web-push channel.
  await s.agent.patch("/api/v1/preferences").send({ webPushEnabled: true, inAppEnabled: false, quietHoursEnabled: false }).expect(200);
  await h.ctx.db.insert(pushSubscriptions).values({ userId: s.user.id, endpoint: "https://push.example/sub-1", p256dh: "p256dh-key-0123456789", auth: "auth-key-01" });
  const task = (await s.agent.post("/api/v1/tasks").send({ title: "Pay rent", dueAt: IST("2026-11-02T17:00:00").toISOString() }).expect(201)).body;
  const due = (await h.ctx.db.query.reminders.findFirst({ where: and(eq(reminders.taskId, task.id), eq(reminders.kind, "due")) }))!;
  h.setNow(due.remindAt);
  return { ...h, ...s, push, due };
}

const webPushRows = (ctx: ReturnType<typeof makeCtx>["ctx"]) => ctx.db.query.notifications.findMany({ where: eq(notifications.channel, "web_push") });

describe("web push delivery", () => {
  it("sends once, records 'accepted', and a retried job sends nothing more", async () => {
    const { ctx, push, due } = await setup(() => ({ ok: true, statusCode: 201 }));
    expect((await processReminderJob(ctx, { reminderId: due.id, version: due.version })).status).toBe("delivered");
    await processReminderJob(ctx, { reminderId: due.id, version: due.version });
    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]!.payload).toMatchObject({ title: "Due now: Pay rent", reminderId: due.id });
    const rows = await webPushRows(ctx);
    expect(rows.map((r) => r.status)).toEqual(["accepted"]);
  });

  it("finishes a push that was saved but never sent because the worker crashed", async () => {
    const { ctx, push, due, user } = await setup(() => ({ ok: true, statusCode: 201 }));
    // State left by a crash: the pending row exists, the reminder is still scheduled.
    await ctx.db.insert(notifications).values({
      userId: user.id,
      reminderId: due.id,
      type: "task_due",
      title: "Due now: Pay rent",
      body: "",
      sound: "daily_chime",
      channel: "web_push",
      status: "pending",
      idempotencyKey: `${due.id}:v${due.version}:web_push`,
    });
    await processReminderJob(ctx, { reminderId: due.id, version: due.version });
    expect(push.sent).toHaveLength(1);
    expect((await webPushRows(ctx)).map((r) => r.status)).toEqual(["accepted"]);
  });

  it("removes a subscription the push service reports as gone", async () => {
    const { ctx, due } = await setup(() => ({ ok: false, statusCode: 410, gone: true, error: "410 Gone" }));
    await processReminderJob(ctx, { reminderId: due.id, version: due.version });
    expect(await ctx.db.select().from(pushSubscriptions)).toHaveLength(0);
    const [row] = await webPushRows(ctx);
    expect(row!.status).toBe("failed");
    expect(row!.error).toMatch(/expired/);
  });

  it(`drops a subscription after ${MAX_PUSH_FAILURES} consecutive failures, not before`, async () => {
    const { ctx, due } = await setup(() => ({ ok: false, statusCode: 400, gone: false, error: "400 Bad Request" }));
    await ctx.db.update(pushSubscriptions).set({ failureCount: MAX_PUSH_FAILURES - 2 });
    await processReminderJob(ctx, { reminderId: due.id, version: due.version });
    expect((await ctx.db.select().from(pushSubscriptions))[0]!.failureCount).toBe(MAX_PUSH_FAILURES - 1);

    // Next reminder fails again → removed, with the reason recorded on the notification.
    const [r2] = await ctx.db.update(reminders).set({ status: "scheduled", version: due.version + 1 }).where(eq(reminders.id, due.id)).returning();
    await processReminderJob(ctx, { reminderId: r2!.id, version: r2!.version });
    expect(await ctx.db.select().from(pushSubscriptions)).toHaveLength(0);
    const latest = (await webPushRows(ctx)).find((r) => r.idempotencyKey.includes(`:v${r2!.version}:`))!;
    expect(latest.error).toMatch(/removed after/);
  });
});
