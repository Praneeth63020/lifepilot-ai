import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { extractDeadline } from "../src/extraction.js";
import { generateDailyPlan } from "../src/planner.js";
import { planTaskReminders } from "../src/reminders.js";
import { localDayBounds, nextQuietEnd } from "../src/time.js";

const at = (iso: string, zone: string) => DateTime.fromISO(iso, { zone }).toJSDate();
const local = (d: Date | null | undefined, zone: string) => (d ? DateTime.fromJSDate(d, { zone }).toFormat("yyyy-LL-dd HH:mm") : null);
const NY = "America/New_York";
const quiet = { enabled: true, startMin: 22 * 60, endMin: 7 * 60 };
const prefs = (timezone: string) => ({ timezone, workStartMin: 9 * 60, workEndMin: 18 * 60, focusBlockMin: 90, breakMin: 10, bufferMin: 10 });

describe("timezones and DST (fixed dates)", () => {
  it.each([
    ["2026-03-08", NY], // spring forward: 23-hour day
    ["2026-11-01", NY], // fall back: 25-hour day
    ["2026-11-02", "UTC"],
    ["2026-11-02", "Asia/Kolkata"],
  ])("plans exactly the 9:00–18:00 working window on %s in %s", (date, tz) => {
    const plan = generateDailyPlan({ date, now: localDayBounds(date, tz).start, tasks: [{ id: "t", title: "t", priority: "medium", dueAt: null, estimateMin: 600, status: "open" }], events: [], prefs: prefs(tz) });
    expect(plan.stats.freeMinutes).toBe(540);
    const blocks = plan.items.filter((i) => i.kind === "task");
    expect(local(blocks[0]!.startAt, tz)).toBe(`${date} 09:00`);
    expect(blocks.every((b) => local(b.endAt, tz)! <= `${date} 18:00`)).toBe(true);
  });

  it("ends overnight quiet hours at 07:00 local across both DST changes", () => {
    expect(local(nextQuietEnd(at("2026-10-31T23:30", NY), NY, quiet), NY)).toBe("2026-11-01 07:00");
    expect(local(nextQuietEnd(at("2026-03-07T23:30", NY), NY, quiet), NY)).toBe("2026-03-08 07:00");
  });

  it("schedules reminders for an ambiguous fall-back time without duplicates", () => {
    // 01:30 happens twice on 1 Nov 2026 in New York; Luxon picks the first (EDT).
    const due = at("2026-11-01T01:30", NY);
    const plan = planTaskReminders({ taskId: "t", dueAt: due, status: "open", now: at("2026-10-31T12:00", NY), leadMin: 60, maxPerTask: 2, timezone: NY, quiet });
    expect(plan.map((r) => r.kind)).toEqual(["prep", "due"]);
    expect(new Set(plan.map((r) => r.idempotencyKey)).size).toBe(2);
    expect(local(plan.find((r) => r.kind === "prep")!.remindAt, NY)).toBe("2026-10-31 21:45"); // moved before quiet hours
    expect(local(plan.find((r) => r.kind === "due")!.remindAt, NY)).toBe("2026-11-01 07:00"); // deferred to quiet end
  });

  it("puts a task due exactly at the end of working hours inside the day", () => {
    const date = "2026-11-02";
    const tz = "Asia/Kolkata";
    const plan = generateDailyPlan({ date, now: at(`${date}T08:00`, tz), tasks: [{ id: "t", title: "t", priority: "medium", dueAt: at(`${date}T18:00`, tz), estimateMin: 60, status: "open" }], events: [], prefs: prefs(tz) });
    const block = plan.items.find((i) => i.taskId === "t")!;
    expect(block.endAt <= at(`${date}T18:00`, tz)).toBe(true);
    expect(plan.warnings.join(" ")).not.toMatch(/after its due time/);
  });

  it("keeps an event that crosses midnight blocking both days", () => {
    const tz = "UTC";
    const night = { id: "e", title: "Deploy", startAt: at("2026-11-02T17:00", tz), endAt: at("2026-11-03T10:00", tz), allDay: false, needsPrep: false, prepMin: 15 };
    const plan = generateDailyPlan({ date: "2026-11-03", now: at("2026-11-03T00:00", tz), tasks: [{ id: "t", title: "t", priority: "medium", dueAt: null, estimateMin: 60, status: "open" }], events: [night], prefs: prefs(tz) });
    expect(local(plan.items.find((i) => i.taskId === "t")!.startAt, tz)).toBe("2026-11-03 10:10"); // after the event + buffer
  });

  it("reads an explicit timezone the same way for every user timezone", () => {
    const text = "Please submit by Nov 20, 2026 at 5 PM IST.";
    for (const userTz of ["Asia/Kolkata", "UTC", NY]) {
      expect(extractDeadline(text, at("2026-11-02T10:00", userTz), userTz).deadlineAt?.toISOString()).toBe("2026-11-20T11:30:00.000Z");
    }
  });

  it("assumes end of day in the user's timezone when no time is given", () => {
    expect(local(extractDeadline("Due Nov 20.", at("2026-11-02T10:00", NY), NY).deadlineAt, NY)).toBe("2026-11-20 23:59");
    expect(local(extractDeadline("Due Nov 20.", at("2026-11-02T10:00", "UTC"), "UTC").deadlineAt, "UTC")).toBe("2026-11-20 23:59");
  });
});
