import clsx from "clsx";
import { AlertTriangle, CalendarDays, Coffee, Flag, NotebookPen, Target, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { addDaysISO, fmtDate, fmtTime, isoToZoned, localISODate, parseHHMM, zonedToISO } from "../lib/format";

/**
 * A vertical time grid: hour labels on the left, one column per local day, blocks positioned by
 * their start/end in the user's timezone. Overlapping blocks sit side by side (lane layout),
 * all-day items (and point-in-time items such as task deadlines) go in a row above the grid, and
 * items that cross midnight are clipped to each day they touch.
 *
 * Accessibility: each day column is an ordered list (`aria-label` from `listLabel`), each block a
 * list item whose text carries the title, time and kind — colour is never the only cue. Blocks
 * with `onSelect` are buttons, so they are reachable with the keyboard.
 */

export type TimeGridKind = "event" | "task" | "prep" | "break" | "due";

export interface TimeGridItem {
  id: string;
  title: string;
  /** ISO instants (UTC). For `due` items, start and end may be equal. */
  startAt: string;
  endAt: string;
  kind: TimeGridKind;
  /** Shown in the all-day row instead of the timed grid. */
  allDay?: boolean;
  /** Pin an all-day-row item to one local date (YYYY-MM-DD), e.g. a task's due date. */
  day?: string;
  /** A suggestion that isn't confirmed yet (dashed outline). */
  proposed?: boolean;
  /** Overlaps another item that can't move (danger outline + "Conflict" label). */
  conflict?: boolean;
  /** Short extra text after the time, e.g. "Prep 30 min" or "Google". */
  detail?: string;
  /** Replaces the computed time text (e.g. "Due 2:30 PM"). */
  timeLabel?: string;
  /** Overrides the default kind label read by screen readers and shown in the legend. */
  kindLabel?: string;
  /** Makes the block a button. */
  onSelect?: () => void;
}

export const TIME_GRID_KINDS: Record<TimeGridKind, { label: string; icon: LucideIcon; box: string; bar: string; text: string }> = {
  event: { label: "Calendar event", icon: CalendarDays, box: "border-blue/25 bg-blue/10", bar: "bg-blue", text: "text-blue" },
  task: { label: "Focus block", icon: Target, box: "border-accent/60 bg-accent-soft", bar: "bg-accent", text: "text-accent-strong" },
  prep: { label: "Preparation", icon: NotebookPen, box: "border-violet/30 bg-violet/10", bar: "bg-violet", text: "text-violet" },
  break: { label: "Break", icon: Coffee, box: "border-ok/20 bg-ok/[0.07]", bar: "bg-ok/70", text: "text-ok" },
  due: { label: "Task due", icon: Flag, box: "border-accent/50 bg-accent-soft", bar: "bg-accent", text: "text-accent-strong" },
};

export interface TimeGridProps {
  /** Local dates (YYYY-MM-DD), one column each. */
  days: string[];
  tz: string;
  items: TimeGridItem[];
  /** Today's local date; its column is highlighted and gets the current-time line. */
  today?: string;
  /** Fixed "now" (defaults to a clock that ticks every minute). */
  now?: Date;
  /** Visible range in minutes from midnight (default 07:00–21:00); expands to fit items. */
  startMin?: number;
  endMin?: number;
  /** Working hours; time outside is shaded. Defaults to the visible range. */
  workStartMin?: number;
  workEndMin?: number;
  /** Pixels per hour (default 60). */
  hourHeight?: number;
  /** Minimum width of a day column in px; the grid scrolls sideways when it can't fit. */
  minColumnWidth?: number;
  /** Accessible name of each day's list (default "Events, Mon, Nov 16"). */
  listLabel?: (day: string) => string;
  /** Extra content under each day's header (e.g. a status badge or action). */
  renderDayHeader?: (day: string) => ReactNode;
  /** Makes each day header a button (e.g. open the day view). */
  onDayClick?: (day: string) => void;
  /** Hide the day header row (e.g. a single-day grid with its own title). */
  hideHeader?: boolean;
  /** Text for a day without any items (screen readers; shown faintly in single-day grids). */
  emptyLabel?: string;
  className?: string;
}

interface Seg {
  item: TimeGridItem;
  start: number;
  end: number;
  clippedStart: boolean;
  clippedEnd: boolean;
  lane: number;
  lanes: number;
}

const GUTTER = 56;
const MIN_BLOCK_MIN = 15;

function wallMin(iso: string, tz: string) {
  return parseHHMM(isoToZoned(iso, tz).time);
}

function useMinuteClock(fixed?: Date) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (fixed) return;
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, [fixed]);
  return fixed ?? now;
}

