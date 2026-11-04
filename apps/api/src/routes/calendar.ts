import { Router } from "express";
import { and, asc, eq, gt, lt } from "drizzle-orm";
import { calendarEvents } from "@lifepilot/db";
import { AppError, getPrefs, notFound, syncEventReminder, type CoreContext } from "@lifepilot/core";
import {
  detectConflicts,
  eventCreateSchema,
  eventRangeQuerySchema,
  eventUpdateSchema,
  proposeAlternativeSlots,
} from "@lifepilot/shared";
import { uid } from "../auth.js";
import { idParam, parse } from "../http.js";
import { eventDTO } from "../serialize.js";

const MAX_RANGE_DAYS = 62;

export function calendarRoutes(ctx: CoreContext): Router {
  const r = Router();

  async function eventsInRange(userId: string, from: Date, to: Date) {
    if (to <= from) throw new AppError(400, "bad_request", "`to` must be after `from`");
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000) throw new AppError(400, "bad_request", `Range is limited to ${MAX_RANGE_DAYS} days`);
    return ctx.db.query.calendarEvents.findMany({
      where: and(eq(calendarEvents.userId, userId), lt(calendarEvents.startAt, to), gt(calendarEvents.endAt, from)),
      orderBy: asc(calendarEvents.startAt),
    });
  }

  r.get("/events", async (req, res) => {
    const q = parse(eventRangeQuerySchema, req.query);
    const rows = await eventsInRange(uid(req), new Date(q.from), new Date(q.to));
    res.json({ items: rows.map(eventDTO) });
  });

  r.post("/events", async (req, res) => {
    const userId = uid(req);
    const input = parse(eventCreateSchema, req.body);
    const prefs = await getPrefs(ctx, userId);
    const [row] = await ctx.db
      .insert(calendarEvents)
      .values({
        userId,
        source: "local",
        calendarId: "local",
        title: input.title,
        description: input.description ?? null,
        location: input.location ?? null,
        startAt: new Date(input.startAt),
        endAt: new Date(input.endAt),
        allDay: input.allDay,
        timezone: prefs.timezone,
        needsPrep: input.needsPrep,
        prepMin: input.prepMin,
      })
      .returning();
    await syncEventReminder(ctx, userId, row!.id);
    res.status(201).json(eventDTO(row!));
  });

  r.get("/events/:id", async (req, res) => {
    const row = await ctx.db.query.calendarEvents.findFirst({ where: and(eq(calendarEvents.id, idParam(req)), eq(calendarEvents.userId, uid(req))) });
    if (!row) throw notFound("Event");
    res.json(eventDTO(row));
  });

  /**
   * Imported events (Google/demo) are read-only except LifePilot's own prep settings.
   * We never write to the user's Google Calendar in this release.
   */
  r.patch("/events/:id", async (req, res) => {
    const userId = uid(req);
    const cur = await ctx.db.query.calendarEvents.findFirst({ where: and(eq(calendarEvents.id, idParam(req)), eq(calendarEvents.userId, userId)) });
    if (!cur) throw notFound("Event");
    const input = parse(eventUpdateSchema, req.body);
    const touchesProvider = ["title", "description", "location", "startAt", "endAt"].some((k) => (input as Record<string, unknown>)[k] !== undefined);
    if (cur.source !== "local" && touchesProvider) {
      throw new AppError(403, "read_only_event", "Imported calendar events are read-only. Change them in your calendar app; only preparation settings can be edited here.");
    }
    const startAt = input.startAt ? new Date(input.startAt) : cur.startAt;
    const endAt = input.endAt ? new Date(input.endAt) : cur.endAt;
    if (endAt <= startAt) throw new AppError(400, "bad_request", "End must be after start");
    const [row] = await ctx.db
      .update(calendarEvents)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.location !== undefined ? { location: input.location ?? null } : {}),
        startAt,
        endAt,
        ...(input.needsPrep !== undefined ? { needsPrep: input.needsPrep } : {}),
        ...(input.prepMin !== undefined ? { prepMin: input.prepMin } : {}),
      })
      .where(eq(calendarEvents.id, cur.id))
      .returning();
    await syncEventReminder(ctx, userId, cur.id);
    res.json(eventDTO(row!));
  });

  r.delete("/events/:id", async (req, res) => {
    const userId = uid(req);
    const cur = await ctx.db.query.calendarEvents.findFirst({ where: and(eq(calendarEvents.id, idParam(req)), eq(calendarEvents.userId, userId)) });
    if (!cur) throw notFound("Event");
    if (cur.source !== "local") throw new AppError(403, "read_only_event", "Imported calendar events can't be deleted from LifePilot");
    await ctx.db.delete(calendarEvents).where(eq(calendarEvents.id, cur.id));
    res.status(204).end();
  });

  r.get("/conflicts", async (req, res) => {
    const q = parse(eventRangeQuerySchema, req.query);
    const rows = await eventsInRange(uid(req), new Date(q.from), new Date(q.to));
    const conflicts = detectConflicts(rows);
    res.json({
      items: conflicts.map((c) => ({ ...c, overlapStart: c.overlapStart.toISOString(), overlapEnd: c.overlapEnd.toISOString() })),
    });
  });

  /** Suggested times only — nothing is moved. */
  r.get("/events/:id/alternatives", async (req, res) => {
    const userId = uid(req);
    const target = await ctx.db.query.calendarEvents.findFirst({ where: and(eq(calendarEvents.id, idParam(req)), eq(calendarEvents.userId, userId)) });
    if (!target) throw notFound("Event");
    const prefs = await getPrefs(ctx, userId);
    const from = new Date(Math.min(target.startAt.getTime(), ctx.now().getTime()));
    const to = new Date(from.getTime() + 4 * 86_400_000);
    const events = await eventsInRange(userId, from, to);
    const slots = proposeAlternativeSlots({ target, events, now: ctx.now(), prefs });
    res.json({
      event: eventDTO(target),
      suggestions: slots.map((s) => ({ startAt: s.start.toISOString(), endAt: s.end.toISOString() })),
      note:
        target.source === "local"
          ? "Pick a time to move this event."
          : "This event lives in your calendar app. LifePilot won't change it — use these as suggestions when you reschedule there.",
    });
  });

  return r;
}
