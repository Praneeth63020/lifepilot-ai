import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { calendarEvents, connectedAccounts, syncJobs, syncedEmails } from "@lifepilot/db";
import { decrypt, encrypt, failInterruptedSyncJobs, runSync, SYNC_JOB_STALE_MS, type FetchLike } from "@lifepilot/core";
import { closeDb, FIXED_NOW, makeCtx, resetDb, signUp } from "./helpers.js";

afterAll(closeDb);
beforeEach(resetDb);

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function gmailMessage(id: string, labelIds: string[], text = "Please review the attached form by Nov 6 at 5 PM.") {
  return {
    id,
    threadId: `t-${id}`,
    labelIds,
    internalDate: String(Date.parse("2026-11-01T10:00:00Z")),
    snippet: "snippet",
    payload: {
      mimeType: "text/plain",
      headers: [{ name: "Subject", value: `Subject ${id}` }, { name: "From", value: "Sender <s@example.com>" }],
      body: { data: Buffer.from(text).toString("base64url") },
    },
  };
}

/**
 * Fake Google with per-test behaviour. `route` returns a Response for a URL or undefined to fall
 * through to the defaults. Every call is recorded; nothing touches the network.
 */
function fakeGoogle(route: (url: string, call: number) => Response | undefined = () => undefined) {
  const calls: string[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    calls.push(url);
    const custom = route(url, calls.length);
    if (custom) return custom;
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      const p = new URLSearchParams(String(init?.body));
      if (p.get("grant_type") === "refresh_token") return json({ access_token: "refreshed-access", expires_in: 3600, token_type: "Bearer" });
    }
    if (url.includes("/gmail/v1/users/me/profile")) return json({ emailAddress: "test.account@gmail.com", historyId: "500" });
    return json({ error: "unexpected " + url }, 500);
  };
  return { fetchFn, calls };
}

async function googleAccount(ctx: ReturnType<typeof makeCtx>["ctx"], userId: string, product: "gmail" | "calendar", extra: Partial<typeof connectedAccounts.$inferInsert> = {}) {
  const [acct] = await ctx.db
    .insert(connectedAccounts)
    .values({
      userId,
      provider: "google",
      product,
      status: "active",
      accessTokenEnc: encrypt("current-access", ctx.config.encryptionKey),
      refreshTokenEnc: encrypt("good-refresh", ctx.config.encryptionKey),
      // Not expired: the cached access token is used first.
      tokenExpiresAt: new Date(FIXED_NOW.getTime() + 3_600_000),
      ...extra,
    })
    .returning();
  return acct!;
}

