import { and, eq, gt, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { calendarEvents, connectedAccounts, oauthStates, syncJobs, syncedEmails } from "@lifepilot/db";
import { AppError, badRequest, type CoreContext } from "../context.js";
import { decrypt, encrypt, pkceChallenge, randomToken, sha256 } from "../crypto.js";
import {
  GoogleAuthRevokedError,
  buildAuthUrl,
  exchangeCode,
  refreshAccessToken,
  revokeToken,
} from "../google/client.js";
import { getMessage, getProfile, listAddedSince, listRecentMessageIds, parseGmailMessage } from "../google/gmail.js";
import { getPrimaryCalendar, listEvents, mapGoogleEvent } from "../google/calendar.js";
import { processEmails } from "./insights.js";
import { getPrefs } from "./prefs.js";
import { syncDemoCalendar, syncDemoGmail } from "./demo.js";
import { syncEventReminder } from "./reminders.js";
import { audit } from "./audit.js";

export type Product = "gmail" | "calendar";
type Account = typeof connectedAccounts.$inferSelect;

const STATE_TTL_MS = 10 * 60_000;

function requireGoogle(ctx: CoreContext) {
  if (!ctx.config.google) {
    throw new AppError(503, "integration_unavailable", "Google integration is not configured on this server (set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI).");
  }
  return ctx.config.google;
}

export async function startGoogleConnect(ctx: CoreContext, userId: string, product: Product): Promise<{ url: string }> {
  const google = requireGoogle(ctx);
  const state = randomToken(32);
  const verifier = randomToken(48);
  await ctx.db.insert(oauthStates).values({
    stateHash: sha256(state),
    userId,
    product,
    codeVerifierEnc: encrypt(verifier, ctx.config.encryptionKey),
    expiresAt: new Date(ctx.now().getTime() + STATE_TTL_MS),
  });
  return { url: buildAuthUrl(google, { state, codeChallenge: pkceChallenge(verifier), scopes: google.scopes[product] }) };
}

/**
 * Validates state (exists, unexpired, single-use, bound to the signed-in user), exchanges the code
 * server-side with the PKCE verifier, and stores encrypted tokens.
 */
export async function handleGoogleCallback(
  ctx: CoreContext,
  userId: string,
  params: { state?: string; code?: string; error?: string },
): Promise<{ product: Product }> {
  const google = requireGoogle(ctx);
  if (!params.state) throw badRequest("Missing OAuth state");
  // Atomic single use: only one request can flip used_at.
  const [st] = await ctx.db
    .update(oauthStates)
    .set({ usedAt: ctx.now() })
    .where(and(eq(oauthStates.stateHash, sha256(params.state)), isNull(oauthStates.usedAt), gt(oauthStates.expiresAt, ctx.now())))
    .returning();
  if (!st) throw new AppError(400, "invalid_state", "This sign-in link is invalid, expired, or was already used. Please try connecting again.");
  if (st.userId !== userId) throw new AppError(400, "invalid_state", "This sign-in link belongs to a different session.");
  const product = st.product;
  if (params.error) {
    throw new AppError(400, "oauth_denied", params.error === "access_denied" ? "Google access was not granted." : `Google returned an error: ${params.error}`);
  }
  if (!params.code) throw badRequest("Missing authorization code");

  const verifier = decrypt(st.codeVerifierEnc, ctx.config.encryptionKey);
  const tokens = await exchangeCode(ctx.fetch, google, params.code, verifier);
  const granted = (tokens.scope ?? "").split(/\s+/);
  const missing = google.scopes[product].filter((s) => !granted.includes(s));
  if (missing.length) {
    await revokeToken(ctx.fetch, tokens.access_token).catch(() => false);
    throw new AppError(400, "scope_missing", `Required permission was not granted: ${missing.join(", ")}`);
  }
  let externalEmail: string | null = null;
  if (product === "gmail") externalEmail = (await getProfile(ctx.fetch, tokens.access_token)).emailAddress;
  else externalEmail = (await getPrimaryCalendar(ctx.fetch, tokens.access_token)).id;

  const existing = await ctx.db.query.connectedAccounts.findFirst({
    where: and(eq(connectedAccounts.userId, userId), eq(connectedAccounts.provider, "google"), eq(connectedAccounts.product, product)),
  });
  const values = {
    userId,
    provider: "google" as const,
    product,
    externalEmail,
    scopes: granted.join(" "),
    accessTokenEnc: encrypt(tokens.access_token, ctx.config.encryptionKey),
    refreshTokenEnc: tokens.refresh_token ? encrypt(tokens.refresh_token, ctx.config.encryptionKey) : (existing?.refreshTokenEnc ?? null),
    tokenExpiresAt: new Date(ctx.now().getTime() + tokens.expires_in * 1000),
    status: "active" as const,
    lastSyncError: null,
  };
  const [acct] = await ctx.db
    .insert(connectedAccounts)
    .values(values)
    .onConflictDoUpdate({ target: [connectedAccounts.userId, connectedAccounts.provider, connectedAccounts.product], set: values })
    .returning();
  // A demo connection for the same product is retired so data sources never mix silently.
  await ctx.db
    .update(connectedAccounts)
    .set({ status: "disconnected" })
    .where(and(eq(connectedAccounts.userId, userId), eq(connectedAccounts.provider, "demo"), eq(connectedAccounts.product, product)));
  await ctx.jobs.enqueueSync(acct!.id, "initial");
  await ctx.jobs.startRecurringSync(acct!.id);
  await audit(ctx, userId, "integration.connected", "connected_account", acct!.id, { product, scopes: granted });
  return { product };
}

/** Valid access token, refreshing when needed. Marks the account revoked if Google rejects the refresh token. */
export async function getAccessToken(ctx: CoreContext, account: Account): Promise<string> {
  const google = requireGoogle(ctx);
  const key = ctx.config.encryptionKey;
  if (account.accessTokenEnc && account.tokenExpiresAt && account.tokenExpiresAt.getTime() - ctx.now().getTime() > 60_000) {
    return decrypt(account.accessTokenEnc, key);
  }
  if (!account.refreshTokenEnc) {
    await markRevoked(ctx, account, "No refresh token stored — please reconnect.");
    throw new GoogleAuthRevokedError("No refresh token");
  }
  try {
    const t = await refreshAccessToken(ctx.fetch, google, decrypt(account.refreshTokenEnc, key));
    await ctx.db
      .update(connectedAccounts)
      .set({
        accessTokenEnc: encrypt(t.access_token, key),
        tokenExpiresAt: new Date(ctx.now().getTime() + t.expires_in * 1000),
        ...(t.refresh_token ? { refreshTokenEnc: encrypt(t.refresh_token, key) } : {}),
      })
      .where(eq(connectedAccounts.id, account.id));
    return t.access_token;
  } catch (err) {
    if (err instanceof GoogleAuthRevokedError) await markRevoked(ctx, account, "Google access was revoked or expired — please reconnect.");
    throw err;
  }
}

async function markRevoked(ctx: CoreContext, account: Account, reason: string) {
  await ctx.db
    .update(connectedAccounts)
    .set({ status: "revoked", accessTokenEnc: null, refreshTokenEnc: null, lastSyncError: reason })
    .where(eq(connectedAccounts.id, account.id));
  await ctx.jobs.stopRecurringSync(account.id).catch(() => undefined);
  await audit(ctx, account.userId, "integration.revoked", "connected_account", account.id, { reason });
}

export async function connectDemo(ctx: CoreContext, userId: string, product: Product) {
  if (!ctx.config.demoMode) throw new AppError(403, "demo_disabled", "Demo mode is disabled on this server");
  const [acct] = await ctx.db
    .insert(connectedAccounts)
    .values({ userId, provider: "demo", product, status: "active" })
    .onConflictDoUpdate({ target: [connectedAccounts.userId, connectedAccounts.provider, connectedAccounts.product], set: { status: "active" } })
    .returning();
  return acct!;
}

export async function disconnect(ctx: CoreContext, userId: string, product: Product, deleteData: boolean): Promise<void> {
  const accounts = await ctx.db.query.connectedAccounts.findMany({
    where: and(eq(connectedAccounts.userId, userId), eq(connectedAccounts.product, product)),
  });
  for (const acct of accounts) {
    await ctx.jobs.stopRecurringSync(acct.id).catch(() => undefined);
    if (acct.provider === "google") {
      const token = acct.refreshTokenEnc ?? acct.accessTokenEnc;
      if (token) {
        const ok = await revokeToken(ctx.fetch, decrypt(token, ctx.config.encryptionKey)).catch(() => false);
        if (!ok) ctx.logger.warn({ accountId: acct.id }, "Google token revocation failed; tokens deleted locally anyway");
      }
    }
    if (deleteData) {
      // Cascades to synced emails, insights and imported events.
      await ctx.db.delete(connectedAccounts).where(eq(connectedAccounts.id, acct.id));
    } else {
      await ctx.db
        .update(connectedAccounts)
        .set({ status: "disconnected", accessTokenEnc: null, refreshTokenEnc: null, tokenExpiresAt: null, syncCursor: null })
        .where(eq(connectedAccounts.id, acct.id));
    }
    await audit(ctx, userId, deleteData ? "integration.deleted" : "integration.disconnected", "connected_account", acct.id, { product, provider: acct.provider });
  }
}

export async function requestSync(ctx: CoreContext, userId: string, product: Product) {
  const acct = await ctx.db.query.connectedAccounts.findFirst({
    where: and(eq(connectedAccounts.userId, userId), eq(connectedAccounts.product, product), eq(connectedAccounts.status, "active")),
  });
  if (!acct) throw new AppError(409, "not_connected", `${product === "gmail" ? "Gmail" : "Calendar"} is not connected`);
  await ctx.jobs.enqueueSync(acct.id, "manual");
  return acct;
}

/** Executed by the worker. Skips (and unschedules) anything that is no longer an active connection. */
export async function runSync(ctx: CoreContext, accountId: string): Promise<{ status: "succeeded" | "skipped" | "failed"; items: number; error?: string }> {
  const acct = await ctx.db.query.connectedAccounts.findFirst({ where: eq(connectedAccounts.id, accountId) });
  if (!acct || acct.status !== "active") {
    await ctx.jobs.stopRecurringSync(accountId).catch(() => undefined);
    if (acct) await ctx.db.insert(syncJobs).values({ userId: acct.userId, accountId, product: acct.product, status: "skipped", error: `account ${acct.status}`, finishedAt: ctx.now() });
    return { status: "skipped", items: 0 };
  }
  const [job] = await ctx.db
    .insert(syncJobs)
    .values({ userId: acct.userId, accountId, product: acct.product, status: "running", startedAt: ctx.now() })
    .returning();
  try {
    let items = 0;
    if (acct.provider === "demo") {
      items = acct.product === "gmail" ? await syncDemoGmail(ctx, acct.userId, acct.id) : await syncDemoCalendar(ctx, acct.userId, acct.id);
    } else if (acct.product === "gmail") {
      items = await syncGmail(ctx, acct);
    } else {
      items = await syncGoogleCalendar(ctx, acct);
    }
    await ctx.db.update(connectedAccounts).set({ lastSyncAt: ctx.now(), lastSyncError: null }).where(eq(connectedAccounts.id, acct.id));
    await ctx.db.update(syncJobs).set({ status: "succeeded", itemsProcessed: items, finishedAt: ctx.now() }).where(eq(syncJobs.id, job!.id));
    return { status: "succeeded", items };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.db.update(syncJobs).set({ status: "failed", error: message.slice(0, 500), finishedAt: ctx.now() }).where(eq(syncJobs.id, job!.id));
    if (!(err instanceof GoogleAuthRevokedError)) {
      await ctx.db.update(connectedAccounts).set({ lastSyncError: message.slice(0, 300) }).where(eq(connectedAccounts.id, acct.id));
      throw err; // let the queue retry with backoff
    }
    return { status: "failed", items: 0, error: message };
  }
}

async function syncGmail(ctx: CoreContext, acct: Account): Promise<number> {
  const token = await getAccessToken(ctx, acct);
  let ids: string[];
  let cursor: string;
  const incremental = acct.syncCursor ? await listAddedSince(ctx.fetch, token, acct.syncCursor) : null;
  if (incremental) {
    ids = incremental.ids;
    cursor = incremental.historyId;
  } else {
    const profile = await getProfile(ctx.fetch, token);
    cursor = profile.historyId;
    ids = await listRecentMessageIds(ctx.fetch, token, ctx.config.gmailWindowDays);
  }
  // Deduplicate against what we already have before fetching bodies.
  const known = ids.length
    ? await ctx.db
        .select({ id: syncedEmails.providerMessageId })
        .from(syncedEmails)
        .where(and(eq(syncedEmails.accountId, acct.id), inArray(syncedEmails.providerMessageId, ids)))
    : [];
  const knownSet = new Set(known.map((k) => k.id));
  const newIds: string[] = [];
  for (const id of ids.filter((i) => !knownSet.has(i))) {
    const parsed = parseGmailMessage(await getMessage(ctx.fetch, token, id));
    const [row] = await ctx.db
      .insert(syncedEmails)
      .values({ userId: acct.userId, accountId: acct.id, ...parsed })
      .onConflictDoNothing()
      .returning({ id: syncedEmails.id });
    if (row) newIds.push(row.id);
  }
  await ctx.db.update(connectedAccounts).set({ syncCursor: cursor }).where(eq(connectedAccounts.id, acct.id));
  if (newIds.length) await processEmails(ctx, acct.userId, newIds);
  return newIds.length;
}

/**
 * Windowed full resync (now-1d … now+N days). Google's syncToken can't be combined with a time
 * window, and a bounded window keeps data minimal, so each run upserts the window and removes
 * events that disappeared from it. Imported events are read-only.
 */
async function syncGoogleCalendar(ctx: CoreContext, acct: Account): Promise<number> {
  const token = await getAccessToken(ctx, acct);
  const prefs = await getPrefs(ctx, acct.userId);
  const now = ctx.now();
  const timeMin = new Date(now.getTime() - 24 * 3_600_000);
  const timeMax = new Date(now.getTime() + ctx.config.calendarWindowDays * 24 * 3_600_000);
  const { items, timeZone } = await listEvents(ctx.fetch, token, timeMin, timeMax);
  const seen: string[] = [];
  let upserted = 0;
  for (const raw of items) {
    if (raw.status === "cancelled") continue;
    const ev = mapGoogleEvent(raw, timeZone ?? prefs.timezone);
    if (!ev) continue;
    seen.push(ev.providerEventId);
    const [row] = await ctx.db
      .insert(calendarEvents)
      .values({ userId: acct.userId, accountId: acct.id, source: "google", calendarId: "primary", ...ev })
      .onConflictDoUpdate({
        target: [calendarEvents.accountId, calendarEvents.calendarId, calendarEvents.providerEventId],
        targetWhere: sql`${calendarEvents.providerEventId} is not null`,
        // User-owned fields (needsPrep, prepMin) are deliberately preserved.
        set: {
          title: ev.title,
          description: ev.description,
          location: ev.location,
          startAt: ev.startAt,
          endAt: ev.endAt,
          allDay: ev.allDay,
          timezone: ev.timezone,
          status: ev.status,
          htmlLink: ev.htmlLink,
          recurringEventId: ev.recurringEventId,
        },
      })
      .returning();
    if (row) {
      upserted++;
      if (row.needsPrep) await syncEventReminder(ctx, acct.userId, row.id);
    }
  }
  const staleWhere = and(
    eq(calendarEvents.accountId, acct.id),
    gt(calendarEvents.endAt, timeMin),
    sql`${calendarEvents.startAt} < ${timeMax}`,
    seen.length ? notInArray(calendarEvents.providerEventId, seen) : undefined,
  );
  await ctx.db.delete(calendarEvents).where(staleWhere);
  return upserted;
}
