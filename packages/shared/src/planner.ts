/**
 * Deterministic daily planner. Pure function: same inputs → same plan.
 * No AI is involved in arithmetic or scheduling; AI may only add prose later.
 */
import {
  addMinutes,
  atLocalMinute,
  ceilToMinutes,
  formatLocalTime,
  freeIntervals,
  localDate,
  localDayBounds,
  minutesBetween,
  type Interval,
} from "./time.js";

export type Priority = "low" | "medium" | "high" | "urgent";

export interface PlanTask {
  id: string;
  title: string;
  priority: Priority;
  dueAt: Date | null;
  estimateMin: number | null;
  status: "open" | "done";
  dependsOnTaskId?: string | null;
  snoozedUntil?: Date | null;
  createdAt?: Date;
}

export interface PlanEvent {
  id: string;
  title: string;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  needsPrep: boolean;
  prepMin: number;
  status?: string;
}

export interface PlanPrefs {
  timezone: string;
  workStartMin: number;
  workEndMin: number;
  focusBlockMin: number;
  breakMin: number;
  bufferMin: number;
  locale?: string;
}

export type PlanItemKind = "task" | "event" | "prep" | "break";

export interface PlanItem {
  kind: PlanItemKind;
  title: string;
  startAt: Date;
  endAt: Date;
  taskId?: string;
  eventId?: string;
  reason?: string;
  /** true for confirmed facts (existing events); false for suggestions */
  isFact: boolean;
}

export interface PlanTaskRef {
  taskId: string;
  title: string;
  reason: string;
}

export interface PlanResult {
  date: string;
  items: PlanItem[];
  topTasks: PlanTaskRef[];
  /** Need time soon but did not fit today */
  unscheduled: PlanTaskRef[];
  /** Safe to move to a later day */
  postponable: PlanTaskRef[];
  deadlines: { taskId: string; title: string; dueAt: Date; overdue: boolean }[];
  warnings: string[];
  stats: { freeMinutes: number; scheduledTaskMinutes: number; requiredTodayMinutes: number };
}

export const DEFAULT_ESTIMATE_MIN = 30;
const MIN_CHUNK_MIN = 25;
const PRIORITY_WEIGHT: Record<Priority, number> = { urgent: 40, high: 30, medium: 20, low: 10 };

interface Scored {
  task: PlanTask;
  score: number;
  reasons: string[];
  dueBucket: "overdue" | "today" | "tomorrow" | "soon" | "week" | "later" | "none";
}

export function scoreTask(task: PlanTask, now: Date, date: string, prefs: PlanPrefs): Scored {
  const tz = prefs.timezone;
  const reasons: string[] = [];
  let score = PRIORITY_WEIGHT[task.priority];
  if (task.priority === "urgent" || task.priority === "high") reasons.push(`${cap(task.priority)} priority`);

  let dueBucket: Scored["dueBucket"] = "none";
  if (task.dueAt) {
    const dayEnd = localDayBounds(date, tz).end;
    const hoursFromDayEnd = (task.dueAt.getTime() - dayEnd.getTime()) / 3_600_000;
    const dueLabel = formatLocalTime(task.dueAt, tz, prefs.locale);
    if (task.dueAt < now) {
      score += 40;
      dueBucket = "overdue";
      reasons.push("Overdue");
    } else if (task.dueAt < dayEnd) {
      score += 30;
      dueBucket = "today";
      reasons.push(`Due today at ${dueLabel}`);
    } else if (hoursFromDayEnd < 24) {
      score += 20;
      dueBucket = "tomorrow";
      reasons.push("Due tomorrow");
    } else if (hoursFromDayEnd < 72) {
      score += 10;
      dueBucket = "soon";
      reasons.push("Due within 3 days");
    } else if (hoursFromDayEnd < 24 * 7) {
      score += 5;
      dueBucket = "week";
      reasons.push("Due this week");
    } else {
      dueBucket = "later";
    }
  }
  if (reasons.length === 0) reasons.push(`${cap(task.priority)} priority, no deadline`);
  return { task, score, reasons, dueBucket };
}

function compareScored(a: Scored, b: Scored): number {
  if (b.score !== a.score) return b.score - a.score;
  const ad = a.task.dueAt?.getTime() ?? Infinity;
  const bd = b.task.dueAt?.getTime() ?? Infinity;
  if (ad !== bd) return ad - bd;
  const ac = a.task.createdAt?.getTime() ?? 0;
  const bc = b.task.createdAt?.getTime() ?? 0;
  if (ac !== bc) return ac - bc;
  return a.task.id < b.task.id ? -1 : 1;
}

interface Slot extends Interval {
  cursor: Date;
  workedSinceBreak: number;
}