/** Assign side-by-side lanes to overlapping segments (clusters share a lane count). */
function layoutLanes(segs: Omit<Seg, "lane" | "lanes">[]): Seg[] {
  const sorted = [...segs].sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const out: Seg[] = [];
  let cluster: Seg[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    for (const s of cluster) s.lanes = laneEnds.length;
    out.push(...cluster);
    cluster = [];
    laneEnds = [];
  };
  for (const s of sorted) {
    const visEnd = Math.max(s.end, s.start + MIN_BLOCK_MIN);
    if (s.start >= clusterEnd && cluster.length) flush();
    let lane = laneEnds.findIndex((e) => e <= s.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(visEnd);
    } else laneEnds[lane] = visEnd;
    clusterEnd = cluster.length ? Math.max(clusterEnd, visEnd) : visEnd;
    cluster.push({ ...s, lane, lanes: 1 });
  }
  if (cluster.length) flush();
  return out;
}

function hourLabel(h: number) {
  if (h === 24) h = 0;
  return new Intl.DateTimeFormat(undefined, { hour: "numeric" }).format(new Date(2000, 0, 1, h));
}

export function TimeGrid({
  days,
  tz,
  items,
  today,
  now: fixedNow,
  startMin = 7 * 60,
  endMin = 21 * 60,
  workStartMin,
  workEndMin,
  hourHeight = 60,
  minColumnWidth = 0,
  listLabel,
  renderDayHeader,
  onDayClick,
  hideHeader,
  emptyLabel = "Nothing scheduled",
  className,
}: TimeGridProps) {
  const now = useMinuteClock(fixedNow);

  const { timed, allDay, rangeStart, rangeEnd } = useMemo(() => {
    const timed = new Map<string, Seg[]>();
    const allDay = new Map<string, TimeGridItem[]>();
    let lo = Math.floor(startMin / 60) * 60;
    let hi = Math.ceil(endMin / 60) * 60;
    for (const day of days) {
      const ds = new Date(zonedToISO(day, "00:00", tz)).getTime();
      const de = new Date(zonedToISO(addDaysISO(day, 1), "00:00", tz)).getTime();
      const raw: Omit<Seg, "lane" | "lanes">[] = [];
      const top: TimeGridItem[] = [];
      for (const it of items) {
        const s = new Date(it.startAt).getTime();
        const e = new Date(it.endAt).getTime();
        if (it.allDay || it.day) {
          const onDay = it.day ? it.day === day : s < de && e > ds;
          if (onDay) top.push(it);
          continue;
        }
        if (!(s < de && Math.max(e, s + 60_000) > ds)) continue;
        const start = s <= ds ? 0 : wallMin(it.startAt, tz);
        let end = e >= de ? 24 * 60 : wallMin(it.endAt, tz);
        if (end < start) end = 24 * 60; // DST edge / end exactly at the next midnight
        raw.push({ item: it, start, end, clippedStart: s < ds, clippedEnd: e > de });
        lo = Math.min(lo, Math.floor(start / 60) * 60);
        hi = Math.max(hi, Math.ceil(Math.max(end, start + MIN_BLOCK_MIN) / 60) * 60);
      }
      timed.set(day, layoutLanes(raw));
      allDay.set(day, top);
    }
    return { timed, allDay, rangeStart: Math.max(0, lo), rangeEnd: Math.min(24 * 60, Math.max(hi, lo + 60)) };
  }, [days, items, tz, startMin, endMin]);

  const hours = Array.from({ length: (rangeEnd - rangeStart) / 60 + 1 }, (_, i) => rangeStart / 60 + i);
  const pxPerMin = hourHeight / 60;
  const bodyHeight = (rangeEnd - rangeStart) * pxPerMin;
  const hasAllDay = days.some((d) => (allDay.get(d)?.length ?? 0) > 0);
  const nowDay = localISODate(now, tz);
  const nowMin = wallMin(now.toISOString(), tz);
  const showNow = today !== undefined && nowDay === today && days.includes(today) && nowMin >= rangeStart && nowMin <= rangeEnd;
  const cols = { gridTemplateColumns: `${GUTTER}px repeat(${days.length}, minmax(${minColumnWidth}px, 1fr))` };
  const ws = workStartMin ?? rangeStart;
  const we = workEndMin ?? rangeEnd;
  const single = days.length === 1;
  const scrollRef = useRef<HTMLDivElement>(null);
  const daysKey = days.join();
  // When the week doesn't fit, scroll today's column into view (the hour gutter stays pinned).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || single || !today || el.scrollWidth <= el.clientWidth) return;
    const col = el.querySelector<HTMLElement>(`[data-day="${today}"]`);
    if (col) el.scrollLeft = Math.max(0, col.offsetLeft - GUTTER);
  }, [daysKey, today, single]);

  return (
    <div ref={scrollRef} className={clsx("relative overflow-x-auto", className)}>
      <div className="min-w-0" style={{ minWidth: minColumnWidth ? GUTTER + days.length * minColumnWidth : undefined }}>
        {!hideHeader && (
          <div className="grid border-b border-line" style={cols}>
            <div aria-hidden className="sticky left-0 z-30 bg-surface" />
            {days.map((d) => {
              const isToday = d === today;
              const iso = zonedToISO(d, "12:00", tz);
              const head = (
                <>
                  <span className={clsx("text-[11px] font-semibold uppercase tracking-[0.08em]", isToday ? "text-accent-strong" : "text-muted")}>{fmtDate(iso, tz, { weekday: "short" })}</span>
                  <span className={clsx("grid h-8 min-w-8 place-items-center rounded-full px-1.5 font-display text-lg font-semibold leading-none", isToday ? "bg-accent text-accent-ink" : "text-ink")}>{Number(d.slice(8))}</span>
                  {isToday && <span className="sr-only">(today)</span>}
                </>
              );
              return (
                <div key={d} className={clsx("flex min-w-0 flex-col items-center gap-1 border-l border-line px-1 pb-2 pt-1", isToday && "bg-accent-soft/40")}>
                  {onDayClick ? (
                    <button type="button" onClick={() => onDayClick(d)} aria-label={`Open ${fmtDate(iso, tz, { weekday: "long", month: "long", day: "numeric" })}${isToday ? " (today)" : ""}`} className="flex flex-col items-center gap-0.5 rounded-lg px-2 py-0.5 hover:bg-surface-2">
                      {head}
                    </button>
                  ) : (
                    <div className="flex flex-col items-center gap-0.5 py-0.5">{head}</div>
                  )}
                  {renderDayHeader?.(d)}
                </div>
              );
            })}
          </div>
        )}

        {hasAllDay && (
          <div className="grid border-b border-line" style={cols}>
            <div className="sticky left-0 z-30 flex items-center justify-end bg-surface pr-2 text-right text-[11px] font-medium leading-tight text-muted">All day</div>
            {days.map((d) => (
              <ul key={d} aria-label={`All-day, ${fmtDate(zonedToISO(d, "12:00", tz), tz)}`} className={clsx("flex min-w-0 flex-col gap-1 border-l border-line p-1", d === today && "bg-accent-soft/40")}>
                {(allDay.get(d) ?? []).map((it) => (
                  <li key={it.id} className="min-w-0">
                    <Chip item={it} tz={tz} />
                  </li>
                ))}
              </ul>
            ))}
          </div>
        )}

        <div className="grid" style={cols}>
          <div className="sticky left-0 z-30 bg-surface" style={{ height: bodyHeight }} aria-hidden>
            {hours.map((h) => (
              <span
                key={h}
                className={clsx("absolute right-2 whitespace-nowrap text-[11px] leading-none tabular-nums text-muted", h * 60 === rangeStart ? "translate-y-0.5" : h * 60 === rangeEnd ? "-translate-y-full" : "-translate-y-1/2")}
                style={{ top: (h * 60 - rangeStart) * pxPerMin }}
              >
                {hourLabel(h)}
              </span>
            ))}
          </div>
          {days.map((d) => {
            const segs = timed.get(d) ?? [];
            const isToday = d === today;
            return (
              <div
                key={d}
                data-day={d}
                className={clsx("relative border-l border-line", isToday && "bg-accent-soft/25")}
                style={{
                  height: bodyHeight,
                  backgroundImage: `linear-gradient(to bottom, var(--lp-line) 1px, transparent 1px)`,
                  backgroundSize: `100% ${hourHeight}px`,
                }}
              >
                {/* Outside working hours */}
                {ws > rangeStart && <div aria-hidden className="absolute inset-x-0 top-0 bg-surface-2/70" style={{ height: (ws - rangeStart) * pxPerMin }} />}
                {we < rangeEnd && <div aria-hidden className="absolute inset-x-0 bottom-0 bg-surface-2/70" style={{ top: (we - rangeStart) * pxPerMin }} />}
                <ol aria-label={listLabel ? listLabel(d) : `Events, ${fmtDate(zonedToISO(d, "12:00", tz), tz)}`} className="absolute inset-0">
                  {segs.length === 0 && (
                    <li className={clsx("absolute inset-x-0 top-3 text-center text-xs text-muted", single ? "" : "sr-only")}>{emptyLabel}</li>
                  )}
                  {segs.map((s) => (
                    <Block key={s.item.id} seg={s} tz={tz} now={now} rangeStart={rangeStart} pxPerMin={pxPerMin} />
                  ))}
                </ol>
                {showNow && isToday && (
                  <div aria-hidden title={`Now, ${fmtTime(now, tz)}`} className="pointer-events-none absolute inset-x-0 z-20 flex items-center" style={{ top: (nowMin - rangeStart) * pxPerMin }}>
                    <span className="-ml-1 size-2.5 rounded-full bg-danger" />
                    <span className="h-0.5 flex-1 bg-danger" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function timeText(it: TimeGridItem, tz: string) {
  if (it.timeLabel) return it.timeLabel;
  if (it.allDay) return "All day";
  return `${fmtTime(it.startAt, tz)} – ${fmtTime(it.endAt, tz)}`;
}

function Block({ seg, tz, now, rangeStart, pxPerMin }: { seg: Seg; tz: string; now: Date; rangeStart: number; pxPerMin: number }) {
  const it = seg.item;
  const k = TIME_GRID_KINDS[it.kind];
  const Icon = k.icon;
  const top = (seg.start - rangeStart) * pxPerMin;
  const height = Math.max((seg.end - seg.start) * pxPerMin, MIN_BLOCK_MIN * pxPerMin, 18) - 2;
  const short = height < 38;
  const past = new Date(it.endAt) < now;
  const time = timeText(it, tz);
  const Tag = it.onSelect ? "button" : "div";
  return (
    <li
      className="absolute z-10 px-0.5"
      style={{ top: top + 1, height, left: `${(seg.lane / seg.lanes) * 100}%`, width: `${100 / seg.lanes}%` }}
    >
      <Tag
        {...(it.onSelect ? { type: "button" as const, onClick: it.onSelect } : {})}
        title={`${it.title} · ${time}${it.detail ? ` · ${it.detail}` : ""}`}
        className={clsx(
          "relative flex h-full w-full flex-col overflow-hidden rounded-lg border pl-2.5 pr-1.5 text-left text-ink",
          short ? "justify-center py-0" : "py-1",
          k.box,
          it.proposed && "border-dashed",
          it.conflict && "!border-danger ring-1 ring-danger/40",
          seg.clippedStart && "rounded-t-none border-t-0",
          seg.clippedEnd && "rounded-b-none border-b-0",
          past && "opacity-60",
          it.onSelect && "cursor-pointer transition-shadow hover:shadow-card hover:brightness-[0.98]",
        )}
      >
        <span aria-hidden className={clsx("absolute inset-y-0 left-0 w-[3px]", it.conflict ? "bg-danger" : k.bar, it.proposed && "opacity-60")} />
        <span className="sr-only">
          {it.kindLabel ?? k.label}
          {it.proposed ? ", suggested" : ""}
          {it.conflict ? ", conflicts with another event" : ""}
          {seg.clippedStart ? ", continues from the previous day" : ""}
          {seg.clippedEnd ? ", continues into the next day" : ""}:{" "}
        </span>
        {short ? (
          <span className="flex min-w-0 items-baseline gap-1.5 whitespace-nowrap text-[11px] leading-tight">
            {it.conflict && <AlertTriangle aria-hidden className="size-3 shrink-0 self-center text-danger" />}
            <span className={clsx("min-w-[3rem] truncate font-semibold", it.kind === "break" && "font-medium text-muted")}>{it.title}</span>
            <span className="min-w-0 shrink-[4] truncate tabular-nums text-muted">{time}</span>
          </span>
        ) : (
          <>
            <span className={clsx("line-clamp-2 text-xs font-semibold leading-snug", it.kind === "break" && "font-medium text-muted")}>{it.title}</span>
            <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] leading-tight text-muted">
              {it.conflict ? <AlertTriangle aria-hidden className="size-3 shrink-0 text-danger" /> : <Icon aria-hidden className={clsx("size-3 shrink-0", k.text)} />}
              <span className="truncate tabular-nums">
                {time}
                {it.detail ? ` · ${it.detail}` : ""}
              </span>
            </span>
            {it.conflict && height >= 58 && (
              <span className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-danger">
                <AlertTriangle aria-hidden className="size-3" /> Conflict
              </span>
            )}
          </>
        )}
      </Tag>
    </li>
  );
}

/** A compact item for the all-day row, month cells and side lists. */
export function Chip({ item, tz, className, showTime = true }: { item: TimeGridItem; tz: string; className?: string; showTime?: boolean }) {
  const k = TIME_GRID_KINDS[item.kind];
  const Icon = item.conflict ? AlertTriangle : k.icon;
  const time = item.timeLabel ?? (item.allDay ? "" : fmtTime(item.startAt, tz));
  const Tag = item.onSelect ? "button" : "div";
  return (
    <Tag
      {...(item.onSelect ? { type: "button" as const, onClick: item.onSelect } : {})}
      title={`${item.title}${time ? ` · ${time}` : ""}${item.detail ? ` · ${item.detail}` : ""}`}
      className={clsx(
        "flex w-full min-w-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-left text-[11px] leading-tight text-ink",
        k.box,
        item.proposed && "border-dashed",
        item.conflict && "!border-danger",
        item.onSelect && "hover:brightness-[0.97]",
        className,
      )}
    >
      <Icon aria-hidden className={clsx("size-3 shrink-0", item.conflict ? "text-danger" : k.text)} />
      <span className="sr-only">
        {item.kindLabel ?? k.label}
        {item.conflict ? ", conflicts with another event" : ""}
        {!showTime && time ? `, ${time}` : ""}:{" "}
      </span>
      {showTime && time && <span className="shrink-0 tabular-nums text-muted">{time}</span>}
      <span className="truncate font-medium">{item.title}</span>
    </Tag>
  );
}

/** Legend for the block kinds in use (shape and icon, not only colour). */
export function TimeGridLegend({ kinds, proposed, conflict }: { kinds: TimeGridKind[]; proposed?: boolean; conflict?: boolean }) {
  return (
    <ul aria-label="Legend" className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted">
      {kinds.map((kind) => {
        const k = TIME_GRID_KINDS[kind];
        const Icon = k.icon;
        return (
          <li key={kind} className="flex items-center gap-1.5">
            <span aria-hidden className={clsx("grid size-4 place-items-center rounded border", k.box)}>
              <Icon className={clsx("size-2.5", k.text)} />
            </span>
            {k.label}
          </li>
        );
      })}
      {proposed && (
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-4 rounded border border-dashed border-muted/60" /> Suggested, not confirmed
        </li>
      )}
      {conflict && (
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-4 rounded border border-danger ring-1 ring-danger/40" /> Conflict
        </li>
      )}
    </ul>
  );
}
