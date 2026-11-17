import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { notifications, reminders } from "@lifepilot/db";
import { processReminderJob, reconcileScheduledReminders } from "@lifepilot/core";
import { closeDb, makeCtx, resetDb, signUp } from "./helpers.js";

afterAll(closeDb);
beforeEach(resetDb);

const IST = (iso: string) => new Date(`${iso}+05:30`).toISOString();

describe("reminder reliability across restarts", () => {
  it("restart reconciliation re-enqueues the user's latest choice, not an older one", async () => {
    const h = makeCtx(); // now = 09:00 IST
    const { agent } = await signUp(h.app);
    await agent.patch("/api/v1/preferences").send({ quietHoursEnabled: false }).expect(200);
    const snoozed = (await agent.post("/api/v1/reminders").send({ note: "Call the bank", remindAt: IST("2026-11-02T10:00:00") }).expect(201)).body;
    const cancelled = (await agent.post("/api/v1/reminders").send({ note: "Water plants", remindAt: IST("2026-11-02T11:00:00") }).expect(201)).body;
    const task = (await agent.post("/api/v1/tasks").send({ title: "Submit report", dueAt: IST("2026-11-02T17:00:00") }).expect(201)).body;
    await agent.post(`/api/v1/reminders/${snoozed.id}/snooze`).send({ minutes: 60 }).expect(200); // now version 2, 10:00 IST
    await agent.delete(`/api/v1/reminders/${cancelled.id}`).expect(204);
    await agent.post(`/api/v1/tasks/${task.id}/complete`).expect(200);

    // Simulate a restart after Redis lost every queued job.
    h.jobs.scheduled.clear();
    const n = await reconcileScheduledReminders(h.ctx);
    expect(n).toBe(1);
    expect([...h.jobs.scheduled.values()]).toEqual([{ reminderId: snoozed.id, version: 2, at: new Date(IST("2026-11-02T10:00:00")) }]);

    // A stale job from before the snooze, if it still existed somewhere, does nothing.
    h.setNow(new Date(IST("2026-11-02T10:00:00")));
    expect(await processReminderJob(h.ctx, { reminderId: snoozed.id, version: 1 })).toEqual({ status: "skipped", reason: "stale version" });
    expect((await processReminderJob(h.ctx, { reminderId: snoozed.id, version: 2 })).status).toBe("delivered");
    // A second worker picking up the same job delivers nothing more.
    expect((await processReminderJob(h.ctx, { reminderId: snoozed.id, version: 2 })).status).toBe("skipped");
    expect(await h.ctx.db.select().from(notifications).where(eq(notifications.reminderId, snoozed.id))).toHaveLength(1);

    // Once fired, a later restart has nothing to re-enqueue.
    h.jobs.scheduled.clear();
    expect(await reconcileScheduledReminders(h.ctx)).toBe(0);
    const rows = await h.ctx.db.select().from(reminders);
    expect(rows.find((r) => r.id === cancelled.id)!.status).toBe("cancelled");
    expect(rows.filter((r) => r.taskId === task.id).every((r) => r.status === "cancelled")).toBe(true);
  });

  it("re-checks quiet hours when a reminder fires after a restart", async () => {
    const h = makeCtx();
    const { agent } = await signUp(h.app);
    const r = (await agent.post("/api/v1/reminders").send({ note: "Late reminder", remindAt: IST("2026-11-02T21:00:00") }).expect(201)).body;
    // The worker was down; it comes back at 23:30 IST, inside the default 22:00–07:00 quiet hours.
    h.setNow(new Date(IST("2026-11-02T23:30:00")));
    const out = await processReminderJob(h.ctx, { reminderId: r.id, version: r.version ?? 1 });
    expect(out.status).toBe("deferred");
    const row = (await h.ctx.db.query.reminders.findFirst({ where: eq(reminders.id, r.id) }))!;
    expect(row.remindAt.toISOString()).toBe(new Date(IST("2026-11-03T07:00:00")).toISOString());
    expect(await h.ctx.db.select().from(notifications)).toHaveLength(0);
  });
});
