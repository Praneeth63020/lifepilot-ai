import { and, eq, inArray } from "drizzle-orm";
import { calendarEvents, reminders, tasks } from "@lifepilot/db";
import { SNOOZE_LIMIT, adjustForQuietHours, addMinutes, planTaskReminders, snoozeUntil } from "@lifepilot/shared";
import { randomUUID } from "node:crypto";
import { AppError, badRequest, notFound, type CoreContext } from "../context.js";
import { getPrefs, quietOf } from "./prefs.js";

type ReminderRow = typeof reminders.$inferSelect;

async function enqueue(ctx: CoreContext, r: Pick<ReminderRow, "id" | "version" | "remindAt">) {
  try {
    await ctx.jobs.scheduleReminder(r.id, r.version, r.remindAt);
  } catch (err) {
    // DB stays the source of truth; the worker's startup reconciliation re-enqueues it.
    ctx.logger.error({ err, reminderId: r.id }, "Failed to enqueue reminder job");
  }
}

async function dequeue(ctx: CoreContext, r: Pick<ReminderRow, "id" | "version">) {
  try {
    await ctx.jobs.cancelReminder(r.id, r.version);
  } catch (err) {
    ctx.logger.warn({ err, reminderId: r.id }, "Failed to remove reminder job (worker will no-op it)");
  }
}

/**
 * Bring a task's automatic reminders in line with its current state.
 * Idempotent: running it twice changes nothing and enqueues nothing new.
 */
export async function syncTaskReminders(ctx: CoreContext, userId: string, taskId: string): Promise<void> {
  const task = await ctx.db.query.tasks.findFirst({ where: and(eq(tasks.id, taskId), eq(tasks.userId, userId)) });
  if (!task) return;
  const prefs = await getPrefs(ctx, userId);
  const desired = planTaskReminders({
    taskId: task.id,
    dueAt: task.dueAt,
    status: task.status,
    now: ctx.now(),
    leadMin: prefs.reminderLeadMin,
    maxPerTask: prefs.maxRemindersPerTask,
    timezone: prefs.timezone,
    quiet: quietOf(prefs),
  });
  const existing = await ctx.db.query.reminders.findMany({
    where: and(eq(reminders.taskId, task.id), inArray(reminders.kind, ["prep", "due"])),
  });
  const byKey = new Map(existing.map((r) => [r.idempotencyKey, r]));
  const toEnqueue: ReminderRow[] = [];
  const toDequeue: ReminderRow[] = [];

  for (const d of desired) {
    const cur = byKey.get(d.idempotencyKey);
    if (!cur) {
      const [row] = await ctx.db
        .insert(reminders)
        .values({ userId, taskId: task.id, kind: d.kind, remindAt: d.remindAt, priority: task.priority, idempotencyKey: d.idempotencyKey })
        .onConflictDoNothing()
        .returning();
      if (row) toEnqueue.push(row);
      continue;
    }
    const same = cur.remindAt.getTime() === d.remindAt.getTime();
    if (same && (cur.status === "scheduled" || cur.status === "fired")) {
      if (cur.priority !== task.priority) await ctx.db.update(reminders).set({ priority: task.priority }).where(eq(reminders.id, cur.id));
      continue;
    }
    if (cur.status === "scheduled") toDequeue.push(cur);
    const [row] = await ctx.db
      .update(reminders)
      .set({ remindAt: d.remindAt, status: "scheduled", version: cur.version + 1, priority: task.priority, snoozeCount: 0, firedAt: null })
      .where(eq(reminders.id, cur.id))
      .returning();
    if (row) toEnqueue.push(row);
  }

  const desiredKeys = new Set(desired.map((d) => d.idempotencyKey));
  for (const cur of existing) {
    if (cur.status === "scheduled" && !desiredKeys.has(cur.idempotencyKey)) {
      await ctx.db.update(reminders).set({ status: "cancelled" }).where(eq(reminders.id, cur.id));
      toDequeue.push(cur);
    }
  }
  for (const r of toDequeue) await dequeue(ctx, r);
  for (const r of toEnqueue) await enqueue(ctx, r);
}

/** Cancel every scheduled reminder for a task (completion, deletion). */
export async function cancelTaskReminders(ctx: CoreContext, userId: string, taskId: string): Promise<number> {
  const rows = await ctx.db
    .update(reminders)
    .set({ status: "cancelled" })
    .where(and(eq(reminders.taskId, taskId), eq(reminders.userId, userId), eq(reminders.status, "scheduled")))
    .returning();
  for (const r of rows) await dequeue(ctx, r);
  return rows.length;
}

