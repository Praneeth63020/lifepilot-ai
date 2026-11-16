import { and, eq } from "drizzle-orm";
import supertest from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { connectedAccounts, pushSubscriptions, reminders, syncedEmails, tasks } from "@lifepilot/db";
import { createLogger, processReminderJob } from "@lifepilot/core";
import { createApp } from "../src/app.js";
import { closeDb, makeCtx, resetDb, signUp } from "./helpers.js";

afterAll(closeDb);
beforeEach(resetDb);

const IST = (iso: string) => new Date(`${iso}+05:30`).toISOString();

describe("request logs", () => {
  it("never contain OAuth codes, state or tokens from the query string", async () => {
    const h = makeCtx();
    const lines: string[] = [];
    const ctx = { ...h.ctx, logger: createLogger("info", "test", { write: (s: string) => void lines.push(s) }) };
    const app = createApp(ctx, { requestLogging: true });
    await supertest(app).get("/api/v1/integrations/google/callback").query({ code: "SECRET-AUTH-CODE", state: "SECRET-STATE", scope: "x" }).expect(303);
    const log = lines.join("\n");
    expect(log).toContain("/api/v1/integrations/google/callback");
    expect(log).not.toContain("SECRET-AUTH-CODE");
    expect(log).not.toContain("SECRET-STATE");
    expect(log).toContain("code=[redacted]");
    expect(log).toContain("scope=x"); // harmless parameters stay readable
  });
});

describe("password reset links", () => {
  it("using one reset link invalidates every other outstanding one", async () => {
    const { app, mailer } = makeCtx();
    await signUp(app, "reset@example.com");
    const anon = supertest.agent(app).set("x-lifepilot-csrf", "1");
    const linkToken = () => /token=([\w-]+)/.exec(mailer.outbox.at(-1)!.text)![1]!;
    await anon.post("/api/v1/auth/request-password-reset").send({ email: "reset@example.com" }).expect(200);
    const first = linkToken();
    await anon.post("/api/v1/auth/request-password-reset").send({ email: "reset@example.com" }).expect(200);
    const second = linkToken();
    await anon.post("/api/v1/auth/reset-password").send({ token: second, password: "brand-new-password-1" }).expect(200);
    // An older email still sitting in the inbox must not allow another reset.
    await anon.post("/api/v1/auth/reset-password").send({ token: first, password: "attacker-password-2" }).expect(400);
    await anon.post("/api/v1/auth/login").send({ email: "reset@example.com", password: "brand-new-password-1" }).expect(200);
  });
});

