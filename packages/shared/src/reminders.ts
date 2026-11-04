import {
  addLocalDays,
  addMinutes,
  atLocalMinute,
  isInQuietHours,
  localDate,
  localMinuteOfDay,
  nextQuietEnd,
} from "./time.js";

export interface QuietHours {
  enabled: boolean;
  startMin: number;
  endMin: number;
}

export interface ReminderPlan {
  kind: "prep" | "due";
  remindAt: Date;
  idempotencyKey: string;
  adjustedForQuietHours: boolean;
}

/** Start of the quiet window that contains `at` (assumes `at` is inside quiet hours). */
function quietWindowStart(at: Date, tz: string, q: QuietHours): Date {
  const today = localDate(at, tz);
  const minute = localMinuteOfDay(at, tz);
  const startedYesterday = q.startMin > q.endMin && minute < q.endMin;
  return atLocalMinute(startedYesterday ? addLocalDays(today, -1, tz) : today, q.startMin, tz);
}

/**
 * Move a reminder out of quiet hours.
 * Prep reminders move EARLIER (15 min before quiet hours start) when that is still in the
 * future, because a prep reminder is useless after the thing it prepares for.
 * Everything else is deferred to when quiet hours end. Nothing bypasses quiet hours.
 */
export function adjustForQuietHours(
  kind: "prep" | "due" | "event" | "custom",
  at: Date,
  now: Date,
  tz: string,
  q: QuietHours,
): { at: Date; adjusted: boolean } {
  if (!isInQuietHours(at, tz, q)) return { at, adjusted: false };
  if (kind === "prep") {
    const earlier = addMinutes(quietWindowStart(at, tz, q), -15);
    if (earlier > now) return { at: earlier, adjusted: true };
  }
  return { at: nextQuietEnd(at, tz, q), adjusted: true };
}

/** Reminders a task with a due time should have. Pure; the API persists and enqueues them. */
export function planTaskReminders(input: {
  taskId: string;
  dueAt: Date | null;
  status: "open" | "done";
  now: Date;
  leadMin: number;
  maxPerTask: number;
  timezone: string;
  quiet: QuietHours;
}): ReminderPlan[] {
  const { taskId, dueAt, now } = input;
  if (!dueAt || input.status === "done") return [];
  const out: ReminderPlan[] = [];
  if (input.leadMin > 0) {
    const raw = addMinutes(dueAt, -input.leadMin);
    if (raw > now) {
      const adj = adjustForQuietHours("prep", raw, now, input.timezone, input.quiet);
      if (adj.at < dueAt) {
        out.push({ kind: "prep", remindAt: adj.at, idempotencyKey: `task:${taskId}:prep`, adjustedForQuietHours: adj.adjusted });
      }
    }
  }
  if (dueAt > now) {
    const adj = adjustForQuietHours("due", dueAt, now, input.timezone, input.quiet);
    out.push({ kind: "due", remindAt: adj.at, idempotencyKey: `task:${taskId}:due`, adjustedForQuietHours: adj.adjusted });
  }
  return out.slice(0, Math.max(0, input.maxPerTask));
}

export const SNOOZE_LIMIT = 5;

export function snoozeUntil(now: Date, minutes: number, tz: string, q: QuietHours): Date {
  return adjustForQuietHours("custom", addMinutes(now, minutes), now, tz, q).at;
}