describe("Gmail sync", () => {
  it("never imports the user's own sent mail or drafts (full and incremental sync)", async () => {
    const msgs: Record<string, ReturnType<typeof gmailMessage>> = {
      in1: gmailMessage("in1", ["INBOX"]),
      sent1: gmailMessage("sent1", ["SENT"]),
      draft1: gmailMessage("draft1", ["DRAFT"]),
      in2: gmailMessage("in2", ["INBOX"]),
      sent2: gmailMessage("sent2", ["SENT"]),
    };
    const g = fakeGoogle((url) => {
      if (url.includes("/messages?")) return json({ messages: [{ id: "in1" }, { id: "sent1" }, { id: "draft1" }] });
      if (url.includes("/history?"))
        return json({ historyId: "501", history: [{ messagesAdded: [{ message: { id: "in2", labelIds: ["INBOX"] } }, { message: { id: "sent2", labelIds: ["SENT"] } }] }] });
      const id = /messages\/(\w+)\?/.exec(url)?.[1];
      if (id && msgs[id]) return json(msgs[id]);
      return undefined;
    });
    const { app, ctx } = makeCtx({ google: true, fetch: g.fetchFn });
    const { user } = await signUp(app);
    const acct = await googleAccount(ctx, user.id, "gmail");

    expect((await runSync(ctx, acct.id)).items).toBe(1);
    const listCall = g.calls.find((u) => u.includes("/messages?"))!;
    expect(new URL(listCall).searchParams.get("q")).toMatch(/-in:sent -in:drafts/);
    expect((await runSync(ctx, acct.id)).items).toBe(1); // incremental: in2 only
    const stored = (await ctx.db.select({ id: syncedEmails.providerMessageId }).from(syncedEmails)).map((r) => r.id).sort();
    expect(stored).toEqual(["in1", "in2"]);
    expect(g.calls.some((u) => u.includes("/messages/sent2"))).toBe(false); // filtered before downloading
  });

  it("falls back to a full sync when the stored history id has expired", async () => {
    const g = fakeGoogle((url) => {
      if (url.includes("/history?")) return json({ error: { code: 404, message: "Requested entity was not found." } }, 404);
      if (url.includes("/messages?")) return json({ messages: [{ id: "in1" }] });
      if (url.includes("/messages/in1")) return json(gmailMessage("in1", ["INBOX"]));
      return undefined;
    });
    const h = makeCtx({ google: true, fetch: g.fetchFn });
    const { user } = await signUp(h.app);
    const acct = await googleAccount(h.ctx, user.id, "gmail", { syncCursor: "1" });
    const out = await runSync(h.ctx, acct.id);
    expect(out).toMatchObject({ status: "succeeded", items: 1 });
    expect((await h.ctx.db.query.connectedAccounts.findFirst({ where: eq(connectedAccounts.id, acct.id) }))!.syncCursor).toBe("500");
  });

  it("refreshes once and retries when Google rejects a not-yet-expired access token", async () => {
    const g = fakeGoogle((url) => {
      if (url.includes("/gmail/")) {
        // The old token is rejected; anything after the refresh works.
        if (!g.calls.some((u) => u.startsWith("https://oauth2.googleapis.com/token"))) return json({ error: { code: 401 } }, 401);
        if (url.includes("/messages?")) return json({ messages: [] });
      }
      return undefined;
    });
    const h = makeCtx({ google: true, fetch: g.fetchFn });
    const { user } = await signUp(h.app);
    const acct = await googleAccount(h.ctx, user.id, "gmail");
    expect((await runSync(h.ctx, acct.id)).status).toBe("succeeded");
    const after = (await h.ctx.db.query.connectedAccounts.findFirst({ where: eq(connectedAccounts.id, acct.id) }))!;
    expect(after.status).toBe("active");
    expect(decrypt(after.accessTokenEnc!, h.ctx.config.encryptionKey)).toBe("refreshed-access");
  });

  it("marks the account revoked when the refreshed token is rejected too", async () => {
    const g = fakeGoogle((url) => (url.includes("/gmail/") ? json({ error: { code: 401 } }, 401) : undefined));
    const h = makeCtx({ google: true, fetch: g.fetchFn });
    const { user } = await signUp(h.app);
    const acct = await googleAccount(h.ctx, user.id, "gmail");
    h.jobs.recurring.add(acct.id);
    expect((await runSync(h.ctx, acct.id)).status).toBe("failed");
    const after = (await h.ctx.db.query.connectedAccounts.findFirst({ where: eq(connectedAccounts.id, acct.id) }))!;
    expect(after.status).toBe("revoked");
    expect(after.lastSyncError).toMatch(/reconnect/);
    expect(h.jobs.recurring.has(acct.id)).toBe(false);
    expect(g.calls.filter((u) => u.startsWith("https://oauth2.googleapis.com/token"))).toHaveLength(1); // exactly one refresh
  });

  it("retries a rate-limited request instead of failing the sync", async () => {
    let limited = false;
    const g = fakeGoogle((url) => {
      if (url.includes("/messages?")) {
        if (!limited) {
          limited = true;
          return json({ error: { code: 429 } }, 429, { "retry-after": "0" });
        }
        return json({ messages: [] });
      }
      return undefined;
    });
    const h = makeCtx({ google: true, fetch: g.fetchFn });
    const { user } = await signUp(h.app);
    const acct = await googleAccount(h.ctx, user.id, "gmail");
    expect((await runSync(h.ctx, acct.id)).status).toBe("succeeded");
    expect(g.calls.filter((u) => u.includes("/messages?"))).toHaveLength(2);
  });
});

