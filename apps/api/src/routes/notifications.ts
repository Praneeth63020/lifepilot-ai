import { Router } from "express";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { calendarEvents, notifications, pushSubscriptions, reminders, tasks } from "@lifepilot/db";
import {
  AppError,
  cancelReminder,
  completeTask,
  createCustomReminder,
  notFound,
  snoozeReminder,
  type CoreContext,
} from "@lifepilot/core";
import { pushSubscriptionSchema, reminderCreateSchema, snoozeSchema } from "@lifepilot/shared";
import { uid } from "../auth.js";
import { idParam, parse } from "../http.js";
import { notificationDTO, reminderDTO } from "../serialize.js";

export function reminderRoutes(ctx: CoreContext): Router {
  const r = Router();

  r.get("/", async (req, res) => {
    const userId = uid(req);
    const { status } = parse(z.object({ status: z.enum(["scheduled", "fired", "cancelled", "all"]).default("scheduled") }), req.query);
    const rows = await ctx.db.query.reminders.findMany({
      where: and(eq(reminders.userId, userId), status === "all" ? undefined : eq(reminders.status, status)),
      orderBy: asc(reminders.remindAt),
      limit: 200,
    });
    const taskIds = rows.map((x) => x.taskId).filter((x): x is string => Boolean(x));
    const eventIds = rows.map((x) => x.eventId).filter((x): x is string => Boolean(x));
    const ts = taskIds.length ? await ctx.db.select({ id: tasks.id, title: tasks.title }).from(tasks).where(inArray(tasks.id, taskIds)) : [];
    const es = eventIds.length ? await ctx.db.select({ id: calendarEvents.id, title: calendarEvents.title }).from(calendarEvents).where(inArray(calendarEvents.id, eventIds)) : [];
    const title = (x: (typeof rows)[number]) =>
      ts.find((t) => t.id === x.taskId)?.title ?? es.find((e) => e.id === x.eventId)?.title ?? x.note ?? "Reminder";
    res.json({ items: rows.map((x) => reminderDTO(x, title(x))) });
  });

  r.post("/", async (req, res) => {
    const input = parse(reminderCreateSchema, req.body);
    const row = await createCustomReminder(ctx, uid(req), { ...input, remindAt: new Date(input.remindAt) });
    res.status(201).json(reminderDTO(row, input.note ?? "Reminder"));
  });

  r.post("/:id/snooze", async (req, res) => {
    const { minutes } = parse(snoozeSchema, req.body);
    const row = await snoozeReminder(ctx, uid(req), idParam(req), minutes);
    res.json(reminderDTO(row, row.note ?? "Reminder"));
  });

  r.delete("/:id", async (req, res) => {
    await cancelReminder(ctx, uid(req), idParam(req));
    res.status(204).end();
  });

  return r;
}

export function notificationRoutes(ctx: CoreContext): Router {
  const r = Router();

  async function own(req: Parameters<Parameters<Router["get"]>[1]>[0]) {
    const n = await ctx.db.query.notifications.findFirst({ where: and(eq(notifications.id, idParam(req)), eq(notifications.userId, uid(req))) });
    if (!n) throw notFound("Notification");
    return n;
  }

  r.get("/", async (req, res) => {
    const { limit, unseen } = parse(
      z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), unseen: z.enum(["true", "false"]).optional() }),
      req.query,
    );
    const rows = await ctx.db.query.notifications.findMany({
      where: and(eq(notifications.userId, uid(req)), unseen === "true" ? eq(notifications.status, "available") : undefined),
      orderBy: desc(notifications.createdAt),
      limit,
    });
    res.json({ items: rows.map(notificationDTO) });
  });

  r.post("/seen-all", async (req, res) => {
    await ctx.db
      .update(notifications)
      .set({ status: "seen", seenAt: ctx.now() })
      .where(and(eq(notifications.userId, uid(req)), eq(notifications.status, "available")));
    res.json({ ok: true });
  });

  r.post("/:id/seen", async (req, res) => {
    const n = await own(req);
    const [row] = await ctx.db
      .update(notifications)
      .set({ status: n.status === "available" ? "seen" : n.status, seenAt: n.seenAt ?? ctx.now() })
      .where(eq(notifications.id, n.id))
      .returning();
    res.json(notificationDTO(row!));
  });

  r.post("/:id/dismiss", async (req, res) => {
    const n = await own(req);
    const [row] = await ctx.db.update(notifications).set({ status: "dismissed", seenAt: n.seenAt ?? ctx.now() }).where(eq(notifications.id, n.id)).returning();
    res.json(notificationDTO(row!));
  });

  r.post("/:id/snooze", async (req, res) => {
    const n = await own(req);
    if (!n.reminderId) throw new AppError(400, "bad_request", "This notification can't be snoozed");
    const { minutes } = parse(snoozeSchema, req.body);
    const rem = await snoozeReminder(ctx, uid(req), n.reminderId, minutes);
    await ctx.db.update(notifications).set({ status: "dismissed", seenAt: n.seenAt ?? ctx.now() }).where(eq(notifications.id, n.id));
    res.json({ remindAt: rem.remindAt.toISOString(), snoozeCount: rem.snoozeCount });
  });

  r.post("/:id/complete", async (req, res) => {
    const n = await own(req);
    if (!n.taskId) throw new AppError(400, "bad_request", "This notification isn't linked to a task");
    const out = await completeTask(ctx, uid(req), n.taskId);
    await ctx.db.update(notifications).set({ status: "dismissed", seenAt: n.seenAt ?? ctx.now() }).where(eq(notifications.id, n.id));
    res.json({ ok: true, cancelledReminders: out.cancelledReminders });
  });

  return r;
}

export function pushRoutes(ctx: CoreContext): Router {
  const r = Router();
  r.post("/subscriptions", async (req, res) => {
    if (!ctx.push.configured) throw new AppError(503, "push_unavailable", "Web push is not configured on this server");
    const sub = parse(pushSubscriptionSchema, req.body);
    await ctx.db
      .insert(pushSubscriptions)
      .values({ userId: uid(req), endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: req.get("user-agent")?.slice(0, 300) })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId: uid(req), p256dh: sub.keys.p256dh, auth: sub.keys.auth, failureCount: 0 } });
    res.status(201).json({ ok: true });
  });
  r.delete("/subscriptions", async (req, res) => {
    const { endpoint } = parse(z.object({ endpoint: z.string().url() }), req.body);
    await ctx.db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, uid(req))));
    res.status(204).end();
  });
  r.get("/subscriptions", async (req, res) => {
    const rows = await ctx.db.query.pushSubscriptions.findMany({ where: eq(pushSubscriptions.userId, uid(req)) });
    res.json({ count: rows.length, configured: ctx.push.configured });
  });
  return r;
}
