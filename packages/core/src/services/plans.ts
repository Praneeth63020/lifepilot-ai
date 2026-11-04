import { and, asc, desc, eq, gt, inArray, lt, ne } from "drizzle-orm";
import { calendarEvents, dailyPlanItems, dailyPlans, tasks } from "@lifepilot/db";
import { generateDailyPlan, localDate, localDayBounds, overlaps, type PlanResult } from "@lifepilot/shared";
import { badRequest, notFound, type CoreContext } from "../context.js";
import { getPrefs } from "./prefs.js";

export type PlanRow = typeof dailyPlans.$inferSelect;
export type PlanItemRow = typeof dailyPlanItems.$inferSelect;
export interface PlanDetails {
  topTasks: PlanResult["topTasks"];
  unscheduled: PlanResult["unscheduled"];
  postponable: PlanResult["postponable"];
  deadlines: { taskId: string; title: string; dueAt: string; overdue: boolean }[];
  warnings: string[];
  stats: PlanResult["stats"];
  changes?: { taskId: string; title: string; change: "added" | "moved" | "removed"; from?: string; to?: string }[];
}
export type FullPlan = PlanRow & { details: PlanDetails; items: PlanItemRow[] };

async function loadInputs(ctx: CoreContext, userId: string, date: string) {
  const prefs = await getPrefs(ctx, userId);
  const { start, end } = localDayBounds(date, prefs.timezone);
  const openTasks = await ctx.db.query.tasks.findMany({ where: and(eq(tasks.userId, userId), eq(tasks.status, "open")) });
  const events = await ctx.db.query.calendarEvents.findMany({
    where: and(eq(calendarEvents.userId, userId), lt(calendarEvents.startAt, end), gt(calendarEvents.endAt, start), ne(calendarEvents.status, "cancelled")),
  });
  return { prefs, openTasks, events };
}

export async function getPlan(ctx: CoreContext, userId: string, planId: string): Promise<FullPlan> {
  const plan = await ctx.db.query.dailyPlans.findFirst({ where: and(eq(dailyPlans.id, planId), eq(dailyPlans.userId, userId)) });
  if (!plan) throw notFound("Plan");
  const items = await ctx.db.query.dailyPlanItems.findMany({ where: eq(dailyPlanItems.planId, plan.id), orderBy: asc(dailyPlanItems.position) });
  return { ...plan, details: plan.details as PlanDetails, items };
}

/** Latest non-rejected plan for a date (accepted preferred), or null. */
export async function getCurrentPlan(ctx: CoreContext, userId: string, date: string): Promise<FullPlan | null> {
  const rows = await ctx.db.query.dailyPlans.findMany({
    where: and(eq(dailyPlans.userId, userId), eq(dailyPlans.date, date), inArray(dailyPlans.status, ["accepted", "proposed"])),
    orderBy: desc(dailyPlans.generatedAt),
  });
  const pick = rows.find((r) => r.status === "accepted") ?? rows[0];
  return pick ? getPlan(ctx, userId, pick.id) : null;
}

/**
 * Generate (or regenerate / replan) a proposal. Existing proposals for that date are superseded;
 * an accepted plan stays until the user accepts the new one. Nothing outside the plan is changed.
 */
