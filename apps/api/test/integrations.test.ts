import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { connectedAccounts, syncedEmails } from "@lifepilot/db";
import { encrypt, runSync, type FetchLike } from "@lifepilot/core";
import { closeDb, makeCtx, resetDb, signUp } from "./helpers.js";

afterAll(closeDb);
beforeEach(resetDb);

/** Fake Google endpoints. Records every call; never touches the network. */
function fakeGoogle(opts: { refresh?: "ok" | "invalid_grant" } = {}) {
  const calls: { url: string; body?: string }[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      const p = new URLSearchParams(String(init?.body));
      if (p.get("grant_type") === "refresh_token") {
        return opts.refresh === "invalid_grant" ? json({ error: "invalid_grant" }, 400) : json({ access_token: "fresh-access", expires_in: 3600, token_type: "Bearer" });
      }
      return json({
        access_token: "access-123",
        refresh_token: "refresh-456",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "https://www.googleapis.com/auth/gmail.readonly",
      });
    }
    if (url.startsWith("https://oauth2.googleapis.com/revoke")) return new Response("", { status: 200 });
    if (url.includes("/gmail/v1/users/me/profile")) return json({ emailAddress: "real.user@gmail.com", historyId: "1000" });
    if (url.includes("/gmail/v1/users/me/messages?")) return json({ messages: [{ id: "m1" }, { id: "m2" }] });
    if (url.includes("/gmail/v1/users/me/history?")) {
      // Incremental sync: m2 is reported again (must be deduplicated) plus a promo that's filtered out.
      return json({ historyId: "1001", history: [{ messagesAdded: [{ message: { id: "m2" } }, { message: { id: "p1", labelIds: ["CATEGORY_PROMOTIONS"] } }] }] });
    }
    if (url.includes("/gmail/v1/users/me/messages/")) {
      const id = url.includes("/m1") ? "m1" : "m2";
      const body = Buffer.from(id === "m1" ? "Please submit the form by Nov 6 at 5 PM." : "Thanks for your order.").toString("base64url");
      return json({
        id,
        threadId: `t-${id}`,
        internalDate: String(Date.parse("2026-11-01T10:00:00Z")),
        snippet: "snippet",
        payload: { mimeType: "text/plain", headers: [{ name: "Subject", value: `Subject ${id}` }, { name: "From", value: "Sender <s@example.com>" }], body: { data: body } },
      });
    }
    return json({ error: "unexpected " + url }, 500);
  };
  return { fetchFn, calls };
}