describe("Google Calendar sync", () => {
  const ev = (id: string, startIso: string, endIso: string, extra: Record<string, unknown> = {}) => ({
    id,
    status: "confirmed",
    summary: `Event ${id}`,
    start: { dateTime: startIso },
    end: { dateTime: endIso },
    ...extra,
  });

  it("follows pagination, is idempotent, removes deleted events, and keeps recurring instances", async () => {
    let round = 1;
    const g = fakeGoogle((url) => {
      if (!url.includes("/calendars/primary/events")) return undefined;
      const page = new URL(url).searchParams.get("pageToken");
      if (round === 1) {
        if (!page)
          return json({
            timeZone: "Asia/Kolkata",
            nextPageToken: "p2",
            items: [ev("a", "2026-11-03T10:00:00+05:30", "2026-11-03T11:00:00+05:30"), ev("r_1", "2026-11-04T09:00:00+05:30", "2026-11-04T09:30:00+05:30", { recurringEventId: "r" })],
          });
        return json({ items: [{ id: "all", status: "confirmed", summary: "Holiday", start: { date: "2026-11-05" }, end: { date: "2026-11-06" } }] });
      }
      // Round 2: "a" was deleted in Google; one recurring instance was cancelled.
      return json({
        timeZone: "Asia/Kolkata",
        items: [ev("r_1", "2026-11-04T09:00:00+05:30", "2026-11-04T09:30:00+05:30", { recurringEventId: "r", status: "cancelled" }), { id: "all", status: "confirmed", summary: "Holiday", start: { date: "2026-11-05" }, end: { date: "2026-11-06" } }],
      });
    });
    const h = makeCtx({ google: true, fetch: g.fetchFn });
    const { user } = await signUp(h.app);
    const acct = await googleAccount(h.ctx, user.id, "calendar");

    expect((await runSync(h.ctx, acct.id)).items).toBe(3);
    expect((await runSync(h.ctx, acct.id)).items).toBe(3); // same window again: upserts, no duplicates
    expect(await h.ctx.db.select().from(calendarEvents)).toHaveLength(3);
    const allDay = await h.ctx.db.query.calendarEvents.findFirst({ where: eq(calendarEvents.providerEventId, "all") });
    expect(allDay!.allDay).toBe(true);
    expect(allDay!.startAt.toISOString()).toBe("2026-11-04T18:30:00.000Z"); // local midnight in Asia/Kolkata

    round = 2;
    await runSync(h.ctx, acct.id);
    const ids = (await h.ctx.db.select({ id: calendarEvents.providerEventId }).from(calendarEvents)).map((r) => r.id);
    expect(ids).toEqual(["all"]);
  });

  it("does not delete events it could not fetch when the window exceeds the fetch limit", async () => {
    let round = 1;
    const g = fakeGoogle((url) => {
      if (!url.includes("/calendars/primary/events")) return undefined;
      if (round === 1) return json({ items: [ev("keep", "2026-11-03T10:00:00Z", "2026-11-03T11:00:00Z")] });
      // 2500 events with more pages left: "keep" is beyond the limit, not deleted.
      const items = Array.from({ length: 250 }, (_, i) => ev(`bulk${new URL(url).searchParams.get("pageToken") ?? "0"}_${i}`, "2026-11-04T10:00:00Z", "2026-11-04T10:30:00Z"));
      return json({ items, nextPageToken: "more" + Math.random() });
    });
    const h = makeCtx({ google: true, fetch: g.fetchFn });
    const { user } = await signUp(h.app);
    const acct = await googleAccount(h.ctx, user.id, "calendar");
    await runSync(h.ctx, acct.id);
    round = 2;
    await runSync(h.ctx, acct.id);
    expect(await h.ctx.db.query.calendarEvents.findFirst({ where: eq(calendarEvents.providerEventId, "keep") })).toBeDefined();
  });
});

describe("sync job visibility", () => {
  it("marks sync jobs interrupted by a worker crash as failed, leaving recent ones alone", async () => {
    const h = makeCtx({ google: true });
    const { user } = await signUp(h.app);
    const acct = await googleAccount(h.ctx, user.id, "gmail");
    const old = new Date(FIXED_NOW.getTime() - SYNC_JOB_STALE_MS - 60_000);
    await h.ctx.db.insert(syncJobs).values([
      { userId: user.id, accountId: acct.id, product: "gmail", status: "running", startedAt: old },
      { userId: user.id, accountId: acct.id, product: "gmail", status: "running", startedAt: FIXED_NOW },
    ]);
    expect(await failInterruptedSyncJobs(h.ctx)).toBe(1);
    const rows = await h.ctx.db.select().from(syncJobs);
    expect(rows.map((r) => r.status).sort()).toEqual(["failed", "running"]);
    expect(rows.find((r) => r.status === "failed")!.error).toMatch(/Interrupted/);
  });
});
