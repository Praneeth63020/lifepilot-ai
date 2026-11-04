import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { notifications, reminders, users } from "@lifepilot/db";
import { processReminderJob } from "@lifepilot/core";
import { closeDb, makeCtx, resetDb, signUp } from "./helpers.js";

afterAll(closeDb);
beforeEach(resetDb);

const IST = (iso: string) => new Date(`${iso}+05:30`);

async function setupWithTask(dueLocal = "2026-11-02T17:00:00") {
  const h = makeCtx();
  const s = await signUp(h.app);
  const task = (await s.agent.post("/api/v1/tasks").send({ title: "Ship release notes", dueAt: IST(dueLocal).toISOString(), priority: "high" }).expect(201)).body;
  const rows = await h.ctx.db.query.reminders.findMany({ where: eq(reminders.taskId, task.id) });
  return { ...h, ...s, task, prep: rows.find((r) => r.kind === "prep")!, due: rows.find((r) => r.kind === "due")! };
}

describe("notification delivery", () => {
  it("delivers in-app once (idempotent), with an escalated sound", async () => {
    const { ctx, agent, prep, due, setNow } = await setupWithTask();
    setNow(prep.remindAt);
    const first = await processReminderJob(ctx, { reminderId: prep.id, version: prep.version });
    expect(first.status).toBe("delivered");
    // A retried / duplicated job is a no-op.
    const again = await processReminderJob(ctx, { reminderId: prep.id, version: prep.version });
    expect(again).toEqual({ status: "skipped", reason: "reminder fired" });
    setNow(due.remindAt);
    await processReminderJob(ctx, { reminderId: due.id, version: due.version });

    const list = (await agent.get("/api/v1/notifications")).body.items;
    expect(list).toHaveLength(2);
    expect(list.map((n: { sound: string }) => n.sound).sort()).toEqual(["deadline_alert", "priority_alert"]);
    expect(list.every((n: { status: string }) => n.status === "available")).toBe(true);
    expect(list.map((n: { title: string }) => n.title)).toContain("Due now: Ship release notes");
  });

  it("does not deliver for completed tasks or stale versions", async () => {
    const { ctx, agent, task, prep, setNow } = await setupWithTask();
    await agent.post(`/api/v1/tasks/${task.id}/complete`).expect(200);
    setNow(prep.remindAt);
    expect((await processReminderJob(ctx, { reminderId: prep.id, version: prep.version })).status).toBe("skipped");
    expect((await processReminderJob(ctx, { reminderId: prep.id, version: 99 })).status).toBe("skipped");
    expect(await ctx.db.select().from(notifications)).toHaveLength(0);
  });

  it("defers delivery that lands in quiet hours (preferences changed after scheduling)", async () => {
    const { ctx, agent, prep, jobs, setNow } = await setupWithTask();
    await agent.patch("/api/v1/preferences").send({ quietHoursEnabled: true, quietStartMin: 15 * 60, quietEndMin: 18 * 60 }).expect(200);
    // syncTaskReminders already moved prep out of quiet hours; simulate an old job firing at 16:00 anyway.
    setNow(IST("2026-11-02T16:00:00"));
    const fresh = (await ctx.db.query.reminders.findFirst({ where: eq(reminders.id, prep.id) }))!;
    const out = await processReminderJob(ctx, { reminderId: fresh.id, version: fresh.version });
    expect(out.status).toBe("deferred");
    if (out.status === "deferred") expect(out.until.toISOString()).toBe(IST("2026-11-02T18:00:00").toISOString());
    expect(await ctx.db.select().from(notifications)).toHaveLength(0);
    expect([...jobs.scheduled.values()].some((j) => j.at.getTime() === IST("2026-11-02T18:00:00").getTime())).toBe(true);
  });

  it("snooze, dismiss and complete from a notification", async () => {
    const { ctx, agent, task, prep, setNow } = await setupWithTask();
    setNow(prep.remindAt);
    await processReminderJob(ctx, { reminderId: prep.id, version: prep.version });
    const [n] = (await agent.get("/api/v1/notifications")).body.items;
    const sn = await agent.post(`/api/v1/notifications/${n.id}/snooze`).send({ minutes: 15 }).expect(200);
    expect(sn.body.snoozeCount).toBe(1);
    expect(sn.body.remindAt).toBe(new Date(prep.remindAt.getTime() + 15 * 60_000).toISOString());

    const r2 = (await ctx.db.query.reminders.findFirst({ where: eq(reminders.id, prep.id) }))!;
    setNow(r2.remindAt);
    await processReminderJob(ctx, { reminderId: r2.id, version: r2.version });
    const latest = (await agent.get("/api/v1/notifications").query({ unseen: "true" })).body.items[0];
    await agent.post(`/api/v1/notifications/${latest.id}/complete`).expect(200);
    expect((await agent.get(`/api/v1/tasks/${task.id}`)).body.status).toBe("done");
    const due = await ctx.db.query.reminders.findMany({ where: eq(reminders.taskId, task.id) });
    expect(due.find((r) => r.kind === "due")!.status).toBe("cancelled");
  });
});

describe("account data controls", () => {
  it("exports data without secrets and deletes everything with the password", async () => {
    const { ctx, agent, user } = await setupWithTask();
    await agent.post("/api/v1/integrations/demo").expect(200);
    const exp = await agent.get("/api/v1/account/export").expect(200);
    const text = JSON.stringify(exp.body);
    expect(exp.body.tasks.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/passwordHash|accessTokenEnc|refreshTokenEnc/);

    await agent.delete("/api/v1/account").send({ password: "wrong" }).expect(401);
    await agent.delete("/api/v1/account").send({ password: "correct-horse-battery" }).expect(204);
    expect(await ctx.db.query.users.findFirst({ where: eq(users.id, user.id) })).toBeUndefined();
    expect(await ctx.db.select().from(reminders)).toHaveLength(0);
    await agent.get("/api/v1/auth/me").expect(401);
  });
});

describe("dashboard", () => {
  it("summarises the day with deterministic recommendations", async () => {
    const { agent } = await setupWithTask();
    await agent.post("/api/v1/integrations/demo").expect(200);
    const d = (await agent.get("/api/v1/dashboard").expect(200)).body;
    expect(d.date).toBe("2026-11-02");
    expect(d.topTasks.length).toBeGreaterThan(0);
    expect(d.importantEmails.length).toBeGreaterThan(0);
    expect(d.recommendations.join(" ")).toMatch(/overdue/);
    expect(d.recommendations.join(" ")).toMatch(/conflict/);
    expect(d.connections.map((c: { provider: string }) => c.provider)).toEqual(["demo", "demo"]);
    const week = (await agent.get("/api/v1/dashboard/week").expect(200)).body;
    expect(week.days).toHaveLength(7);
  });
});
