import { Router } from "express";
import { and, desc, eq, inArray, type SQL } from "drizzle-orm";
import { z } from "zod";
import { connectedAccounts, emailInsights, syncedEmails, tasks } from "@lifepilot/db";
import { approveInsight, getInsight, type CoreContext } from "@lifepilot/core";
import { emailCategorySchema, insightToTaskSchema, insightUpdateSchema } from "@lifepilot/shared";
import { uid } from "../auth.js";
import { idParam, parse } from "../http.js";
import { insightDTO, taskDTO } from "../serialize.js";

const listQuery = z.object({
  status: z.enum(["new", "reviewed", "dismissed", "task_created", "open", "all"]).default("open"),
  category: emailCategorySchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export async function loadInsights(ctx: CoreContext, userId: string, opts: { status?: string; category?: string; limit: number; ids?: string[] }) {
  const conds: SQL[] = [eq(emailInsights.userId, userId)];
  if (opts.status === "open") conds.push(inArray(emailInsights.status, ["new", "task_created"]));
  else if (opts.status && opts.status !== "all") conds.push(eq(emailInsights.status, opts.status as "new"));
  if (opts.ids) conds.push(inArray(emailInsights.id, opts.ids));
  const rows = await ctx.db
    .select({ insight: emailInsights, email: syncedEmails, provider: connectedAccounts.provider })
    .from(emailInsights)
    .innerJoin(syncedEmails, eq(syncedEmails.id, emailInsights.emailId))
    .innerJoin(connectedAccounts, eq(connectedAccounts.id, syncedEmails.accountId))
    .where(and(...conds))
    .orderBy(desc(emailInsights.importanceScore), desc(syncedEmails.receivedAt))
    .limit(opts.limit);
  const filtered = opts.category ? rows.filter((r) => (r.insight.userCategory ?? r.insight.category) === opts.category) : rows;
  const emailIds = filtered.map((r) => r.email.id);
  const linked = emailIds.length
    ? await ctx.db
        .select({ id: tasks.id, sourceId: tasks.sourceId })
        .from(tasks)
        .where(and(eq(tasks.userId, userId), eq(tasks.sourceType, "email"), inArray(tasks.sourceId, emailIds)))
    : [];
  const taskBySource = new Map(linked.map((t) => [t.sourceId, t.id]));
  return filtered.map((r) => insightDTO(r.insight, r.email, r.provider, taskBySource.get(r.email.id) ?? null));
}

export function insightRoutes(ctx: CoreContext): Router {
  const r = Router();

  r.get("/", async (req, res) => {
    const q = parse(listQuery, req.query);
    res.json({ items: await loadInsights(ctx, uid(req), q) });
  });

  r.get("/:id", async (req, res) => {
    const userId = uid(req);
    const [item] = await loadInsights(ctx, userId, { status: "all", limit: 1, ids: [idParam(req)] });
    if (!item) {
      await getInsight(ctx, userId, idParam(req)); // throws 404
    }
    res.json(item);
  });

  /** Mark reviewed / dismissed, or correct the AI's category. Never touches the actual email. */
  r.patch("/:id", async (req, res) => {
    const userId = uid(req);
    const { insight } = await getInsight(ctx, userId, idParam(req));
    const input = parse(insightUpdateSchema, req.body);
    await ctx.db
      .update(emailInsights)
      .set({
        ...(input.status ? { status: input.status } : {}),
        ...(input.userCategory !== undefined ? { userCategory: input.userCategory } : {}),
      })
      .where(eq(emailInsights.id, insight.id));
    const [item] = await loadInsights(ctx, userId, { status: "all", limit: 1, ids: [insight.id] });
    res.json(item);
  });

  /** User approval turns a proposal into a task. */
  r.post("/:id/task", async (req, res) => {
    const userId = uid(req);
    const input = parse(insightToTaskSchema, req.body ?? {});
    const { task, created } = await approveInsight(ctx, userId, idParam(req), input);
    res.status(created ? 201 : 200).json({ task: taskDTO(task), created });
  });

  return r;
}
