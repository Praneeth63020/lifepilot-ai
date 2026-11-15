import supertest from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, makeCtx, resetDb, signUp } from "./helpers.js";

afterAll(closeDb);
beforeEach(resetDb);

const IST = (iso: string) => new Date(`${iso}+05:30`).toISOString();

describe("edge cases", () => {
  it("reports simultaneous sign-ups with the same email as 409, never 500", async () => {
    const { app } = makeCtx();
    const register = () =>
      supertest(app)
        .post("/api/v1/auth/register")
        .set("x-lifepilot-csrf", "1")
        .send({ email: "race@example.com", password: "correct-horse-battery", name: "Race" });
    const statuses = (await Promise.all([register(), register(), register()])).map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409]);
  });

  it("gives reminders the same title when listing, creating and snoozing", async () => {
    const { app } = makeCtx();
    const { agent } = await signUp(app);
    const task = (await agent.post("/api/v1/tasks").send({ title: "Call the bank" }).expect(201)).body;
    const created = (await agent.post("/api/v1/reminders").send({ taskId: task.id, remindAt: IST("2026-11-02T15:00:00") }).expect(201)).body;
    expect(created.title).toBe("Call the bank");
    const snoozed = (await agent.post(`/api/v1/reminders/${created.id}/snooze`).send({ minutes: 30 }).expect(200)).body;
    expect(snoozed.title).toBe("Call the bank");
    const listed = (await agent.get("/api/v1/reminders").expect(200)).body.items.find((r: { id: string }) => r.id === created.id);
    expect(listed.title).toBe("Call the bank");
  });

  it("cancelling a reminder is idempotent for the owner and 404 for anyone else", async () => {
    const { app } = makeCtx();
    const a = await signUp(app);
    const b = await signUp(app);
    const r = (await a.agent.post("/api/v1/reminders").send({ note: "Stretch", remindAt: IST("2026-11-02T15:00:00") }).expect(201)).body;
    await b.agent.delete(`/api/v1/reminders/${r.id}`).expect(404);
    await a.agent.delete(`/api/v1/reminders/${r.id}`).expect(204);
    await a.agent.delete(`/api/v1/reminders/${r.id}`).expect(204);
  });
});