export async function generatePlan(ctx: CoreContext, userId: string, dateArg?: string): Promise<FullPlan> {
  const prefs = await getPrefs(ctx, userId);
  const now = ctx.now();
  const date = dateArg ?? localDate(now, prefs.timezone);
  const { openTasks, events } = await loadInputs(ctx, userId, date);
  const previous = await getCurrentPlan(ctx, userId, date);

  const result = generateDailyPlan({
    date,
    now,
    prefs: {
      timezone: prefs.timezone,
      workStartMin: prefs.workStartMin,
      workEndMin: prefs.workEndMin,
      focusBlockMin: prefs.focusBlockMin,
      breakMin: prefs.breakMin,
      bufferMin: prefs.bufferMin,
      locale: prefs.locale,
    },
    tasks: openTasks.map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      dueAt: t.dueAt,
      estimateMin: t.estimateMin,
      status: t.status,
      dependsOnTaskId: t.dependsOnTaskId,
      snoozedUntil: t.snoozedUntil,
      createdAt: t.createdAt,
    })),
    events: events.map((e) => ({ id: e.id, title: e.title, startAt: e.startAt, endAt: e.endAt, allDay: e.allDay, needsPrep: e.needsPrep, prepMin: e.prepMin, status: e.status })),
  });

  const details: PlanDetails = {
    topTasks: result.topTasks,
    unscheduled: result.unscheduled,
    postponable: result.postponable,
    deadlines: result.deadlines.map((d) => ({ ...d, dueAt: d.dueAt.toISOString() })),
    warnings: result.warnings,
    stats: result.stats,
  };
  if (previous) details.changes = diffPlans(previous.items, result.items);

  await ctx.db
    .update(dailyPlans)
    .set({ status: "superseded" })
    .where(and(eq(dailyPlans.userId, userId), eq(dailyPlans.date, date), eq(dailyPlans.status, "proposed")));
  const [plan] = await ctx.db.insert(dailyPlans).values({ userId, date, status: "proposed", generator: "rules-v1", details }).returning();
  if (result.items.length) {
    await ctx.db.insert(dailyPlanItems).values(
      result.items.map((it, i) => ({
        planId: plan!.id,
        userId,
        kind: it.kind,
        taskId: it.taskId ?? null,
        eventId: it.eventId ?? null,
        title: it.title,
        startAt: it.startAt,
        endAt: it.endAt,
        reason: it.reason ?? null,
        isFact: it.isFact,
        position: i,
      })),
    );
  }
  return getPlan(ctx, userId, plan!.id);
}

function diffPlans(prev: PlanItemRow[], next: PlanResult["items"]): NonNullable<PlanDetails["changes"]> {
  const firstStart = (items: { kind: string; taskId?: string | null; startAt: Date; title: string }[]) => {
    const m = new Map<string, { start: Date; title: string }>();
    for (const it of items) if (it.kind === "task" && it.taskId && !m.has(it.taskId)) m.set(it.taskId, { start: it.startAt, title: it.title });
    return m;
  };
  const a = firstStart(prev);
  const b = firstStart(next);
  const out: NonNullable<PlanDetails["changes"]> = [];
  for (const [id, v] of b) {
    const old = a.get(id);
    if (!old) out.push({ taskId: id, title: v.title, change: "added", to: v.start.toISOString() });
    else if (old.start.getTime() !== v.start.getTime()) out.push({ taskId: id, title: v.title, change: "moved", from: old.start.toISOString(), to: v.start.toISOString() });
  }
  for (const [id, v] of a) if (!b.has(id)) out.push({ taskId: id, title: v.title, change: "removed", from: v.start.toISOString() });
  return out;
}

export async function setPlanStatus(ctx: CoreContext, userId: string, planId: string, status: "accepted" | "rejected"): Promise<FullPlan> {
  const plan = await getPlan(ctx, userId, planId);
  if (plan.status === "superseded") throw badRequest("This plan was replaced by a newer one");
  if (status === "accepted") {
    await ctx.db
      .update(dailyPlans)
      .set({ status: "superseded" })
      .where(and(eq(dailyPlans.userId, userId), eq(dailyPlans.date, plan.date), ne(dailyPlans.id, plan.id), inArray(dailyPlans.status, ["accepted", "proposed"])));
  }
  await ctx.db.update(dailyPlans).set({ status }).where(eq(dailyPlans.id, plan.id));
  return getPlan(ctx, userId, plan.id);
}

/** User edits suggested blocks. Facts (events) can't be moved here, and blocks can't overlap events. */
export async function editPlanItems(ctx: CoreContext, userId: string, planId: string, edits: { id: string; startAt: string; endAt: string }[]): Promise<FullPlan> {
  const plan = await getPlan(ctx, userId, planId);
  const eventsIv = plan.items.filter((i) => i.kind === "event").map((i) => ({ start: i.startAt, end: i.endAt, allDay: i.reason?.startsWith("All-day") }));
  for (const e of edits) {
    const item = plan.items.find((i) => i.id === e.id);
    if (!item) throw notFound("Plan item");
    if (item.isFact) throw badRequest("Calendar events can't be moved from the planner");
    const iv = { start: new Date(e.startAt), end: new Date(e.endAt) };
    if (iv.end <= iv.start) throw badRequest("End must be after start");
    const clash = eventsIv.find((ev) => !ev.allDay && overlaps(iv, ev));
    if (clash) throw badRequest(`"${item.title}" would overlap a calendar event`);
    await ctx.db.update(dailyPlanItems).set({ startAt: iv.start, endAt: iv.end }).where(eq(dailyPlanItems.id, item.id));
  }
  return getPlan(ctx, userId, plan.id);
}
