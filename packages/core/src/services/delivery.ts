import { and, eq } from "drizzle-orm";
import { calendarEvents, notifications, pushSubscriptions, reminders, tasks } from "@lifepilot/db";
import { formatLocalTime, isInQuietHours, nextQuietEnd, type Sound } from "@lifepilot/shared";
import type { CoreContext } from "../context.js";
import { getPrefs, quietOf, type Prefs } from "./prefs.js";

export type DeliveryOutcome =
  | { status: "delivered"; channels: { channel: "in_app" | "web_push"; status: string }[] }
  | { status: "skipped"; reason: string }
  | { status: "deferred"; until: Date };

type Reminder = typeof reminders.$inferSelect;

/** Consecutive failures (other than "gone") after which a push subscription is dropped. */
export const MAX_PUSH_FAILURES = 5;

export function pickSound(prefs: Pick<Prefs, "notificationSound" | "escalateSounds">, r: Pick<Reminder, "kind" | "priority">): Sound {
  if (prefs.notificationSound === "none") return "none";
  if (!prefs.escalateSounds) return prefs.notificationSound;
  if (r.kind === "due" && (r.priority === "high" || r.priority === "urgent")) return "deadline_alert";
  if (r.priority === "urgent" || r.priority === "high") return "priority_alert";
  return prefs.notificationSound;
}

/**
 * Fire one reminder job. Safe to run more than once for the same job:
 *  - stale versions / cancelled reminders / completed tasks are no-ops
 *  - notification rows have unique idempotency keys, so retries never duplicate
 *  - quiet hours are re-checked at fire time (preferences may have changed)
 */
