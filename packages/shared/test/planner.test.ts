import { describe, expect, it } from "vitest";
import { generateDailyPlan, type PlanEvent, type PlanTask } from "../src/planner.js";
import { detectConflicts, proposeAlternativeSlots } from "../src/conflicts.js";
import { atLocalMinute, overlaps } from "../src/time.js";

const tz = "Asia/Kolkata";
const date = "2026-11-02";
const at = (h: number, m = 0) => atLocalMinute(date, h * 60 + m, tz);
const prefs = { timezone: tz, workStartMin: 9 * 60, workEndMin: 18 * 60, focusBlockMin: 90, breakMin: 10, bufferMin: 10 };

const task = (p: Partial<PlanTask> & { id: string }): PlanTask => ({
  title: p.id,
  priority: "medium",
  dueAt: null,
  estimateMin: 60,
  status: "open",
  ...p,
});
const event = (p: Partial<PlanEvent> & { id: string; startAt: Date; endAt: Date }): PlanEvent => ({
  title: p.id,
  allDay: false,
  needsPrep: false,
  prepMin: 15,
  ...p,
});

describe("daily planner", () => {
  it("never schedules tasks over calendar events (incl. buffer)", () => {
    const events = [event({ id: "standup", startAt: at(10), endAt: at(11) }), event({ id: "lunch", startAt: at(13), endAt: at(14) })];
    const tasks = Array.from({ length: 6 }, (_, i) => task({ id: `t${i}`, estimateMin: 60 }));
    const plan = generateDailyPlan({ date, now: at(8), tasks, events, prefs });
    const taskItems = plan.items.filter((i) => i.kind === "task");
    expect(taskItems.length).toBeGreaterThan(0);
    for (const t of taskItems) {
      for (const e of events) {
        expect(overlaps({ start: t.startAt, end: t.endAt }, { start: e.startAt, end: new Date(e.endAt.getTime() + 10 * 60000) })).toBe(false);
      }
      expect(t.startAt >= at(9)).toBe(true);
      expect(t.endAt <= at(18)).toBe(true);
    }
  });

  it("prioritizes overdue and due-today work, explains why, and picks the top 3", () => {
    const tasks = [
      task({ id: "low", priority: "low" }),
      task({ id: "dueToday", dueAt: at(17) }),
      task({ id: "overdue", dueAt: at(7) }),
      task({ id: "urgent", priority: "urgent" }),
    ];
    const plan = generateDailyPlan({ date, now: at(8), tasks, events: [], prefs });
    expect(plan.topTasks.map((t) => t.taskId)).toEqual(["overdue", "dueToday", "urgent"]);
    expect(plan.topTasks[0]!.reason).toContain("Overdue");
    expect(plan.topTasks[1]!.reason).toContain("Due today");
  });

  it("only schedules from now onward when planning today", () => {
    const plan = generateDailyPlan({ date, now: at(14, 3), tasks: [task({ id: "a" })], events: [], prefs });
    const first = plan.items.find((i) => i.kind === "task")!;
    expect(first.startAt.getTime()).toBe(at(14, 5).getTime());
  });

  it("inserts breaks after a focus block and splits long tasks", () => {
    const plan = generateDailyPlan({ date, now: at(8), tasks: [task({ id: "big", estimateMin: 180 })], events: [], prefs });
    const kinds = plan.items.map((i) => i.kind);
    expect(kinds).toEqual(["task", "break", "task"]);
    expect(plan.stats.scheduledTaskMinutes).toBe(180);
  });

  it("reports overload and separates unscheduled from postponable", () => {
    const tasks = [
      task({ id: "due1", dueAt: at(17), estimateMin: 300, priority: "high" }),
      task({ id: "due2", dueAt: at(17), estimateMin: 300, priority: "high" }),
      task({ id: "someday", priority: "low", estimateMin: 120 }),
    ];
    const plan = generateDailyPlan({ date, now: at(8), tasks, events: [], prefs });
    expect(plan.warnings.some((w) => w.startsWith("Overloaded"))).toBe(true);
    expect(plan.unscheduled.map((u) => u.taskId)).toContain("due2");
    expect(plan.postponable.map((u) => u.taskId)).toContain("someday");
  });

  it("adds preparation blocks before events that need them", () => {
    const events = [event({ id: "interview", startAt: at(11), endAt: at(12), needsPrep: true, prepMin: 20 })];
    const plan = generateDailyPlan({ date, now: at(8), tasks: [], events, prefs });
    const prep = plan.items.find((i) => i.kind === "prep")!;
    expect(prep.startAt.getTime()).toBe(at(10, 40).getTime());
    expect(prep.isFact).toBe(false);
    expect(plan.items.find((i) => i.kind === "event")!.isFact).toBe(true);
  });

  it("respects dependencies and flags assumed estimates", () => {
    const tasks = [task({ id: "second", dependsOnTaskId: "first", priority: "urgent" }), task({ id: "first", estimateMin: null })];
    const plan = generateDailyPlan({ date, now: at(8), tasks, events: [], prefs });
    const order = plan.items.filter((i) => i.kind === "task").map((i) => i.taskId);
    expect(order).toEqual(["first", "second"]);
    expect(plan.warnings.some((w) => w.includes("no time estimate"))).toBe(true);
  });

  it("is deterministic", () => {
    const input = { date, now: at(8), tasks: [task({ id: "a" }), task({ id: "b", priority: "high" })], events: [], prefs };
    expect(JSON.stringify(generateDailyPlan(input))).toBe(JSON.stringify(generateDailyPlan(input)));
  });
});

describe("calendar conflicts", () => {
  it("detects overlaps and ignores all-day / cancelled events", () => {
    const evs = [
      { id: "a", title: "A", startAt: at(10), endAt: at(11), allDay: false },
      { id: "b", title: "B", startAt: at(10, 30), endAt: at(11, 30), allDay: false },
      { id: "c", title: "Holiday", startAt: at(0), endAt: at(23), allDay: true },
      { id: "d", title: "Cancelled", startAt: at(10), endAt: at(11), allDay: false, status: "cancelled" },
      { id: "e", title: "E", startAt: at(11), endAt: at(12), allDay: false },
    ];
    const c = detectConflicts(evs);
    expect(c.map((x) => [x.a.id, x.b.id, x.overlapMinutes])).toEqual([
      ["a", "b", 30],
      ["b", "e", 30],
    ]);
  });

  it("proposes alternative slots that avoid all other events", () => {
    const evs = [
      { id: "a", title: "A", startAt: at(10), endAt: at(11), allDay: false },
      { id: "b", title: "B", startAt: at(10, 30), endAt: at(11, 30), allDay: false },
    ];
    const slots = proposeAlternativeSlots({ target: evs[1]!, events: evs, now: at(8), prefs });
    expect(slots.length).toBe(3);
    for (const s of slots) {
      expect(overlaps(s, { start: at(9, 50), end: at(11, 10) })).toBe(false);
      expect(s.end.getTime() - s.start.getTime()).toBe(60 * 60000);
    }
  });
});
