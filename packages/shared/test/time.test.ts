import { describe, expect, it } from "vitest";
import {
  atLocalMinute,
  freeIntervals,
  isInQuietHours,
  localDayBounds,
  minutesBetween,
  nextQuietEnd,
} from "../src/time.js";
import { adjustForQuietHours, planTaskReminders } from "../src/reminders.js";

describe("timezone handling", () => {
  it("converts local wall time to UTC (Asia/Kolkata, +05:30)", () => {
    expect(atLocalMinute("2026-11-02", 9 * 60, "Asia/Kolkata").toISOString()).toBe("2026-11-02T03:30:00.000Z");
  });

  it("DST spring-forward day is 23 hours and 09:00 stays 09:00 local", () => {
    const { start, end } = localDayBounds("2026-03-08", "America/New_York");
    expect(minutesBetween(start, end)).toBe(23 * 60);
    expect(atLocalMinute("2026-03-07", 540, "America/New_York").toISOString()).toBe("2026-03-07T14:00:00.000Z");
    expect(atLocalMinute("2026-03-09", 540, "America/New_York").toISOString()).toBe("2026-03-09T13:00:00.000Z");
  });

  it("DST fall-back day is 25 hours", () => {
    const { start, end } = localDayBounds("2026-11-01", "America/New_York");
    expect(minutesBetween(start, end)).toBe(25 * 60);
  });
});

describe("quiet hours", () => {
  const q = { enabled: true, startMin: 22 * 60, endMin: 7 * 60 };
  const tz = "Asia/Kolkata";

  it("detects windows that cross midnight", () => {
    expect(isInQuietHours(atLocalMinute("2026-11-02", 23 * 60, tz), tz, q)).toBe(true);
    expect(isInQuietHours(atLocalMinute("2026-11-02", 3 * 60, tz), tz, q)).toBe(true);
    expect(isInQuietHours(atLocalMinute("2026-11-02", 12 * 60, tz), tz, q)).toBe(false);
    expect(isInQuietHours(atLocalMinute("2026-11-02", 23 * 60, tz), tz, { ...q, enabled: false })).toBe(false);
  });

  it("defers to the end of quiet hours, next morning when before midnight", () => {
    const at = atLocalMinute("2026-11-02", 23 * 60, tz);
    expect(nextQuietEnd(at, tz, q).toISOString()).toBe(atLocalMinute("2026-11-03", 7 * 60, tz).toISOString());
    const early = atLocalMinute("2026-11-03", 2 * 60, tz);
    expect(nextQuietEnd(early, tz, q).toISOString()).toBe(atLocalMinute("2026-11-03", 7 * 60, tz).toISOString());
  });

  it("moves prep reminders earlier and due reminders later", () => {
    const now = atLocalMinute("2026-11-02", 12 * 60, tz);
    const inQuiet = atLocalMinute("2026-11-02", 23 * 60, tz);
    expect(adjustForQuietHours("prep", inQuiet, now, tz, q).at.toISOString()).toBe(
      atLocalMinute("2026-11-02", 21 * 60 + 45, tz).toISOString(),
    );
    expect(adjustForQuietHours("due", inQuiet, now, tz, q).at.toISOString()).toBe(
      atLocalMinute("2026-11-03", 7 * 60, tz).toISOString(),
    );
  });
});

describe("free intervals", () => {
  it("subtracts merged busy blocks", () => {
    const d = (h: number) => new Date(Date.UTC(2026, 0, 1, h));
    const free = freeIntervals({ start: d(9), end: d(17) }, [
      { start: d(10), end: d(11) },
      { start: d(10), end: d(12) },
      { start: d(15), end: d(18) },
    ]);
    expect(free.map((f) => [f.start.getUTCHours(), f.end.getUTCHours()])).toEqual([
      [9, 10],
      [12, 15],
    ]);
  });
});

describe("task reminder planning", () => {
  const tz = "Asia/Kolkata";
  const q = { enabled: true, startMin: 22 * 60, endMin: 7 * 60 };
  const base = { taskId: "t1", status: "open" as const, leadMin: 60, maxPerTask: 3, timezone: tz, quiet: q };

  it("creates prep + due reminders with stable idempotency keys", () => {
    const now = atLocalMinute("2026-11-02", 9 * 60, tz);
    const dueAt = atLocalMinute("2026-11-02", 17 * 60, tz);
    const r = planTaskReminders({ ...base, now, dueAt });
    expect(r.map((x) => [x.kind, x.idempotencyKey])).toEqual([
      ["prep", "task:t1:prep"],
      ["due", "task:t1:due"],
    ]);
    expect(r[0]!.remindAt.toISOString()).toBe(atLocalMinute("2026-11-02", 16 * 60, tz).toISOString());
  });

  it("creates nothing for completed tasks or past due times", () => {
    const now = atLocalMinute("2026-11-02", 18 * 60, tz);
    expect(planTaskReminders({ ...base, now, dueAt: atLocalMinute("2026-11-02", 17 * 60, tz) })).toEqual([]);
    expect(planTaskReminders({ ...base, status: "done", now, dueAt: atLocalMinute("2026-11-03", 17 * 60, tz) })).toEqual([]);
  });

  it("respects the per-task reminder limit", () => {
    const now = atLocalMinute("2026-11-02", 9 * 60, tz);
    const r = planTaskReminders({ ...base, maxPerTask: 1, now, dueAt: atLocalMinute("2026-11-02", 17 * 60, tz) });
    expect(r).toHaveLength(1);
  });
});
