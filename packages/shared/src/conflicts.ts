import {
  addLocalDays,
  addMinutes,
  atLocalMinute,
  ceilToMinutes,
  freeIntervals,
  localDate,
  minutesBetween,
  type Interval,
} from "./time.js";

export interface ConflictEvent {
  id: string;
  title: string;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  status?: string;
}

export interface Conflict {
  a: { id: string; title: string };
  b: { id: string; title: string };
  overlapStart: Date;
  overlapEnd: Date;
  overlapMinutes: number;
}

/** Pairwise overlapping timed events. All-day and cancelled events never conflict. */
export function detectConflicts(events: ConflictEvent[]): Conflict[] {
  const timed = events
    .filter((e) => !e.allDay && e.status !== "cancelled" && e.endAt > e.startAt)
    .sort((x, y) => x.startAt.getTime() - y.startAt.getTime());
  const out: Conflict[] = [];
  for (let i = 0; i < timed.length; i++) {
    const a = timed[i]!;
    for (let j = i + 1; j < timed.length; j++) {
      const b = timed[j]!;
      if (b.startAt >= a.endAt) break; // sorted by start: no later event can overlap a
      const overlapStart = b.startAt;
      const overlapEnd = a.endAt < b.endAt ? a.endAt : b.endAt;
      out.push({
        a: { id: a.id, title: a.title },
        b: { id: b.id, title: b.title },
        overlapStart,
        overlapEnd,
        overlapMinutes: minutesBetween(overlapStart, overlapEnd),
      });
    }
  }
  return out;
}

/**
 * Suggest alternative start times for `target` (same duration) that avoid every other
 * timed event, within working hours, from now across the next `days` local days.
 * Suggestions only — nothing is moved.
 */
export function proposeAlternativeSlots(input: {
  target: ConflictEvent;
  events: ConflictEvent[];
  now: Date;
  prefs: { timezone: string; workStartMin: number; workEndMin: number; bufferMin: number };
  days?: number;
  max?: number;
  stepMin?: number;
}): Interval[] {
  const { target, prefs } = input;
  const tz = prefs.timezone;
  const durationMin = minutesBetween(target.startAt, target.endAt);
  const stepMin = input.stepMin ?? 15;
  const max = input.max ?? 3;
  const others = input.events.filter((e) => e.id !== target.id && !e.allDay && e.status !== "cancelled");
  const busy = others.map((e) => ({ start: addMinutes(e.startAt, -prefs.bufferMin), end: addMinutes(e.endAt, prefs.bufferMin) }));
  const startDate = localDate(target.startAt > input.now ? target.startAt : input.now, tz);
  const out: Interval[] = [];
  for (let d = 0; d < (input.days ?? 3) && out.length < max; d++) {
    const date = addLocalDays(startDate, d, tz);
    let windowStart = atLocalMinute(date, prefs.workStartMin, tz);
    const windowEnd = atLocalMinute(date, prefs.workEndMin, tz);
    if (windowStart < input.now) windowStart = ceilToMinutes(input.now, stepMin);
    if (windowStart >= windowEnd) continue;
    for (const free of freeIntervals({ start: windowStart, end: windowEnd }, busy)) {
      let s = ceilToMinutes(free.start, stepMin);
      while (out.length < max && addMinutes(s, durationMin) <= free.end) {
        const candidate = { start: s, end: addMinutes(s, durationMin) };
        out.push(candidate);
        // Spread suggestions out: the next one starts at least an hour after this one ends.
        s = addMinutes(candidate.end, 60);
      }
      if (out.length >= max) break;
    }
  }
  return out;
}
