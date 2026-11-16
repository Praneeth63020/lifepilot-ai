import clsx from "clsx";
import type { CalendarEventDTO, TaskDTO } from "@lifepilot/shared";
import { fmtDate, zonedToISO } from "../lib/format";
import { Chip, type TimeGridItem } from "./TimeGrid";

const MAX_CHIPS = 3;

/** Month grid (Monday–Sunday rows) with event chips, tasks due and "+N more". */
export function CalendarMonth({
  days,
  anchor,
  today,
  tz,
  byDay,
  conflictIds,
  onOpenDay,
  onSelectEvent,
}: {
  days: string[];
  anchor: string;
  today: string;
  tz: string;
  byDay: Map<string, { events: CalendarEventDTO[]; tasks: TaskDTO[] }>;
  conflictIds: Set<string>;
  onOpenDay: (day: string) => void;
  onSelectEvent: (e: CalendarEventDTO) => void;
}) {
  const label = (d: string, opts: Intl.DateTimeFormatOptions) => fmtDate(zonedToISO(d, "12:00", tz), tz, opts);
  return (
    <div>
      <div className="grid grid-cols-7 border-b border-line" aria-hidden>
        {days.slice(0, 7).map((d) => (
          <div key={d} className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-muted sm:text-left">
            {label(d, { weekday: "short" })}
          </div>
        ))}
      </div>
      <ol aria-label={`Days in ${label(anchor, { month: "long", year: "numeric" })}`} className="grid grid-cols-7">
        {days.map((d, idx) => {
          const cell = byDay.get(d) ?? { events: [], tasks: [] };
          const inMonth = d.slice(0, 7) === anchor.slice(0, 7);
          const isToday = d === today;
          const events = [...cell.events].sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startAt.localeCompare(b.startAt));
          const chips: TimeGridItem[] = events.map((e) => ({
            id: e.id,
            title: e.title,
            startAt: e.startAt,
            endAt: e.endAt,
            allDay: e.allDay,
            kind: "event",
            conflict: conflictIds.has(e.id),
            onSelect: () => onSelectEvent(e),
          }));
          if (cell.tasks.length) {
            chips.push({
              id: `due-${d}`,
              title: cell.tasks.length === 1 ? cell.tasks[0]!.title : `${cell.tasks.length} tasks due`,
              startAt: cell.tasks[0]!.dueAt!,
              endAt: cell.tasks[0]!.dueAt!,
              kind: "due",
              timeLabel: cell.tasks.length === 1 ? "Due" : "",
            });
          }
          const shown = chips.length > MAX_CHIPS ? chips.slice(0, MAX_CHIPS - 1) : chips;
          const more = chips.length - shown.length;
          const full = label(d, { weekday: "long", month: "long", day: "numeric" });
          return (
            <li
              key={d}
              className={clsx(
                "flex min-h-16 min-w-0 flex-col gap-1 border-line p-1 sm:min-h-28 sm:p-1.5",
                idx % 7 !== 0 && "border-l",
                idx >= 7 && "border-t",
                !inMonth && "bg-surface-2/60",
                isToday && "bg-accent-soft/40",
              )}
            >
              <button
                type="button"
                onClick={() => onOpenDay(d)}
                aria-label={`Open ${full}${isToday ? " (today)" : ""}: ${cell.events.length} event${cell.events.length === 1 ? "" : "s"}${cell.tasks.length ? `, ${cell.tasks.length} due` : ""}`}
                className="flex flex-col items-center gap-1 rounded-lg p-0.5 hover:bg-surface-2 sm:flex-row sm:items-start"
              >
                <span
                  className={clsx(
                    "grid size-7 place-items-center rounded-full text-sm font-semibold tabular-nums",
                    isToday ? "bg-accent text-accent-ink" : inMonth ? "text-ink" : "text-muted",
                  )}
                >
                  {Number(d.slice(8))}
                </span>
                {/* Phones: dots instead of chips */}
                <span aria-hidden className="flex flex-wrap justify-center gap-0.5 sm:hidden">
                  {events.slice(0, 4).map((e) => <span key={e.id} className={clsx("size-1.5 rounded-full", conflictIds.has(e.id) ? "bg-danger" : "bg-blue")} />)}
                  {cell.tasks.length > 0 && <span className="size-1.5 rounded-full bg-accent" />}
                </span>
              </button>
              <ul className="hidden min-w-0 flex-col gap-0.5 sm:flex">
                {shown.map((c) => (
                  <li key={c.id} className="min-w-0">
                    <Chip item={c} tz={tz} showTime={c.kind !== "event"} />
                  </li>
                ))}
                {more > 0 && (
                  <li>
                    <button type="button" onClick={() => onOpenDay(d)} aria-label={`${more} more on ${full}`} className="rounded px-1 text-[11px] font-medium text-muted hover:bg-surface-2 hover:text-ink">
                      +{more} more
                    </button>
                  </li>
                )}
              </ul>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
