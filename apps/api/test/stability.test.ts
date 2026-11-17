import supertest from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, makeCtx, resetDb, signUp } from "./helpers.js";

afterAll(closeDb);
beforeEach(resetDb);

const IST = (iso: string) => new Date(`${iso}+05:30`).toISOString();

describe("email delivery failures", () => {
  const failingMailer = (ctx: ReturnType<typeof makeCtx>["ctx"]) => {
    ctx.mailer.send = async () => {
      throw new Error("SMTP connection refused");
    };
  };

  it("still creates the account and signs in when the verification email can't be sent", async () => {
    const { app, ctx } = makeCtx();
    failingMailer(ctx);
    const agent = supertest.agent(app).set("x-lifepilot-csrf", "1");
    const res = await agent.post("/api/v1/auth/register").send({ email: "smtp-down@example.com", password: "correct-horse-battery", name: "S" }).expect(201);
    expect(res.body.verificationSent).toBe(false);
    await agent.get("/api/v1/auth/me").expect(200);
    // Asking again explicitly reports the failure instead of pretending it worked.
    expect((await agent.post("/api/v1/auth/resend-verification").expect(502)).body.error.code).toBe("email_failed");
  });

  it("answers password-reset requests identically whether or not the account exists, even if email fails", async () => {
    const { app, ctx } = makeCtx();
    await signUp(app, "real@example.com");
    failingMailer(ctx);
    const anon = supertest.agent(app).set("x-lifepilot-csrf", "1");
    const real = await anon.post("/api/v1/auth/request-password-reset").send({ email: "real@example.com" });
    const ghost = await anon.post("/api/v1/auth/request-password-reset").send({ email: "ghost@example.com" });
    expect([real.status, ghost.status]).toEqual([200, 200]);
    expect(real.body).toEqual(ghost.body);
  });
});

describe("AI email analysis switch", () => {
  it("never sends email content to the AI provider when the user turns AI analysis off", async () => {
    const { app, ctx } = makeCtx();
    const { agent } = await signUp(app);
    const calls: string[] = [];
    ctx.extractor = {
      name: "openai:spy",
      async extract(email) {
        calls.push(email.subject);
        throw new Error("must not be called");
      },
    };
    await agent.patch("/api/v1/preferences").send({ aiEnabled: false }).expect(200);
    await agent.post("/api/v1/integrations/demo").expect(200);
    expect(calls).toEqual([]);
    const items = (await agent.get("/api/v1/insights").query({ status: "all" }).expect(200)).body.items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i: { extractor: string }) => i.extractor === "mock")).toBe(true);
  });
});

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
