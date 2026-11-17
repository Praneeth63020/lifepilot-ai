import { randomUUID } from "node:crypto";
import supertest from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createProducerRedis } from "@lifepilot/jobs";
import { createApp } from "../src/app.js";
import { closeDb, makeCtx, resetDb, signUp } from "./helpers.js";

// A Redis database no other test uses; each test also gets its own key namespace.
const redis = createProducerRedis("redis://localhost:6379/3");
afterAll(async () => {
  await redis.quit();
  await closeDb();
});
beforeEach(resetDb);

const csrf = { "x-lifepilot-csrf": "1" };
const login = (app: ReturnType<typeof createApp>, email: string, password: string, ip?: string) =>
  supertest(app)
    .post("/api/v1/auth/login")
    .set(csrf)
    .set(ip ? { "x-forwarded-for": ip } : {})
    .send({ email, password });

describe("shared rate limiting", () => {
  it("shares one budget across separate API instances", async () => {
    const h = makeCtx();
    const opts = { redis, rateLimitNamespace: `t-${randomUUID()}`, rateLimits: { auth: 3 } };
    const instanceA = createApp(h.ctx, opts);
    const instanceB = createApp(h.ctx, opts);
    expect((await login(instanceA, "x@example.com", "wrong-password-1")).status).toBe(401);
    expect((await login(instanceB, "x@example.com", "wrong-password-1")).status).toBe(401);
    expect((await login(instanceA, "x@example.com", "wrong-password-1")).status).toBe(401);
    const limited = await login(instanceB, "x@example.com", "wrong-password-1");
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ error: { code: "rate_limited", message: "Too many attempts. Try again in a few minutes." } });
    expect(limited.headers["ratelimit-policy"]).toMatch(/q=3; w=900/);
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("limits failed sign-ins per account across client IPs, without counting successful ones", async () => {
    const h = makeCtx();
    await signUp(h.app, "target@example.com");
    // Behind one trusted proxy, so X-Forwarded-For identifies (simulated) distinct clients.
    const ctx = { ...h.ctx, config: { ...h.ctx.config, trustProxyHops: 1 } };
    const app = createApp(ctx, { redis, rateLimitNamespace: `t-${randomUUID()}`, rateLimits: { loginPerAccount: 3 } });
    // A correct password never uses up the account's budget.
    for (let i = 0; i < 4; i++) expect((await login(app, "target@example.com", "correct-horse-battery", `198.51.100.${i}`)).status).toBe(200);
    for (let i = 0; i < 3; i++) expect((await login(app, "target@example.com", "guess-number-" + i, `203.0.113.${i}`)).status).toBe(401);
    const blocked = await login(app, "TARGET@example.com", "guess-number-4", "203.0.113.99"); // different case, new IP
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.message).toMatch(/failed sign-ins for this account/);
    // Other accounts are unaffected.
    expect((await login(app, "someone-else@example.com", "guess", "203.0.113.100")).status).toBe(401);
    // Email addresses are never stored in Redis keys.
    const keys = await redis.keys(`*`);
    expect(keys.some((k) => k.includes("target@example.com"))).toBe(false);
  });

  it("ignores a spoofed X-Forwarded-For when no proxy is trusted", async () => {
    const h = makeCtx(); // TRUST_PROXY_HOPS = 0 in tests
    const app = createApp(h.ctx, { redis, rateLimitNamespace: `t-${randomUUID()}`, rateLimits: { auth: 2 } });
    expect((await login(app, "a@example.com", "x", "10.0.0.1")).status).not.toBe(429);
    expect((await login(app, "a@example.com", "x", "10.0.0.2")).status).not.toBe(429);
    expect((await login(app, "a@example.com", "x", "10.0.0.3")).status).toBe(429);
  });

  it("limits password-reset emails per address, whether or not the account exists", async () => {
    const h = makeCtx();
    const app = createApp(h.ctx, { redis, rateLimitNamespace: `t-${randomUUID()}`, rateLimits: { resetPerAccount: 2 } });
    const reset = (email: string) => supertest(app).post("/api/v1/auth/request-password-reset").set(csrf).send({ email });
    expect((await reset("victim@example.com")).status).toBe(200);
    expect((await reset("victim@example.com")).status).toBe(200);
    expect((await reset("victim@example.com")).status).toBe(429);
    expect((await reset("other@example.com")).status).toBe(200);
  });

  it("keeps limiting per instance (no 500s, no unlimited access) when Redis is unreachable", async () => {
    const h = makeCtx();
    const deadRedis = createProducerRedis("redis://127.0.0.1:1"); // nothing listens here
    deadRedis.on("error", () => undefined);
    try {
      const app = createApp(h.ctx, { redis: deadRedis, rateLimitNamespace: `t-${randomUUID()}`, rateLimits: { auth: 2 } });
      expect((await login(app, "a@example.com", "wrong-password-1")).status).toBe(401);
      expect((await login(app, "a@example.com", "wrong-password-1")).status).toBe(401);
      expect((await login(app, "a@example.com", "wrong-password-1")).status).toBe(429);
    } finally {
      deadRedis.disconnect();
    }
  });
});