/** Optional preparation reminder for an event the user flagged as needing prep. */
export async function syncEventReminder(ctx: CoreContext, userId: string, eventId: string): Promise<void> {
  const ev = await ctx.db.query.calendarEvents.findFirst({
    where: and(eq(calendarEvents.id, eventId), eq(calendarEvents.userId, userId)),
  });
  const key = `event:${eventId}:prep`;
  const cur = await ctx.db.query.reminders.findFirst({ where: eq(reminders.idempotencyKey, key) });
  const now = ctx.now();
  const wanted =
    ev && ev.needsPrep && !ev.allDay && ev.status !== "cancelled" ? addMinutes(ev.startAt, -ev.prepMin) : null;
  if (!wanted || wanted <= now) {
    if (cur?.status === "scheduled") {
      await ctx.db.update(reminders).set({ status: "cancelled" }).where(eq(reminders.id, cur.id));
      await dequeue(ctx, cur);
    }
    return;
  }
  const prefs = await getPrefs(ctx, userId);
  const at = adjustForQuietHours("prep", wanted, now, prefs.timezone, quietOf(prefs)).at;
  if (!cur) {
    const [row] = await ctx.db
      .insert(reminders)
      .values({ userId, eventId, kind: "event", remindAt: at, priority: "medium", idempotencyKey: key })
      .onConflictDoNothing()
      .returning();
    if (row) await enqueue(ctx, row);
    return;
  }
  if (cur.remindAt.getTime() === at.getTime() && cur.status === "scheduled") return;
  if (cur.status === "scheduled") await dequeue(ctx, cur);
  const [row] = await ctx.db
    .update(reminders)
    .set({ remindAt: at, status: "scheduled", version: cur.version + 1 })
    .where(eq(reminders.id, cur.id))
    .returning();
  if (row) await enqueue(ctx, row);
}

export async function createCustomReminder(
  ctx: CoreContext,
  userId: string,
  input: { taskId?: string; eventId?: string; remindAt: Date; note?: string },
): Promise<ReminderRow> {
  const now = ctx.now();
  if (input.remindAt <= now) throw badRequest("Reminder time must be in the future");
  let priority: ReminderRow["priority"] = "medium";
  if (input.taskId) {
    const t = await ctx.db.query.tasks.findFirst({ where: and(eq(tasks.id, input.taskId), eq(tasks.userId, userId)) });
    if (!t) throw notFound("Task");
    if (t.status === "done") throw badRequest("Task is already complete");
    priority = t.priority;
  }
  if (input.eventId) {
    const e = await ctx.db.query.calendarEvents.findFirst({
      where: and(eq(calendarEvents.id, input.eventId), eq(calendarEvents.userId, userId)),
    });
    if (!e) throw notFound("Event");
  }
  const prefs = await getPrefs(ctx, userId);
  const at = adjustForQuietHours("custom", input.remindAt, now, prefs.timezone, quietOf(prefs)).at;
  const [row] = await ctx.db
    .insert(reminders)
    .values({
      userId,
      taskId: input.taskId,
      eventId: input.eventId,
      kind: "custom",
      remindAt: at,
      note: input.note,
      priority,
      idempotencyKey: `custom:${randomUUID()}`,
    })
    .returning();
  await enqueue(ctx, row!);
  return row!;
}

export async function snoozeReminder(ctx: CoreContext, userId: string, reminderId: string, minutes: number): Promise<ReminderRow> {
  const cur = await ctx.db.query.reminders.findFirst({ where: and(eq(reminders.id, reminderId), eq(reminders.userId, userId)) });
  if (!cur) throw notFound("Reminder");
  if (cur.status === "cancelled") throw badRequest("Reminder was cancelled");
  if (cur.snoozeCount >= SNOOZE_LIMIT) {
    throw new AppError(409, "snooze_limit", `Snoozed ${SNOOZE_LIMIT} times already — reschedule the task instead`);
  }
  if (cur.taskId) {
    const t = await ctx.db.query.tasks.findFirst({ where: eq(tasks.id, cur.taskId) });
    if (t?.status === "done") throw badRequest("Task is already complete");
  }
  const prefs = await getPrefs(ctx, userId);
  const at = snoozeUntil(ctx.now(), minutes, prefs.timezone, quietOf(prefs));
  if (cur.status === "scheduled") await dequeue(ctx, cur);
  const [row] = await ctx.db
    .update(reminders)
    .set({ remindAt: at, status: "scheduled", version: cur.version + 1, snoozeCount: cur.snoozeCount + 1 })
    .where(eq(reminders.id, cur.id))
    .returning();
  await enqueue(ctx, row!);
  return row!;
}

export async function cancelReminder(ctx: CoreContext, userId: string, reminderId: string): Promise<void> {
  const [row] = await ctx.db
    .update(reminders)
    .set({ status: "cancelled" })
    .where(and(eq(reminders.id, reminderId), eq(reminders.userId, userId), eq(reminders.status, "scheduled")))
    .returning();
  if (row) await dequeue(ctx, row);
}

/** Re-enqueue every scheduled reminder (worker startup). Safe: job ids are deterministic. */
export async function reconcileScheduledReminders(ctx: CoreContext): Promise<number> {
  const rows = await ctx.db.query.reminders.findMany({ where: eq(reminders.status, "scheduled") });
  for (const r of rows) await enqueue(ctx, r);
  return rows.length;
}
