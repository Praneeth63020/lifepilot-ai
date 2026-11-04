import { DateTime, IANAZone } from "luxon";

export const MINUTE = 60_000;

export function isValidTimezone(tz: string): boolean {
  return IANAZone.isValidZone(tz);
}

/** Local calendar date (YYYY-MM-DD) of an instant in a timezone. */
export function localDate(at: Date, tz: string): string {
  return DateTime.fromJSDate(at, { zone: tz }).toISODate()!;
}

/** Minutes after local midnight for an instant in a timezone. */
export function localMinuteOfDay(at: Date, tz: string): number {
  const dt = DateTime.fromJSDate(at, { zone: tz });
  return dt.hour * 60 + dt.minute;
}

/**
 * The UTC instant for `minute` minutes after local midnight on `date` in `tz`.
 * Uses wall-clock arithmetic, so 09:00 is 09:00 on DST-transition days too.
 * Wall times inside a DST gap are shifted forward by Luxon.
 */
export function atLocalMinute(date: string, minute: number, tz: string): Date {
  const base = DateTime.fromISO(date, { zone: tz }).startOf("day");
  return base.set({ hour: Math.floor(minute / 60), minute: minute % 60 }).toJSDate();
}

/** [start, end) of a local calendar day in UTC. 23 or 25 hours long on DST days. */
export function localDayBounds(date: string, tz: string): { start: Date; end: Date } {
  const start = DateTime.fromISO(date, { zone: tz }).startOf("day");
  return { start: start.toJSDate(), end: start.plus({ days: 1 }).toJSDate() };
}

export function addLocalDays(date: string, days: number, tz: string): string {
  return DateTime.fromISO(date, { zone: tz }).plus({ days }).toISODate()!;
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MINUTE);
}

export function addMinutes(d: Date, min: number): Date {
  return new Date(d.getTime() + min * MINUTE);
}

export function ceilToMinutes(d: Date, step: number): Date {
  const ms = step * MINUTE;
  return new Date(Math.ceil(d.getTime() / ms) * ms);
}

/** Whether a local minute-of-day falls in a [start, end) window that may cross midnight. */
export function minuteInWindow(minute: number, startMin: number, endMin: number): boolean {
  if (startMin === endMin) return false;
  return startMin < endMin
    ? minute >= startMin && minute < endMin
    : minute >= startMin || minute < endMin;
}

export function isInQuietHours(
  at: Date,
  tz: string,
  quiet: { enabled: boolean; startMin: number; endMin: number },
): boolean {
  if (!quiet.enabled) return false;
  return minuteInWindow(localMinuteOfDay(at, tz), quiet.startMin, quiet.endMin);
}

/** The first instant at or after `at` that is outside quiet hours. */
export function nextQuietEnd(
  at: Date,
  tz: string,
  quiet: { enabled: boolean; startMin: number; endMin: number },
): Date {
  if (!isInQuietHours(at, tz, quiet)) return at;
  const today = localDate(at, tz);
  const minute = localMinuteOfDay(at, tz);
  // Crossing midnight and we're before midnight → quiet ends tomorrow.
  const endsTomorrow = quiet.startMin > quiet.endMin && minute >= quiet.startMin;
  const date = endsTomorrow ? addLocalDays(today, 1, tz) : today;
  return atLocalMinute(date, quiet.endMin, tz);
}

export interface Interval {
  start: Date;
  end: Date;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Merge overlapping/adjacent intervals. */
export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = [...list].sort((x, y) => x.start.getTime() - y.start.getTime());
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end) {
      if (iv.end > last.end) last.end = iv.end;
    } else {
      out.push({ start: new Date(iv.start), end: new Date(iv.end) });
    }
  }
  return out;
}

/** Subtract busy intervals from a window, returning free intervals. */
export function freeIntervals(window: Interval, busy: Interval[]): Interval[] {
  const merged = mergeIntervals(busy.filter((b) => overlaps(b, window)));
  const out: Interval[] = [];
  let cursor = window.start;
  for (const b of merged) {
    if (b.start > cursor) out.push({ start: cursor, end: b.start < window.end ? b.start : window.end });
    if (b.end > cursor) cursor = b.end;
    if (cursor >= window.end) break;
  }
  if (cursor < window.end) out.push({ start: cursor, end: window.end });
  return out.filter((iv) => iv.end > iv.start);
}

export function formatLocalTime(at: Date, tz: string, locale = "en-US"): string {
  return DateTime.fromJSDate(at, { zone: tz }).setLocale(locale).toLocaleString(DateTime.TIME_SIMPLE);
}

export function formatLocalDateTime(at: Date, tz: string, locale = "en-US"): string {
  return DateTime.fromJSDate(at, { zone: tz })
    .setLocale(locale)
    .toLocaleString({ weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function parseHHMM(value: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!m) throw new Error(`Invalid time "${value}", expected HH:MM`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function toHHMM(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}
