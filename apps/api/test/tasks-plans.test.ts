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

  it("PATCH only changes the fields it sends", async () => {
    const { app } = makeCtx();
    const { agent } = await signUp(app);
    const t = (
      await agent
        .post("/api/v1/tasks")
        .send({ title: "Gym", priority: "urgent", tags: ["health"], recurrence: "daily", dueAt: IST("2026-11-02T19:00:00") })
        .expect(201)
    ).body;
    const renamed = (await agent.patch(`/api/v1/tasks/${t.id}`).send({ title: "Gym session" }).expect(200)).body;
    expect(renamed).toMatchObject({ title: "Gym session", priority: "urgent", tags: ["health"], recurrence: "daily" });
    // What the "Postpone" button sends.
    const postponed = (await agent.patch(`/api/v1/tasks/${t.id}`).send({ snoozedUntil: IST("2026-11-03T00:00:00") }).expect(200)).body;
    expect(postponed).toMatchObject({ priority: "urgent", tags: ["health"], recurrence: "daily" });
  });

  it("does not duplicate the next occurrence when a recurring task is completed, reopened and completed again", async () => {
    const { app } = makeCtx();
    const { agent } = await signUp(app);
    const t = (await agent.post("/api/v1/tasks").send({ title: "Stretch", dueAt: IST("2026-11-02T19:00:00"), recurrence: "daily" }).expect(201)).body;
    const first = (await agent.post(`/api/v1/tasks/${t.id}/complete`).expect(200)).body;
    await agent.post(`/api/v1/tasks/${t.id}/reopen`).expect(200);
    const second = (await agent.post(`/api/v1/tasks/${t.id}/complete`).expect(200)).body;
    expect(second.next.id).toBe(first.next.id);
    const open = (await agent.get("/api/v1/tasks").query({ q: "Stretch" }).expect(200)).body.items;
    expect(open).toHaveLength(1);
  });

  it("rejects dependency cycles of any length", async () => {
    const { app } = makeCtx();
    const { agent } = await signUp(app);
    const a = (await agent.post("/api/v1/tasks").send({ title: "A" }).expect(201)).body;
    const b = (await agent.post("/api/v1/tasks").send({ title: "B", dependsOnTaskId: a.id }).expect(201)).body;
    const c = (await agent.post("/api/v1/tasks").send({ title: "C", dependsOnTaskId: b.id }).expect(201)).body;
    // A → C → B → A
    const res = await agent.patch(`/api/v1/tasks/${a.id}`).send({ dependsOnTaskId: c.id }).expect(400);
    expect(res.body.error.message).toBe("Circular dependency");
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

describe("project progress and deadlines", () => {
  it("reports done/open/overdue counts, the next deadline and the last due date", async () => {
    const { app } = makeCtx(); // now = 2026-11-02 09:00 IST
    const { agent } = await signUp(app);
    const p = (await agent.post("/api/v1/projects").send({ name: "Move house" }).expect(201)).body;
    expect(p).toMatchObject({ openTasks: 0, doneTasks: 0, overdueTasks: 0, nextDue: null, lastDueAt: null });
    const add = (title: string, dueAt?: string) => agent.post("/api/v1/tasks").send({ title, projectId: p.id, ...(dueAt ? { dueAt: IST(dueAt) } : {}) }).expect(201).then((r) => r.body);
    await add("Book movers", "2026-11-01T18:00:00"); // overdue
    await add("Pack kitchen", "2026-11-05T18:00:00");
    await add("Hand over keys", "2026-11-20T10:00:00");
    const done = await add("Give notice");
    await agent.post(`/api/v1/tasks/${done.id}/complete`).expect(200);

    const got = (await agent.get(`/api/v1/projects/${p.id}`).expect(200)).body;
    expect(got).toMatchObject({ openTasks: 3, doneTasks: 1, overdueTasks: 1, lastDueAt: IST("2026-11-20T10:00:00") });
    expect(got.nextDue).toMatchObject({ title: "Pack kitchen", dueAt: IST("2026-11-05T18:00:00") });
    expect((await agent.get("/api/v1/projects").expect(200)).body.items[0]).toEqual(got);
  });
});

describe("outdated plans", () => {
  it("flags an accepted plan when a new meeting lands on planned work or new work is due today, without changing it", async () => {
    const { app } = makeCtx(); // now = 2026-11-02 09:00 IST
    const { agent } = await signUp(app);
    await agent.post("/api/v1/tasks").send({ title: "Write spec", estimateMin: 60, priority: "high", dueAt: IST("2026-11-02T17:00:00") }).expect(201);
    const plan = (await agent.post("/api/v1/plans/generate").send({}).expect(201)).body.plan;
    await agent.post(`/api/v1/plans/${plan.id}/accept`).expect(200);
    expect((await agent.get("/api/v1/plans/current").expect(200)).body.plan.drift).toEqual([]);

    const block = plan.items.find((i: { kind: string }) => i.kind === "task");
    await agent.post("/api/v1/calendar/events").send({ title: "Urgent client call", startAt: block.startAt, endAt: block.endAt }).expect(201);
    await agent.post("/api/v1/tasks").send({ title: "Send invoice", estimateMin: 15, dueAt: IST("2026-11-02T16:00:00") }).expect(201);

    const current = (await agent.get("/api/v1/plans/current").expect(200)).body.plan;
    expect(current.id).toBe(plan.id);
    expect(current.status).toBe("accepted");
    expect(current.items).toEqual(plan.items.map((i: object) => expect.objectContaining(i))); // untouched
    expect(current.drift.join(" ")).toMatch(/"Urgent client call" \(.*\) now overlaps planned "Write spec"/);
    expect(current.drift.join(" ")).toMatch(/"Send invoice" is due today but not in this plan/);
    const recs = (await agent.get("/api/v1/dashboard").expect(200)).body.recommendations;
    expect(recs[0].kind).toBe("plan_outdated");
  });
});

describe("calendar alternatives", () => {
  it("avoids other events on the target's day even when it is more than a few days away", async () => {
    const { app } = makeCtx(); // now = 2026-11-02 09:00 IST
    const { agent } = await signUp(app);
    const target = (await agent.post("/api/v1/calendar/events").send({ title: "Review", startAt: IST("2026-11-12T10:00:00"), endAt: IST("2026-11-12T11:00:00") }).expect(201)).body;
    const blockers = [
      { start: IST("2026-11-12T09:00:00"), end: IST("2026-11-12T10:00:00") },
      { start: IST("2026-11-12T11:00:00"), end: IST("2026-11-12T18:00:00") },
    ];
    for (const b of blockers) await agent.post("/api/v1/calendar/events").send({ title: "Busy", startAt: b.start, endAt: b.end }).expect(201);
    const res = (await agent.get(`/api/v1/calendar/events/${target.id}/alternatives`).expect(200)).body;
    expect(res.suggestions.length).toBeGreaterThan(0);
    for (const s of res.suggestions as { startAt: string; endAt: string }[]) {
      for (const b of blockers) expect(s.startAt < b.end && b.start < s.endAt).toBe(false);
    }
  });
});

describe("projects", () => {
  it("creates, counts open tasks, renames, and deletes without losing tasks", async () => {
    const { app } = makeCtx();
    const { agent } = await signUp(app);
    const other = await signUp(app);
    const p = (await agent.post("/api/v1/projects").send({ name: "Thesis", color: "#4f46e5" }).expect(201)).body;
    expect(p).toMatchObject({ name: "Thesis", color: "#4f46e5", openTasks: 0 });
    await agent.post("/api/v1/projects").send({ name: "Bad colour", color: "blue" }).expect(400);

    const t1 = (await agent.post("/api/v1/tasks").send({ title: "Write chapter 2", projectId: p.id }).expect(201)).body;
    await agent.post("/api/v1/tasks").send({ title: "Fix figures", projectId: p.id }).expect(201);
    await agent.post(`/api/v1/tasks/${t1.id}/complete`).expect(200);
    expect((await agent.get("/api/v1/projects").expect(200)).body.items).toEqual([expect.objectContaining({ id: p.id, openTasks: 1 })]);
    expect((await agent.get("/api/v1/tasks").query({ projectId: p.id }).expect(200)).body.items.map((t: { title: string }) => t.title)).toEqual(["Fix figures"]);

    const renamed = (await agent.patch(`/api/v1/projects/${p.id}`).send({ name: "Thesis 2026" }).expect(200)).body;
    expect(renamed).toMatchObject({ name: "Thesis 2026", color: "#4f46e5", openTasks: 1 });
    await other.agent.patch(`/api/v1/projects/${p.id}`).send({ name: "mine now" }).expect(404);
    await other.agent.post("/api/v1/tasks").send({ title: "x", projectId: p.id }).expect(404);

    // Duplicate names (any case) are refused on create and rename.
    expect((await agent.post("/api/v1/projects").send({ name: "THESIS 2026" }).expect(409)).body.error.code).toBe("project_exists");
    const other2 = (await agent.post("/api/v1/projects").send({ name: "Side project" }).expect(201)).body;
    await agent.patch(`/api/v1/projects/${other2.id}`).send({ name: "thesis 2026" }).expect(409);
    await other.agent.get(`/api/v1/projects/${p.id}`).expect(404);

    await agent.delete(`/api/v1/projects/${p.id}`).expect(204);
    const tasks = (await agent.get("/api/v1/tasks").query({ status: "all" }).expect(200)).body.items;
    expect(tasks).toHaveLength(2);
    expect(tasks.every((t: { projectId: string | null }) => t.projectId === null)).toBe(true);
  });
});