export function generateDailyPlan(input: {
  date: string;
  now: Date;
  tasks: PlanTask[];
  events: PlanEvent[];
  prefs: PlanPrefs;
}): PlanResult {
  const { date, now, prefs } = input;
  const tz = prefs.timezone;
  const warnings: string[] = [];
  const items: PlanItem[] = [];

  const day = localDayBounds(date, tz);
  const workStart = atLocalMinute(date, prefs.workStartMin, tz);
  const workEnd = atLocalMinute(date, prefs.workEndMin, tz);
  const isToday = localDate(now, tz) === date;
  const isPast = day.end <= now;

  let windowStart = workStart;
  if (isToday && now > workStart) windowStart = ceilToMinutes(now, 5);
  if (isPast) warnings.push("This date is in the past; nothing was scheduled.");
  else if (windowStart >= workEnd) warnings.push("Your working hours for this day are over; nothing new was scheduled.");

  // 1. Events (facts). All-day events are shown but do not block time.
  const dayEvents = input.events
    .filter((e) => e.status !== "cancelled" && e.startAt < day.end && e.endAt > day.start)
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  const busy: Interval[] = [];
  for (const ev of dayEvents) {
    items.push({
      kind: "event",
      title: ev.title,
      startAt: ev.startAt,
      endAt: ev.endAt,
      eventId: ev.id,
      isFact: true,
      reason: ev.allDay ? "All-day event (not blocking time)" : "Calendar event",
    });
    if (!ev.allDay) busy.push({ start: ev.startAt, end: addMinutes(ev.endAt, prefs.bufferMin) });
  }

  // 2. Preparation blocks before events that need them, only if that time is free.
  for (const ev of dayEvents) {
    if (!ev.needsPrep || ev.allDay) continue;
    const prep: Interval = { start: addMinutes(ev.startAt, -ev.prepMin), end: ev.startAt };
    const free = freeIntervals({ start: windowStart, end: workEnd }, busy);
    const fits = free.some((f) => f.start <= prep.start && f.end >= prep.end);
    if (fits) {
      items.push({
        kind: "prep",
        title: `Prepare: ${ev.title}`,
        startAt: prep.start,
        endAt: prep.end,
        eventId: ev.id,
        isFact: false,
        reason: `${ev.prepMin} min preparation before ${formatLocalTime(ev.startAt, tz, prefs.locale)}`,
      });
      busy.push(prep);
    } else if (ev.startAt > now) {
      warnings.push(`No free time to prepare for "${ev.title}" right before it starts.`);
    }
  }

  // 3. Free slots within working hours.
  const slots: Slot[] =
    isPast || windowStart >= workEnd
      ? []
      : freeIntervals({ start: windowStart, end: workEnd }, busy).map((f) => ({
          ...f,
          cursor: f.start,
          workedSinceBreak: 0,
        }));
  const freeMinutes = slots.reduce((s, sl) => s + minutesBetween(sl.start, sl.end), 0);

  // 4. Candidate tasks.
  const open = input.tasks.filter((t) => t.status === "open");
  const candidates = open.filter((t) => !(t.snoozedUntil && t.snoozedUntil >= day.end));
  const scored = candidates.map((t) => scoreTask(t, now, date, prefs)).sort(compareScored);
  const openIds = new Set(open.map((t) => t.id));

  const topTasks: PlanTaskRef[] = scored
    .slice(0, 3)
    .map((s) => ({ taskId: s.task.id, title: s.task.title, reason: s.reasons.join(" · ") }));

  const scheduledEnd = new Map<string, Date>();
  const unscheduled: PlanTaskRef[] = [];
  const postponable: PlanTaskRef[] = [];
  let scheduledTaskMinutes = 0;
  let requiredTodayMinutes = 0;
  let assumedEstimates = 0;

  // Processing order: score order, but a prerequisite is always processed before its dependent.
  const byId = new Map(scored.map((s) => [s.task.id, s]));
  const order: Scored[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (s: Scored) => {
    if (visited.has(s.task.id) || visiting.has(s.task.id)) return; // cycle guard
    visiting.add(s.task.id);
    const dep = s.task.dependsOnTaskId ? byId.get(s.task.dependsOnTaskId) : undefined;
    if (dep) visit(dep);
    visiting.delete(s.task.id);
    visited.add(s.task.id);
    order.push(s);
  };
  scored.forEach(visit);

  for (const s of order) {
    const t = s.task;
    const estimate = t.estimateMin ?? DEFAULT_ESTIMATE_MIN;
    if (t.estimateMin == null) assumedEstimates++;
    const mustToday = s.dueBucket === "overdue" || s.dueBucket === "today";
    if (mustToday) requiredTodayMinutes += estimate;

    if (t.dependsOnTaskId && openIds.has(t.dependsOnTaskId) && !scheduledEnd.has(t.dependsOnTaskId)) {
      const dep = open.find((o) => o.id === t.dependsOnTaskId);
      unscheduled.push({ taskId: t.id, title: t.title, reason: `Waiting on "${dep?.title ?? "another task"}"` });
      continue;
    }
    const notBefore = t.dependsOnTaskId ? scheduledEnd.get(t.dependsOnTaskId) : undefined;

    let remaining = estimate;
    const placed: PlanItem[] = [];
    for (const slot of slots) {
      while (remaining > 0) {
        if (notBefore && slot.cursor < notBefore) {
          if (notBefore >= slot.end) break;
          slot.cursor = notBefore;
          slot.workedSinceBreak = 0;
        }
        const avail = minutesBetween(slot.cursor, slot.end);
        if (avail <= 0) break;
        // Insert a break after a full focus block of continuous work.
        if (slot.workedSinceBreak >= prefs.focusBlockMin) {
          if (avail <= prefs.breakMin) break;
          items.push({
            kind: "break",
            title: "Break",
            startAt: slot.cursor,
            endAt: addMinutes(slot.cursor, prefs.breakMin),
            isFact: false,
            reason: `After ${prefs.focusBlockMin} min of focused work`,
          });
          slot.cursor = addMinutes(slot.cursor, prefs.breakMin);
          slot.workedSinceBreak = 0;
          continue;
        }
        const room = Math.min(avail, prefs.focusBlockMin - slot.workedSinceBreak);
        const chunk = Math.min(remaining, room);
        if (chunk < Math.min(remaining, MIN_CHUNK_MIN)) {
          if (room < avail) {
            // Limited by the focus block, not the slot: take a break first.
            slot.workedSinceBreak = prefs.focusBlockMin;
            continue;
          }
          break; // slot too small for a useful chunk
        }
        const start = slot.cursor;
        const end = addMinutes(start, chunk);
        placed.push({
          kind: "task",
          title: t.title,
          startAt: start,
          endAt: end,
          taskId: t.id,
          isFact: false,
          reason: s.reasons.join(" · ") + (t.estimateMin == null ? " · estimate assumed 30 min" : ""),
        });
        slot.cursor = end;
        slot.workedSinceBreak += chunk;
        remaining -= chunk;
      }
      if (remaining <= 0) break;
    }

    if (placed.length) {
      items.push(...placed);
      scheduledTaskMinutes += estimate - remaining;
      scheduledEnd.set(t.id, placed[placed.length - 1]!.endAt);
      const lastEnd = placed[placed.length - 1]!.endAt;
      if (t.dueAt && t.dueAt > now && lastEnd > t.dueAt) {
        warnings.push(`"${t.title}" is scheduled to finish after its due time.`);
      }
    }
    if (remaining > 0) {
      const partial = placed.length > 0;
      const urgentish = mustToday || s.dueBucket === "tomorrow";
      const ref = {
        taskId: t.id,
        title: t.title,
        reason: partial
          ? `Only ${estimate - remaining} of ${estimate} min fit today`
          : urgentish
            ? `${s.reasons.join(" · ")} — no free time left today`
            : s.dueBucket === "none" || s.dueBucket === "later" || s.dueBucket === "week"
              ? "No near deadline; can move to another day"
              : `${s.reasons.join(" · ")} — no free time left today`,
      };
      if (urgentish || partial || s.dueBucket === "soon") unscheduled.push(ref);
      else postponable.push(ref);
    }
  }

  if (requiredTodayMinutes > freeMinutes && !isPast) {
    warnings.push(
      `Overloaded: ${requiredTodayMinutes} min of work is due today or overdue, but only ${freeMinutes} min are free in your working hours.`,
    );
  }
  if (assumedEstimates > 0) {
    warnings.push(
      `${assumedEstimates} task${assumedEstimates > 1 ? "s have" : " has"} no time estimate; ${DEFAULT_ESTIMATE_MIN} min was assumed.`,
    );
  }

  const horizon = addMinutes(day.end, 7 * 24 * 60);
  const deadlines = open
    .filter((t) => t.dueAt && t.dueAt < horizon)
    .sort((a, b) => a.dueAt!.getTime() - b.dueAt!.getTime())
    .map((t) => ({ taskId: t.id, title: t.title, dueAt: t.dueAt!, overdue: t.dueAt! < now }));

  items.sort((a, b) => a.startAt.getTime() - b.startAt.getTime() || kindOrder(a.kind) - kindOrder(b.kind));

  return {
    date,
    items,
    topTasks,
    unscheduled,
    postponable,
    deadlines,
    warnings,
    stats: { freeMinutes, scheduledTaskMinutes, requiredTodayMinutes },
  };
}

function kindOrder(k: PlanItemKind): number {
  return { event: 0, prep: 1, task: 2, break: 3 }[k];
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
