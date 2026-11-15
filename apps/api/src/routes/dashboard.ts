import { Router } from "express";
import { and, asc, desc, eq, gt, gte, isNotNull, lt } from "drizzle-orm";
import { calendarEvents, notifications, tasks } from "@lifepilot/db";
import { attachSubtasks, getCurrentPlan, getPrefs, planDrift, type CoreContext } from "@lifepilot/core";
import {
  addLocalDays,
  detectConflicts,
  generateDailyPlan,
  localDate,
  localDayBounds,
  type DashboardDTO,
  type RecommendationDTO,
} from "@lifepilot/shared";
import { uid } from "../auth.js";
import { eventDTO, notificationDTO, planDTO, taskDTO } from "../serialize.js";
import { loadInsights } from "./insights.js";
import { listConnections } from "./integrations.js";

export function dashboardRoutes(ctx: CoreContext): Router {
  const r = Router();

  r.get("/", async (req, res) => {
    const userId = uid(req);
    const prefs = await getPrefs(ctx, userId);
    const now = ctx.now();
    const tz = prefs.timezone;
    const date = localDate(now, tz);
    const { start, end } = localDayBounds(date, tz);

    const open = await ctx.db.query.tasks.findMany({ where: and(eq(tasks.userId, userId), eq(tasks.status, "open")) });
    const completedToday = await ctx.db.query.tasks.findMany({
      where: and(eq(tasks.userId, userId), eq(tasks.status, "done"), isNotNull(tasks.completedAt), gte(tasks.completedAt, start), lt(tasks.completedAt, end)),
    });
    const dueToday = open.filter((t) => t.dueAt && t.dueAt < end).sort((a, b) => a.dueAt!.getTime() - b.dueAt!.getTime());
    const events = await ctx.db.query.calendarEvents.findMany({
      where: and(eq(calendarEvents.userId, userId), gt(calendarEvents.endAt, now), lt(calendarEvents.startAt, new Date(now.getTime() + 36 * 3600_000))),
      orderBy: asc(calendarEvents.startAt),
      limit: 8,
    });
    const plan = await getCurrentPlan(ctx, userId, date);
    const topTasks = plan
      ? plan.details.topTasks
      : generateDailyPlan({
          date,
          now,
          tasks: open,
          events: [],
          prefs: {
            timezone: tz,
            workStartMin: prefs.workStartMin,
            workEndMin: prefs.workEndMin,
            focusBlockMin: prefs.focusBlockMin,
            breakMin: prefs.breakMin,
            bufferMin: prefs.bufferMin,
            sleepStartMin: prefs.sleepStartMin,
            sleepEndMin: prefs.sleepEndMin,
          },
        }).topTasks;
    const emails = (await loadInsights(ctx, userId, { status: "new", limit: 20 }))
      .filter((i) => i.category !== "low_priority" && (i.importanceScore >= 40 || i.suspicious))
      .slice(0, 5);
    const horizon = new Date(end.getTime() + 7 * 86_400_000);
    const deadlines = open
      .filter((t) => t.dueAt && t.dueAt < horizon)
      .sort((a, b) => a.dueAt!.getTime() - b.dueAt!.getTime())
      .slice(0, 8)
      .map((t) => ({ taskId: t.id, title: t.title, dueAt: t.dueAt!.toISOString(), overdue: t.dueAt! < now }));
    const recent = await ctx.db.query.notifications.findMany({
      where: and(eq(notifications.userId, userId), eq(notifications.channel, "in_app")),
      orderBy: desc(notifications.createdAt),
      limit: 5,
    });

    // Deterministic, explainable recommendations (no AI needed for these).
    const recs: RecommendationDTO[] = [];
    const overdue = open.filter((t) => t.dueAt && t.dueAt < now);
    if (overdue.length) recs.push({ kind: "overdue", text: `${overdue.length} task${overdue.length > 1 ? "s are" : " is"} overdue — finish, reschedule, or drop ${overdue.length > 1 ? "them" : "it"}.` });
    const tomorrow = localDayBounds(addLocalDays(date, 1, tz), tz);
    const tmrEvents = await ctx.db.query.calendarEvents.findMany({
      where: and(eq(calendarEvents.userId, userId), lt(calendarEvents.startAt, tomorrow.end), gt(calendarEvents.endAt, start)),
    });
    const conflicts = detectConflicts(tmrEvents);
    if (conflicts.length) recs.push({ kind: "conflict", text: `${conflicts.length} calendar conflict${conflicts.length > 1 ? "s" : ""} today or tomorrow ("${conflicts[0]!.a.title}" overlaps "${conflicts[0]!.b.title}").` });
    const unclear = emails.filter((e) => e.deadlineCertainty === "ambiguous").length;
    if (unclear) recs.push({ kind: "unclear_deadline", text: `${unclear} email${unclear > 1 ? "s mention" : " mentions"} a deadline without a clear date — confirm it before it slips.` });
    if (emails.some((e) => e.suspicious)) recs.push({ kind: "suspicious_email", text: "An email contains instructions aimed at an AI assistant. It was ignored — review it manually." });
    const noEstimate = open.filter((t) => t.estimateMin == null).length;
    if (noEstimate) recs.push({ kind: "no_estimate", text: `${noEstimate} open task${noEstimate > 1 ? "s have" : " has"} no time estimate, so plans assume 30 min.` });
    if (!plan) recs.push({ kind: "not_planned", text: "You haven't planned today yet." });
    const drift = plan ? await planDrift(ctx, userId, plan) : [];
    if (drift.length) recs.unshift({ kind: "plan_outdated", text: `Today's plan is out of date: ${drift[0]} Replan from now to fit it in.` });

    const dto: DashboardDTO = {
      now: now.toISOString(),
      date,
      timezone: tz,
      progress: { completedToday: completedToday.length, dueToday: dueToday.length, openTotal: open.length },
      topTasks,
      dueToday: (await attachSubtasks(ctx, dueToday.slice(0, 8))).map(taskDTO),
      upcomingEvents: events.map(eventDTO),
      importantEmails: emails,
      deadlines,
      recentNotifications: recent.map(notificationDTO),
      plan: plan ? planDTO(plan, drift) : null,
      recommendations: recs,
      connections: await listConnections(ctx, userId),
    };
    res.json(dto);
  });

  r.get("/week", async (req, res) => {
    const userId = uid(req);
    const prefs = await getPrefs(ctx, userId);
    const tz = prefs.timezone;
    const today = localDate(ctx.now(), tz);
    const bounds = Array.from({ length: 7 }, (_, i) => {
      const date = addLocalDays(today, i, tz);
      return { date, ...localDayBounds(date, tz) };
    });
    const weekStart = bounds[0]!.start;
    const weekEnd = bounds[6]!.end;
    // Two queries for the whole week instead of two per day.
    const allEvents = await ctx.db.query.calendarEvents.findMany({
      where: and(eq(calendarEvents.userId, userId), lt(calendarEvents.startAt, weekEnd), gt(calendarEvents.endAt, weekStart)),
    });
    const allDue = await ctx.db.query.tasks.findMany({
      where: and(eq(tasks.userId, userId), eq(tasks.status, "open"), gte(tasks.dueAt, weekStart), lt(tasks.dueAt, weekEnd)),
    });
    const days = [];
    for (const { date: d, start, end } of bounds) {
      const evs = allEvents.filter((e) => e.startAt < end && e.endAt > start);
      const due = allDue.filter((t) => t.dueAt! >= start && t.dueAt! < end);
      const busyMin = evs.filter((e) => !e.allDay).reduce((s, e) => s + Math.max(0, Math.min(e.endAt.getTime(), end.getTime()) - Math.max(e.startAt.getTime(), start.getTime())) / 60000, 0);
      days.push({ date: d, events: evs.length, busyMinutes: Math.round(busyMin), tasksDue: due.map((t) => ({ id: t.id, title: t.title, dueAt: t.dueAt!.toISOString(), priority: t.priority })), conflicts: detectConflicts(evs).length });
    }
    res.json({ days });
  });

  return r;
}
