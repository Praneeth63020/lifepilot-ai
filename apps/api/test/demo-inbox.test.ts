import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { connectedAccounts, emailInsights, syncedEmails } from "@lifepilot/db";
import { runSync } from "@lifepilot/core";
import { closeDb, makeCtx, resetDb, signUp } from "./helpers.js";

afterAll(closeDb);
beforeEach(resetDb);

type Insight = {
  id: string;
  email: { subject: string; source: string };
  category: string;
  deadlineAt: string | null;
  deadlineCertainty: string;
  suspicious: boolean;
  whyItMatters: string;
  confidence: number;
  proposedEstimateMin: number | null;
  status: string;
};

async function setup() {
  const h = makeCtx();
  const s = await signUp(h.app);
  const loaded = await s.agent.post("/api/v1/integrations/demo").expect(200);
  const list = (await s.agent.get("/api/v1/insights").query({ status: "all" }).expect(200)).body.items as Insight[];
  const find = (subject: string) => list.find((i) => i.email.subject.startsWith(subject))!;
  return { ...h, ...s, loaded: loaded.body, list, find };
}

describe("demo mode inbox (anticipation engine)", () => {
  it("labels demo connections as demo, never as Google", async () => {
    const { loaded, list } = await setup();
    expect(loaded.items.map((c: { provider: string; status: string }) => [c.provider, c.status])).toEqual([
      ["demo", "active"],
      ["demo", "active"],
    ]);
    expect(list.every((i) => i.email.source === "demo")).toBe(true);
  });

  it("extracts an explicit deadline and estimate, and turns it into a task only on approval", async () => {
    const { agent, find } = await setup();
    const a = find("Assignment 3");
    expect(a.deadlineCertainty).toBe("explicit");
    expect(a.deadlineAt).toBe(new Date("2026-11-05T23:59:00+05:30").toISOString());
    expect(a.proposedEstimateMin).toBe(240);
    const before = (await agent.get("/api/v1/tasks").query({ q: "Assignment" })).body.items;
    expect(before).toHaveLength(0);

    const res = await agent.post(`/api/v1/insights/${a.id}/task`).send({}).expect(201);
    expect(res.body.task.dueAt).toBe(a.deadlineAt);
    expect(res.body.task.sourceType).toBe("email");
    // Idempotent: approving twice returns the same task.
    const again = await agent.post(`/api/v1/insights/${a.id}/task`).send({}).expect(200);
    expect(again.body.task.id).toBe(res.body.task.id);
  });

  it("requires clarification for ambiguous deadlines instead of guessing", async () => {
    const { agent, find } = await setup();
    const q4 = find("Q4 report");
    expect(q4.deadlineCertainty).toBe("ambiguous");
    expect(q4.deadlineAt).toBeNull();
    const r = await agent.post(`/api/v1/insights/${q4.id}/task`).send({}).expect(422);
    expect(r.body.error.code).toBe("clarification_required");
    const ok = await agent.post(`/api/v1/insights/${q4.id}/task`).send({ dueAt: new Date("2026-11-04T12:00:00+05:30").toISOString() }).expect(201);
    expect(ok.body.task.dueAt).toBe(new Date("2026-11-04T12:00:00+05:30").toISOString());
  });

  it("flags prompt-injection emails and takes no action", async () => {
    const { agent, find, ctx } = await setup();
    const evil = find("Action needed");
    expect(evil.suspicious).toBe(true);
    expect(evil.confidence).toBeLessThanOrEqual(0.35);
    expect(evil.status).toBe("new");
    // Nothing was forwarded/created: only the demo seed tasks exist, none from email.
    const tasks = (await agent.get("/api/v1/tasks").query({ status: "all" })).body.items as { sourceType: string }[];
    expect(tasks.filter((t) => t.sourceType === "email")).toHaveLength(0);
    // Data minimisation: excerpt is bounded.
    const rows = await ctx.db.select().from(syncedEmails);
    expect(rows.every((r) => r.bodyExcerpt.length <= 4000)).toBe(true);
  });

  it("puts marketing in low priority, already reviewed", async () => {
    const { find } = await setup();
    const promo = find("URGENT!!!");
    expect(promo.category).toBe("low_priority");
    expect(promo.status).toBe("reviewed");
  });

  it("lets the user correct the category and dismiss", async () => {
    const { agent, find } = await setup();
    const flight = find("Booking confirmed");
    const patched = await agent.patch(`/api/v1/insights/${flight.id}`).send({ userCategory: "requires_action", status: "reviewed" }).expect(200);
    expect(patched.body.category).toBe("requires_action");
    expect(patched.body.aiCategory).toBe("travel");
  });

  it("re-sync is idempotent, and a thread follow-up surfaces a deadline change without applying it", async () => {
    const { ctx, agent, find, user } = await setup();
    const acct = (await ctx.db.query.connectedAccounts.findMany({ where: eq(connectedAccounts.userId, user.id) })).find((a) => a.product === "gmail")!;
    const before = (await ctx.db.select().from(emailInsights)).length;
    await runSync(ctx, acct.id);
    expect((await ctx.db.select().from(emailInsights)).length).toBe(before);

    const a = find("Assignment 3");
    const task = (await agent.post(`/api/v1/insights/${a.id}/task`).send({}).expect(201)).body.task;
    const r = await runSync(ctx, acct.id);
    expect(r.items).toBe(1);
    const list = (await agent.get("/api/v1/insights").query({ status: "all" })).body.items as Insight[];
    const followUp = list.find((i) => i.email.subject.startsWith("Re: Assignment 3"))!;
    expect(followUp.whyItMatters).toMatch(/Possible deadline change/);
    // The task itself is unchanged until the user acts.
    expect((await agent.get(`/api/v1/tasks/${task.id}`)).body.dueAt).toBe(a.deadlineAt);
  });
});

describe("calendar conflicts", () => {
  it("detects the overlapping demo events and proposes alternatives without moving anything", async () => {
    const { agent } = await setup();
    const res = await agent.get("/api/v1/calendar/conflicts").query({ from: "2026-11-02T00:00:00Z", to: "2026-11-05T00:00:00Z" }).expect(200);
    expect(res.body.items).toHaveLength(1);
    const c = res.body.items[0];
    expect([c.a.title, c.b.title].sort()).toEqual(["Dentist appointment", "Project sync"]);
    expect(c.overlapMinutes).toBe(30);
    const alt = await agent.get(`/api/v1/calendar/events/${c.b.id}/alternatives`).expect(200);
    expect(alt.body.suggestions.length).toBeGreaterThan(0);
    expect(alt.body.note).toMatch(/won't change it/);
    // Imported events are read-only.
    await agent.patch(`/api/v1/calendar/events/${c.b.id}`).send({ startAt: alt.body.suggestions[0].startAt, endAt: alt.body.suggestions[0].endAt }).expect(403);
    await agent.patch(`/api/v1/calendar/events/${c.b.id}`).send({ needsPrep: true }).expect(200);
  });
});