describe("Google OAuth (with fake Google endpoints)", () => {
  it("is unavailable with a clear message when credentials are not configured", async () => {
    const { app } = makeCtx({ google: false });
    const { agent } = await signUp(app);
    const res = await agent.post("/api/v1/integrations/gmail/connect").expect(503);
    expect(res.body.error.code).toBe("integration_unavailable");
    const list = (await agent.get("/api/v1/integrations")).body.items;
    expect(list[0]).toMatchObject({ product: "gmail", status: "not_connected", available: false });
  });

  it("builds a PKCE authorization URL with minimum scopes and offline access", async () => {
    const { app } = makeCtx({ google: true });
    const { agent } = await signUp(app);
    const { url } = (await agent.post("/api/v1/integrations/gmail/connect").expect(200)).body;
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/gmail.readonly");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("state")).toMatch(/^[\w-]{40,}$/);
  });

  it("validates state: unknown, other user's, reused and denied callbacks all fail safely", async () => {
    const g = fakeGoogle();
    const { app, ctx, jobs } = makeCtx({ google: true, fetch: g.fetchFn });
    const a = await signUp(app);
    const b = await signUp(app);
    const state = new URL((await a.agent.post("/api/v1/integrations/gmail/connect")).body.url).searchParams.get("state")!;

    const unknown = await a.agent.get("/api/v1/integrations/google/callback").query({ state: "nope".repeat(12), code: "c" }).expect(303);
    expect(decodeURIComponent(String(unknown.headers.location))).toMatch(/invalid, expired/);

    // State bound to A is rejected (and burned) when presented by B's session.
    const cross = await b.agent.get("/api/v1/integrations/google/callback").query({ state, code: "c" }).expect(303);
    expect(decodeURIComponent(String(cross.headers.location))).toMatch(/different session/);
    const reused = await a.agent.get("/api/v1/integrations/google/callback").query({ state, code: "c" }).expect(303);
    expect(decodeURIComponent(String(reused.headers.location))).toMatch(/already used/);

    const state2 = new URL((await a.agent.post("/api/v1/integrations/gmail/connect")).body.url).searchParams.get("state")!;
    const denied = await a.agent.get("/api/v1/integrations/google/callback").query({ state: state2, error: "access_denied" }).expect(303);
    expect(decodeURIComponent(String(denied.headers.location))).toMatch(/not granted/);

    expect(g.calls.filter((c) => c.url.includes("/token"))).toHaveLength(0);
    expect(jobs.syncs).toHaveLength(0);
    expect(await ctx.db.select().from(connectedAccounts)).toHaveLength(0);
  });

  it("exchanges the code server-side with the verifier and stores tokens encrypted", async () => {
    const g = fakeGoogle();
    const { app, ctx, jobs } = makeCtx({ google: true, fetch: g.fetchFn });
    const { agent } = await signUp(app);
    const state = new URL((await agent.post("/api/v1/integrations/gmail/connect")).body.url).searchParams.get("state")!;
    const ok = await agent.get("/api/v1/integrations/google/callback").query({ state, code: "auth-code" }).expect(303);
    expect(ok.headers.location).toBe("http://localhost:5173/settings/connections?connected=gmail");

    const tokenCall = g.calls.find((c) => c.url.includes("/token"))!;
    const p = new URLSearchParams(tokenCall.body);
    expect(p.get("code")).toBe("auth-code");
    expect(p.get("code_verifier")).toMatch(/^[\w-]{60,}$/);
    const [acct] = await ctx.db.select().from(connectedAccounts);
    expect(acct!.provider).toBe("google");
    expect(acct!.externalEmail).toBe("real.user@gmail.com");
    expect(acct!.accessTokenEnc).not.toContain("access-123");
    expect(acct!.refreshTokenEnc).not.toContain("refresh-456");
    expect(jobs.syncs).toEqual([{ accountId: acct!.id, reason: "initial" }]);
    expect(jobs.recurring.has(acct!.id)).toBe(true);

    // First sync: fetches recent messages, dedups on re-run.
    expect((await runSync(ctx, acct!.id)).items).toBe(2);
    const msgFetches = () => g.calls.filter((c) => /messages\/m\d/.test(c.url)).length;
    const n = msgFetches();
    const second = await runSync(ctx, acct!.id);
    expect(second.items).toBe(0);
    expect(msgFetches()).toBe(n); // no message re-downloaded
    expect(g.calls.some((c) => c.url.includes("startHistoryId=1000"))).toBe(true);
    expect((await ctx.db.query.connectedAccounts.findFirst({ where: eq(connectedAccounts.id, acct!.id) }))!.syncCursor).toBe("1001");
    const list = (await agent.get("/api/v1/insights").query({ status: "all" })).body.items;
    expect(list.find((i: { email: { subject: string } }) => i.email.subject === "Subject m1").deadlineCertainty).toBe("explicit");
  });

  it("marks the account revoked when Google rejects the refresh token, and stops syncing", async () => {
    const g = fakeGoogle({ refresh: "invalid_grant" });
    const { app, ctx, jobs } = makeCtx({ google: true, fetch: g.fetchFn });
    const { user } = await signUp(app);
    const [acct] = await ctx.db
      .insert(connectedAccounts)
      .values({
        userId: user.id,
        provider: "google",
        product: "gmail",
        status: "active",
        accessTokenEnc: encrypt("expired", ctx.config.encryptionKey),
        refreshTokenEnc: encrypt("dead-refresh", ctx.config.encryptionKey),
        tokenExpiresAt: new Date(Date.parse("2026-01-01")),
      })
      .returning();
    jobs.recurring.add(acct!.id);
    const out = await runSync(ctx, acct!.id);
    expect(out.status).toBe("failed");
    const after = await ctx.db.query.connectedAccounts.findFirst({ where: eq(connectedAccounts.id, acct!.id) });
    expect(after!.status).toBe("revoked");
    expect(after!.refreshTokenEnc).toBeNull();
    expect(after!.lastSyncError).toMatch(/reconnect/);
    expect(jobs.recurring.has(acct!.id)).toBe(false);
  });
});

describe("disconnecting", () => {
  it("stops scheduled sync, skips queued jobs, and deletes imported data on request", async () => {
    const g = fakeGoogle();
    const { app, ctx, jobs } = makeCtx({ google: true, fetch: g.fetchFn });
    const { agent } = await signUp(app);
    const state = new URL((await agent.post("/api/v1/integrations/gmail/connect")).body.url).searchParams.get("state")!;
    await agent.get("/api/v1/integrations/google/callback").query({ state, code: "c" });
    const [acct] = await ctx.db.select().from(connectedAccounts);
    await runSync(ctx, acct!.id);
    expect((await ctx.db.select().from(syncedEmails)).length).toBe(2);

    await agent.delete("/api/v1/integrations/gmail").expect(200);
    expect(jobs.recurring.has(acct!.id)).toBe(false);
    expect(g.calls.some((c) => c.url.startsWith("https://oauth2.googleapis.com/revoke"))).toBe(true);
    const disc = await ctx.db.query.connectedAccounts.findFirst({ where: eq(connectedAccounts.id, acct!.id) });
    expect(disc!.status).toBe("disconnected");
    expect(disc!.accessTokenEnc).toBeNull();
    // A sync job that was already queued becomes a no-op.
    const before = g.calls.length;
    expect((await runSync(ctx, acct!.id)).status).toBe("skipped");
    expect(g.calls.length).toBe(before);
    await agent.post("/api/v1/integrations/gmail/sync").expect(409);

    await agent.delete("/api/v1/integrations/gmail").query({ deleteData: "true" }).expect(200);
    expect(await ctx.db.select().from(syncedEmails)).toHaveLength(0);
    expect(await ctx.db.select().from(connectedAccounts)).toHaveLength(0);
  });
});
