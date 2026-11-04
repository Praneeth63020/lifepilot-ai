import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { connectedAccounts, syncJobs } from "@lifepilot/db";
import {
  AppError,
  connectDemo,
  disconnect,
  handleGoogleCallback,
  loadDemoData,
  requestSync,
  startGoogleConnect,
  type CoreContext,
} from "@lifepilot/core";
import type { ConnectionDTO } from "@lifepilot/shared";
import { requireUser, uid } from "../auth.js";
import { parse } from "../http.js";

const productSchema = z.enum(["gmail", "calendar"]);

export async function listConnections(ctx: CoreContext, userId: string): Promise<ConnectionDTO[]> {
  const rows = await ctx.db.query.connectedAccounts.findMany({ where: eq(connectedAccounts.userId, userId), orderBy: desc(connectedAccounts.updatedAt) });
  return (["gmail", "calendar"] as const).map((product) => {
    const active = rows.find((r) => r.product === product && r.status === "active");
    const latest = active ?? rows.find((r) => r.product === product && r.provider === "google") ?? rows.find((r) => r.product === product);
    return {
      product,
      provider: latest?.provider ?? null,
      status: latest ? latest.status : "not_connected",
      externalEmail: latest?.externalEmail ?? null,
      lastSyncAt: latest?.lastSyncAt?.toISOString() ?? null,
      lastSyncError: latest?.lastSyncError ?? null,
      scopes: latest?.scopes ? latest.scopes.split(" ").filter(Boolean) : [],
      available: Boolean(ctx.config.google),
      unavailableReason: ctx.config.google ? null : "Google OAuth credentials are not configured on this server.",
    };
  });
}

export function integrationRoutes(ctx: CoreContext): Router {
  const r = Router();

  /**
   * OAuth redirect target. A top-level GET navigation from Google, so the Lax session cookie is
   * sent; the state must belong to that session. Always redirects back to the web app.
   */
  r.get("/google/callback", async (req, res) => {
    const back = (q: string) => res.redirect(303, `${ctx.config.webUrl}/settings/connections?${q}`);
    if (!req.userId) return back("error=" + encodeURIComponent("Your session expired. Sign in and try connecting again."));
    try {
      const { product } = await handleGoogleCallback(ctx, req.userId, {
        state: typeof req.query.state === "string" ? req.query.state : undefined,
        code: typeof req.query.code === "string" ? req.query.code : undefined,
        error: typeof req.query.error === "string" ? req.query.error : undefined,
      });
      back(`connected=${product}`);
    } catch (err) {
      const msg = err instanceof AppError ? err.message : "Connecting to Google failed. Please try again.";
      if (!(err instanceof AppError)) ctx.logger.error({ err }, "Google OAuth callback failed");
      back("error=" + encodeURIComponent(msg));
    }
  });

  r.use(requireUser);

  r.get("/", async (req, res) => {
    res.json({ items: await listConnections(ctx, uid(req)) });
  });

  r.get("/sync-jobs", async (req, res) => {
    const rows = await ctx.db.query.syncJobs.findMany({ where: eq(syncJobs.userId, uid(req)), orderBy: desc(syncJobs.createdAt), limit: 20 });
    res.json({
      items: rows.map((j) => ({
        id: j.id,
        product: j.product,
        status: j.status,
        itemsProcessed: j.itemsProcessed,
        error: j.error,
        startedAt: j.startedAt?.toISOString() ?? null,
        finishedAt: j.finishedAt?.toISOString() ?? null,
        createdAt: j.createdAt.toISOString(),
      })),
    });
  });

  r.post("/:product/connect", async (req, res) => {
    const product = parse(productSchema, req.params.product);
    res.json(await startGoogleConnect(ctx, uid(req), product));
  });

  r.post("/demo", async (req, res) => {
    const userId = uid(req);
    if (!ctx.config.demoMode) throw new AppError(403, "demo_disabled", "Demo mode is disabled on this server");
    const google = await ctx.db.query.connectedAccounts.findFirst({
      where: and(eq(connectedAccounts.userId, userId), eq(connectedAccounts.provider, "google"), eq(connectedAccounts.status, "active")),
    });
    if (google) throw new AppError(409, "real_account_connected", "A real Google account is connected; demo data is kept separate and can't be loaded into it.");
    await connectDemo(ctx, userId, "gmail");
    await connectDemo(ctx, userId, "calendar");
    const loaded = await loadDemoData(ctx, userId);
    res.json({ loaded, items: await listConnections(ctx, userId) });
  });

  r.post("/:product/sync", async (req, res) => {
    const product = parse(productSchema, req.params.product);
    const acct = await requestSync(ctx, uid(req), product);
    res.status(202).json({ queued: true, accountId: acct.id });
  });

  r.delete("/:product", async (req, res) => {
    const product = parse(productSchema, req.params.product);
    const deleteData = req.query.deleteData === "true";
    await disconnect(ctx, uid(req), product, deleteData);
    res.json({ items: await listConnections(ctx, uid(req)), deletedData: deleteData });
  });

  return r;
}