describe("customer data isolation (two users)", () => {
  it("user B can't read, change, act on, export or delete anything of user A's", async () => {
    const h = makeCtx();
    const a = await signUp(h.app, "alice@example.com");
    const b = await signUp(h.app, "bob@example.com");

    // ── Everything user A owns ──
    await a.agent.post("/api/v1/integrations/demo").expect(200); // synced emails, insights, demo events
    const project = (await a.agent.post("/api/v1/projects").send({ name: "Alice's project" }).expect(201)).body;
    const task = (await a.agent.post("/api/v1/tasks").send({ title: "Alice's task", projectId: project.id, dueAt: IST("2026-11-03T17:00:00"), subtasks: ["Alice's step"] }).expect(201)).body;
    const subtask = task.subtasks[0];
    const event = (await a.agent.post("/api/v1/calendar/events").send({ title: "Alice's event", startAt: IST("2026-11-03T10:00:00"), endAt: IST("2026-11-03T11:00:00") }).expect(201)).body;
    const reminder = (await a.agent.post("/api/v1/reminders").send({ taskId: task.id, remindAt: IST("2026-11-02T12:00:00") }).expect(201)).body;
    const plan = (await a.agent.post("/api/v1/plans/generate").send({}).expect(201)).body.plan;
    const insight = (await a.agent.get("/api/v1/insights").query({ status: "all" }).expect(200)).body.items[0];
    h.setNow(new Date(reminder.remindAt));
    await processReminderJob(h.ctx, { reminderId: reminder.id, version: 1 });
    const notification = (await a.agent.get("/api/v1/notifications").expect(200)).body.items[0];
    await h.ctx.db.insert(pushSubscriptions).values({ userId: a.user.id, endpoint: "https://push.example/alice", p256dh: "p256dh-key-0123456789", auth: "auth-key-01" });
    const aliceIds = [a.user.id, project.id, task.id, subtask.id, event.id, reminder.id, plan.id, insight.id, insight.email.id, notification.id];
    expect(aliceIds.every(Boolean)).toBe(true);

    // ── Reading by id ──
    for (const url of [`/tasks/${task.id}`, `/projects/${project.id}`, `/calendar/events/${event.id}`, `/calendar/events/${event.id}/alternatives`, `/insights/${insight.id}`]) {
      await b.agent.get(`/api/v1${url}`).expect(404);
    }
    // ── Changing or acting on ──
    const denied: [string, string, object?][] = [
      ["patch", `/tasks/${task.id}`, { title: "pwned" }],
      ["post", `/tasks/${task.id}/complete`],
      ["post", `/tasks/${task.id}/reopen`],
      ["post", `/tasks/${task.id}/subtasks`, { title: "x" }],
      ["patch", `/subtasks/${subtask.id}`, { done: true }],
      ["patch", `/projects/${project.id}`, { name: "pwned" }],
      ["patch", `/calendar/events/${event.id}`, { title: "pwned" }],
      ["patch", `/insights/${insight.id}`, { status: "dismissed" }],
      ["post", `/insights/${insight.id}/task`, { dueAt: null }],
      ["post", `/reminders/${reminder.id}/snooze`, { minutes: 30 }],
      ["post", `/notifications/${notification.id}/seen`],
      ["post", `/notifications/${notification.id}/dismiss`],
      ["post", `/notifications/${notification.id}/snooze`, { minutes: 30 }],
      ["post", `/notifications/${notification.id}/complete`],
      ["post", `/plans/${plan.id}/accept`],
      ["post", `/plans/${plan.id}/reject`],
      ["patch", `/plans/${plan.id}/items`, { items: [] }],
      ["post", "/tasks", { title: "x", projectId: project.id }],
      ["post", "/tasks", { title: "x", dependsOnTaskId: task.id }],
      ["post", "/reminders", { taskId: task.id, remindAt: IST("2026-11-05T12:00:00") }],
      ["post", "/reminders", { eventId: event.id, remindAt: IST("2026-11-05T12:00:00") }],
    ];
    for (const [method, url, body] of denied) {
      const res = await (b.agent as unknown as Record<string, (u: string) => supertest.Test>)[method]!(`/api/v1${url}`).send(body ?? {});
      expect([url, res.status]).toEqual([url, 404]);
    }
    // ── Deleting ──
    for (const url of [`/tasks/${task.id}`, `/subtasks/${subtask.id}`, `/projects/${project.id}`, `/calendar/events/${event.id}`, `/reminders/${reminder.id}`]) {
      expect([url, (await b.agent.delete(`/api/v1${url}`)).status]).toEqual([url, 404]);
    }
    await b.agent.delete("/api/v1/push/subscriptions").send({ endpoint: "https://push.example/alice" }).expect(204);
    await b.agent.delete("/api/v1/integrations/gmail").query({ deleteData: "true" }).expect(200);
    await b.agent.delete("/api/v1/integrations/calendar").query({ deleteData: "true" }).expect(200);

    // ── Nothing of A's appears in any of B's lists, dashboard or export ──
    const views = await Promise.all(
      ["/tasks?status=all", "/projects", "/calendar/events?from=2026-11-01T00:00:00Z&to=2026-11-10T00:00:00Z", "/insights?status=all", "/reminders?status=all", "/notifications", "/plans/current", "/dashboard", "/integrations", "/account/export"].map(
        async (u) => [u, JSON.stringify((await b.agent.get(`/api/v1${u}`).expect(200)).body)] as const,
      ),
    );
    for (const [u, body] of views) {
      for (const id of aliceIds) expect([u, body.includes(id)]).toEqual([u, false]);
      expect([u, body.includes("alice@example.com")]).toEqual([u, false]);
    }

    // ── B deleting their own account leaves A untouched ──
    await b.agent.delete("/api/v1/account").send({ password: "correct-horse-battery" }).expect(204);

    // ── A's data is exactly as before ──
    const after = (await a.agent.get(`/api/v1/tasks/${task.id}`).expect(200)).body;
    expect(after).toMatchObject({ title: "Alice's task", status: "open", projectId: project.id });
    expect(after.subtasks[0].done).toBe(false);
    expect((await a.agent.get(`/api/v1/projects/${project.id}`).expect(200)).body.name).toBe("Alice's project");
    expect((await a.agent.get(`/api/v1/calendar/events/${event.id}`).expect(200)).body.title).toBe("Alice's event");
    expect((await a.agent.get(`/api/v1/insights/${insight.id}`).expect(200)).body.status).not.toBe("dismissed");
    expect((await a.agent.get("/api/v1/notifications").expect(200)).body.items[0].status).toBe("available");
    expect((await a.agent.get("/api/v1/plans/current").expect(200)).body.plan.status).toBe("proposed");
    expect(await h.ctx.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, a.user.id))).toHaveLength(1);
    expect((await h.ctx.db.select().from(connectedAccounts).where(eq(connectedAccounts.userId, a.user.id))).every((c) => c.status === "active")).toBe(true);
    expect((await h.ctx.db.select().from(syncedEmails).where(eq(syncedEmails.userId, a.user.id))).length).toBeGreaterThan(0);
    const rem = await h.ctx.db.query.reminders.findFirst({ where: and(eq(reminders.id, reminder.id), eq(reminders.userId, a.user.id)) });
    expect(rem!.snoozeCount).toBe(0);
    expect(await h.ctx.db.select().from(tasks).where(eq(tasks.userId, a.user.id))).not.toHaveLength(0);
  });

  it("authentication failures reveal nothing about whether an account exists", async () => {
    const { app } = makeCtx();
    await signUp(app, "exists@example.com");
    const anon = supertest.agent(app).set("x-lifepilot-csrf", "1");
    const wrongPassword = await anon.post("/api/v1/auth/login").send({ email: "exists@example.com", password: "not-the-password" });
    const noAccount = await anon.post("/api/v1/auth/login").send({ email: "nobody@example.com", password: "not-the-password" });
    expect([wrongPassword.status, noAccount.status]).toEqual([401, 401]);
    expect(wrongPassword.body).toEqual(noAccount.body);
  });
});
