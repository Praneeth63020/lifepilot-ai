import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { reminders } from "@lifepilot/db";
import { closeDb, makeCtx, resetDb, signUp } from "./helpers.js";

afterAll(closeDb);
beforeEach(resetDb);

const IST = (iso: string) => new Date(`${iso}+05:30`).toISOString();

describe("tasks and reminders", () => {
  it("schedules prep + due reminders, cancels on completion, re-arms on reopen", async () => {
    const { app, ctx, jobs } = makeCtx();
    const { agent } = await signUp(app);
    const t = (await agent.post("/api/v1/tasks").send({ title: "Submit report", dueAt: IST("2026-11-02T17:00:00"), estimateMin: 60, priority: "high" }).expect(201)).body;

    let rows = await ctx.db.query.reminders.findMany({ where: eq(reminders.taskId, t.id) });
    expect(rows.map((r) => [r.kind, r.status]).sort()).toEqual([["due", "scheduled"], ["prep", "scheduled"]]);
    expect(rows.find((r) => r.kind === "prep")!.remindAt.toISOString()).toBe(IST("2026-11-02T16:00:00"));
    expect(jobs.scheduled.size).toBe(2);

    // Editing something unrelated doesn't duplicate reminders or jobs.
    await agent.patch(`/api/v1/tasks/${t.id}`).send({ description: "with appendix" }).expect(200);
    expect(jobs.scheduled.size).toBe(2);
    expect(await ctx.db.query.reminders.findMany({ where: eq(reminders.taskId, t.id) })).toHaveLength(2);

    // Moving the deadline reschedules (new version, old job removed).
    await agent.patch(`/api/v1/tasks/${t.id}`).send({ dueAt: IST("2026-11-02T18:00:00") }).expect(200);
    rows = await ctx.db.query.reminders.findMany({ where: eq(reminders.taskId, t.id) });
    expect(rows.every((r) => r.version === 2)).toBe(true);
    expect(jobs.cancelled).toHaveLength(2);

    const done = await agent.post(`/api/v1/tasks/${t.id}/complete`).expect(200);
    expect(done.body.cancelledReminders).toBe(2);
    expect(jobs.scheduled.size).toBe(0);
    rows = await ctx.db.query.reminders.findMany({ where: and(eq(reminders.taskId, t.id), eq(reminders.status, "scheduled")) });
    expect(rows).toHaveLength(0);

    await agent.post(`/api/v1/tasks/${t.id}/reopen`).expect(200);
    expect(jobs.scheduled.size).toBe(2);
  });

  it("supports subtasks, search, filters, and recurring tasks", async () => {
    const { app } = makeCtx();
    const { agent } = await signUp(app);
    const t = (await agent.post("/api/v1/tasks").send({ title: "Water plants", dueAt: IST("2026-11-02T19:00:00"), recurrence: "weekly", subtasks: ["Balcony", "Kitchen"] }).expect(201)).body;
    expect(t.subtasks.map((s: { title: string }) => s.title)).toEqual(["Balcony", "Kitchen"]);
    await agent.post("/api/v1/tasks").send({ title: "Pay rent", priority: "urgent", tags: ["home"] }).expect(201);

    expect((await agent.get("/api/v1/tasks").query({ q: "rent" })).body.items).toHaveLength(1);
    expect((await agent.get("/api/v1/tasks").query({ tag: "home" })).body.items).toHaveLength(1);
    expect((await agent.get("/api/v1/tasks").query({ sort: "priority" })).body.items[0].title).toBe("Pay rent");

    const done = await agent.post(`/api/v1/tasks/${t.id}/complete`).expect(200);
    expect(done.body.next.dueAt).toBe(IST("2026-11-09T19:00:00"));
    expect(done.body.next.subtasks).toHaveLength(2);
  });

  it("validates input", async () => {
    const { app } = makeCtx();
    const { agent } = await signUp(app);
    const bad = await agent.post("/api/v1/tasks").send({ title: "", priority: "huge" }).expect(400);
    expect(bad.body.error.code).toBe("validation_error");
    await agent.get("/api/v1/tasks/not-a-uuid").expect(404);
  });
});

describe("daily planner API", () => {
  it("plans around events, can be accepted, and replans with a diff", async () => {
    const { app, setNow } = makeCtx();
    const { agent } = await signUp(app);
    await agent.post("/api/v1/calendar/events").send({ title: "Stand-up", startAt: IST("2026-11-02T10:00:00"), endAt: IST("2026-11-02T10:30:00") }).expect(201);
    await agent.post("/api/v1/tasks").send({ title: "Write spec", estimateMin: 60, priority: "high", dueAt: IST("2026-11-02T17:00:00") }).expect(201);
    await agent.post("/api/v1/tasks").send({ title: "Inbox zero", estimateMin: 30 }).expect(201);

    const gen = (await agent.post("/api/v1/plans/generate").send({}).expect(201)).body.plan;
    expect(gen.status).toBe("proposed");
    const event = gen.items.find((i: { kind: string }) => i.kind === "event");
    expect(event.isFact).toBe(true);
    for (const i of gen.items.filter((x: { kind: string }) => x.kind === "task")) {
      expect(i.isFact).toBe(false);
      const overlaps = new Date(i.startAt) < new Date(event.endAt) && new Date(event.startAt) < new Date(i.endAt);
      expect(overlaps).toBe(false);
      expect(i.reason).toBeTruthy();
    }
    expect(gen.topTasks[0].title).toBe("Write spec");

    await agent.post(`/api/v1/plans/${gen.id}/accept`).expect(200);
    expect((await agent.get("/api/v1/plans/current")).body.plan.id).toBe(gen.id);

    // Moving a block onto the event is refused; events can't be moved from the planner.
    const taskItem = gen.items.find((i: { kind: string }) => i.kind === "task");
    await agent.patch(`/api/v1/plans/${gen.id}/items`).send({ items: [{ id: taskItem.id, startAt: event.startAt, endAt: event.endAt }] }).expect(400);
    await agent.patch(`/api/v1/plans/${gen.id}/items`).send({ items: [{ id: event.id, startAt: taskItem.startAt, endAt: taskItem.endAt }] }).expect(400);

    // Late morning: replanning only uses time from now on and reports what moved.
    setNow(new Date(IST("2026-11-02T13:02:00")));
    const re = (await agent.post("/api/v1/plans/replan").expect(201)).body.plan;
    const firstTask = re.items.find((i: { kind: string }) => i.kind === "task");
    expect(new Date(firstTask.startAt) >= new Date(IST("2026-11-02T13:05:00"))).toBe(true);
    expect(re.changes.some((c: { change: string }) => c.change === "moved")).toBe(true);
    // The accepted plan remains until the user accepts the new proposal.
    expect((await agent.get("/api/v1/plans/current")).body.plan.id).toBe(gen.id);
  });
});