export async function processReminderJob(ctx: CoreContext, data: { reminderId: string; version: number }): Promise<DeliveryOutcome> {
  const r = await ctx.db.query.reminders.findFirst({ where: eq(reminders.id, data.reminderId) });
  if (!r) return { status: "skipped", reason: "reminder deleted" };
  if (r.version !== data.version) return { status: "skipped", reason: "stale version" };
  if (r.status !== "scheduled") return { status: "skipped", reason: `reminder ${r.status}` };

  const task = r.taskId ? await ctx.db.query.tasks.findFirst({ where: eq(tasks.id, r.taskId) }) : null;
  const event = r.eventId ? await ctx.db.query.calendarEvents.findFirst({ where: eq(calendarEvents.id, r.eventId) }) : null;
  if (r.taskId && (!task || task.status === "done")) {
    await ctx.db.update(reminders).set({ status: "cancelled" }).where(eq(reminders.id, r.id));
    return { status: "skipped", reason: "task completed or deleted" };
  }
  if (r.eventId && (!event || event.status === "cancelled")) {
    await ctx.db.update(reminders).set({ status: "cancelled" }).where(eq(reminders.id, r.id));
    return { status: "skipped", reason: "event cancelled or deleted" };
  }

  const prefs = await getPrefs(ctx, r.userId);
  const now = ctx.now();
  const quiet = quietOf(prefs);
  if (isInQuietHours(now, prefs.timezone, quiet)) {
    const until = nextQuietEnd(now, prefs.timezone, quiet);
    const [row] = await ctx.db
      .update(reminders)
      .set({ remindAt: until, version: r.version + 1 })
      .where(and(eq(reminders.id, r.id), eq(reminders.version, r.version)))
      .returning();
    if (row) await ctx.jobs.scheduleReminder(row.id, row.version, row.remindAt);
    return { status: "deferred", until };
  }

  const tz = prefs.timezone;
  let title: string;
  let body: string;
  let type: string;
  if (task && r.kind === "prep") {
    type = "task_prep";
    title = `Coming up: ${task.title}`;
    body = task.dueAt ? `Due at ${formatLocalTime(task.dueAt, tz, prefs.locale)}. A good time to start.` : "A good time to start.";
  } else if (task && r.kind === "due") {
    type = "task_due";
    const late = task.dueAt && task.dueAt < now && now.getTime() - task.dueAt.getTime() > 5 * 60_000;
    title = late ? `Was due: ${task.title}` : `Due now: ${task.title}`;
    body = late
      ? `This was due at ${formatLocalTime(task.dueAt!, tz, prefs.locale)}. Mark it done or pick a new time.`
      : "Mark it done, snooze, or reschedule.";
  } else if (event) {
    type = "event_prep";
    title = `Prepare: ${event.title}`;
    body = `Starts at ${formatLocalTime(event.startAt, tz, prefs.locale)}${event.location ? ` · ${event.location}` : ""}.`;
  } else {
    type = "custom";
    title = task ? task.title : "Reminder";
    body = r.note ?? "You asked to be reminded.";
  }

  const sound = pickSound(prefs, r);
  const base = { userId: r.userId, reminderId: r.id, taskId: r.taskId, eventId: r.eventId, type, title, body, priority: r.priority, sound };
  const keyPrefix = `${r.id}:v${r.version}`;
  const channels: { channel: "in_app" | "web_push"; status: string }[] = [];

  if (prefs.inAppEnabled) {
    const [n] = await ctx.db
      .insert(notifications)
      .values({ ...base, channel: "in_app", status: "available", deliveredAt: now, idempotencyKey: `${keyPrefix}:in_app` })
      .onConflictDoNothing()
      .returning();
    channels.push({ channel: "in_app", status: n ? "available" : "duplicate_suppressed" });
  }

  if (prefs.webPushEnabled) {
    const subs = await ctx.db.query.pushSubscriptions.findMany({ where: eq(pushSubscriptions.userId, r.userId) });
    const key = `${keyPrefix}:web_push`;
    const [inserted] = await ctx.db
      .insert(notifications)
      .values({ ...base, channel: "web_push", status: "pending", idempotencyKey: key })
      .onConflictDoNothing()
      .returning();
    // A retry after a crash between "row saved" and "push sent" finds the row still pending:
    // send it now instead of treating it as a duplicate (which would lose the push forever).
    const n = inserted ?? (await ctx.db.query.notifications.findFirst({ where: and(eq(notifications.idempotencyKey, key), eq(notifications.status, "pending")) }));
    if (!n) {
      channels.push({ channel: "web_push", status: "duplicate_suppressed" });
    } else if (!ctx.push.configured || subs.length === 0) {
      const reason = !ctx.push.configured ? "Web push not configured on the server" : "No browser is subscribed to push";
      await ctx.db.update(notifications).set({ status: "failed", error: reason }).where(eq(notifications.id, n.id));
      channels.push({ channel: "web_push", status: "failed" });
    } else {
      let accepted = 0;
      const errors: string[] = [];
      for (const s of subs) {
        const res = await ctx.push.send(s, { title, body, sound, priority: r.priority, notificationId: n.id, taskId: r.taskId, reminderId: r.id });
        if (res.ok) {
          accepted++;
          await ctx.db.update(pushSubscriptions).set({ lastSuccessAt: now, failureCount: 0 }).where(eq(pushSubscriptions.id, s.id));
        } else if (res.gone) {
          await ctx.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
          errors.push("subscription expired (removed)");
        } else if (s.failureCount + 1 >= MAX_PUSH_FAILURES) {
          // Keeps failing without being reported gone (e.g. bad keys): stop retrying it on every reminder.
          await ctx.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
          errors.push(`${res.error} (removed after ${MAX_PUSH_FAILURES} consecutive failures)`);
        } else {
          await ctx.db.update(pushSubscriptions).set({ failureCount: s.failureCount + 1 }).where(eq(pushSubscriptions.id, s.id));
          errors.push(res.error);
        }
      }
      const status = accepted > 0 ? "accepted" : "failed";
      await ctx.db
        .update(notifications)
        .set({ status, deliveredAt: accepted > 0 ? now : null, error: errors.length ? errors.join("; ").slice(0, 500) : null })
        .where(eq(notifications.id, n.id));
      channels.push({ channel: "web_push", status });
    }
  }

  await ctx.db
    .update(reminders)
    .set({ status: "fired", firedAt: now })
    .where(and(eq(reminders.id, r.id), eq(reminders.version, r.version)));
  return { status: "delivered", channels };
}
