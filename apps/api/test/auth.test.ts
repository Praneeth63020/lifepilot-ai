import supertest from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, makeCtx, resetDb, signUp } from "./helpers.js";

afterAll(closeDb);
beforeEach(resetDb);

describe("authentication", () => {
  it("registers, keeps a session, logs out", async () => {
    const { app } = makeCtx();
    const { agent, user } = await signUp(app, "alice@example.com");
    const me = await agent.get("/api/v1/auth/me").expect(200);
    expect(me.body.user.id).toBe(user.id);
    expect(me.body.user.emailVerified).toBe(false);
    expect(me.body.preferences.timezone).toBe("Asia/Kolkata");
    await agent.post("/api/v1/auth/logout").expect(204);
    await agent.get("/api/v1/auth/me").expect(401);
  });

  it("sets an httpOnly SameSite=Lax cookie and never returns the password hash", async () => {
    const { app } = makeCtx();
    const res = await supertest(app)
      .post("/api/v1/auth/register")
      .set("x-lifepilot-csrf", "1")
      .send({ email: "bob@example.com", password: "correct-horse-battery", name: "Bob" })
      .expect(201);
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toMatch(/lp_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
  });

  it("rejects duplicate emails, weak passwords and bad credentials", async () => {
    const { app } = makeCtx();
    await signUp(app, "carol@example.com");
    const anon = supertest.agent(app).set("x-lifepilot-csrf", "1");
    await anon.post("/api/v1/auth/register").send({ email: "carol@example.com", password: "correct-horse-battery", name: "C" }).expect(409);
    await anon.post("/api/v1/auth/register").send({ email: "d@example.com", password: "short", name: "D" }).expect(400);
    await anon.post("/api/v1/auth/login").send({ email: "carol@example.com", password: "wrong-password-123" }).expect(401);
    await anon.post("/api/v1/auth/login").send({ email: "nobody@example.com", password: "whatever-123" }).expect(401);
    await anon.post("/api/v1/auth/login").send({ email: "carol@example.com", password: "correct-horse-battery" }).expect(200);
  });

  it("requires the CSRF header on state-changing requests", async () => {
    const { app } = makeCtx();
    await supertest(app).post("/api/v1/auth/login").send({ email: "a@b.co", password: "x" }).expect(403);
  });

  it("verifies email and resets password with single-use tokens", async () => {
    const { app, mailer } = makeCtx();
    const { agent } = await signUp(app, "erin@example.com");
    const verifyToken = /token=([\w-]+)/.exec(mailer.outbox.at(-1)!.text)![1];
    await agent.post("/api/v1/auth/verify-email").send({ token: verifyToken }).expect(200);
    await agent.post("/api/v1/auth/verify-email").send({ token: verifyToken }).expect(400);
    expect((await agent.get("/api/v1/auth/me")).body.user.emailVerified).toBe(true);

    const anon = supertest.agent(app).set("x-lifepilot-csrf", "1");
    await anon.post("/api/v1/auth/request-password-reset").send({ email: "erin@example.com" }).expect(200);
    await anon.post("/api/v1/auth/request-password-reset").send({ email: "ghost@example.com" }).expect(200); // no enumeration
    const resetToken = /token=([\w-]+)/.exec(mailer.outbox.at(-1)!.text)![1];
    await anon.post("/api/v1/auth/reset-password").send({ token: resetToken, password: "new-password-456" }).expect(200);
    // Old sessions are revoked after a reset.
    await agent.get("/api/v1/auth/me").expect(401);
    await anon.post("/api/v1/auth/login").send({ email: "erin@example.com", password: "new-password-456" }).expect(200);
    await anon.post("/api/v1/auth/reset-password").send({ token: resetToken, password: "another-pass-789" }).expect(400);
  });
});

describe("user data isolation", () => {
  it("never exposes or mutates another user's resources", async () => {
    const { app } = makeCtx();
    const a = await signUp(app, "a@example.com");
    const b = await signUp(app, "b@example.com");
    const task = (await a.agent.post("/api/v1/tasks").send({ title: "A's secret task", dueAt: "2026-11-03T10:00:00Z" }).expect(201)).body;
    const ev = (
      await a.agent
        .post("/api/v1/calendar/events")
        .send({ title: "A's event", startAt: "2026-11-02T08:00:00Z", endAt: "2026-11-02T09:00:00Z" })
        .expect(201)
    ).body;

    await b.agent.get(`/api/v1/tasks/${task.id}`).expect(404);
    await b.agent.patch(`/api/v1/tasks/${task.id}`).send({ title: "pwned" }).expect(404);
    await b.agent.post(`/api/v1/tasks/${task.id}/complete`).expect(404);
    await b.agent.delete(`/api/v1/tasks/${task.id}`).expect(404);
    await b.agent.get(`/api/v1/calendar/events/${ev.id}`).expect(404);
    await b.agent.post("/api/v1/reminders").send({ taskId: task.id, remindAt: "2026-11-02T12:00:00Z" }).expect(404);
    expect((await b.agent.get("/api/v1/tasks").expect(200)).body.items).toHaveLength(0);
    expect((await b.agent.get("/api/v1/reminders").expect(200)).body.items).toHaveLength(0);
    const evs = await b.agent.get("/api/v1/calendar/events").query({ from: "2026-11-01T00:00:00Z", to: "2026-11-05T00:00:00Z" }).expect(200);
    expect(evs.body.items).toHaveLength(0);

    // A client-supplied userId is ignored.
    const sneaky = await b.agent.post("/api/v1/tasks").send({ title: "x", userId: a.user.id }).expect(201);
    expect((await a.agent.get(`/api/v1/tasks/${sneaky.body.id}`)).status).toBe(404);
    expect((await a.agent.get(`/api/v1/tasks/${task.id}`)).body.title).toBe("A's secret task");
  });
});
