import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertTriangle, CalendarClock, Flag, MapPin, NotebookPen } from "lucide-react";
import { Link } from "react-router-dom";
import type { CalendarEventDTO, ConflictDTO, TaskDTO } from "@lifepilot/shared";
import { api } from "../api";
import { addDaysISO, fmtDate, fmtTime, localISODate, zonedToISO } from "../lib/format";
import { Badge, Card, ErrorNote, PriorityBadge, Spinner } from "./ui";

const DAYS_AHEAD = 7;

/** "Upcoming" side panel: the next events (with prep and conflicts) and the tasks coming due. */
export function CalendarUpcoming({ tz, today, now, onSelect }: { tz: string; today: string; now: Date; onSelect: (e: CalendarEventDTO) => void }) {
  const from = zonedToISO(today, "00:00", tz);
  const to = zonedToISO(addDaysISO(today, DAYS_AHEAD + 1), "00:00", tz);
  const events = useQuery({ queryKey: ["events", from, to], queryFn: () => api.get<{ items: CalendarEventDTO[] }>("/calendar/events", { from, to }) });
  const conflicts = useQuery({ queryKey: ["conflicts", from, to], queryFn: () => api.get<{ items: ConflictDTO[] }>("/calendar/conflicts", { from, to }) });
  const tasks = useQuery({ queryKey: ["tasks", "due-range", to], queryFn: () => api.get<{ items: TaskDTO[] }>("/tasks", { status: "open", dueBefore: to, limit: 200 }) });

  const conflictIds = new Set((conflicts.data?.items ?? []).flatMap((c) => [c.a.id, c.b.id]));
  const upcoming = (events.data?.items ?? [])
    .filter((e) => new Date(e.endAt) > now)
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
    .slice(0, 10);
  const groups = new Map<string, CalendarEventDTO[]>();
  for (const e of upcoming) {
    const d = new Date(e.startAt) < now ? today : localISODate(new Date(e.startAt), tz);
    groups.set(d, [...(groups.get(d) ?? []), e]);
  }
  const due = (tasks.data?.items ?? [])
    .filter((t) => t.dueAt)
    .sort((a, b) => a.dueAt!.localeCompare(b.dueAt!))
    .slice(0, 8);
  const dayName = (d: string) => (d === today ? "Today" : d === addDaysISO(today, 1) ? "Tomorrow" : fmtDate(zonedToISO(d, "12:00", tz), tz, { weekday: "long", month: "short", day: "numeric" }));

  return (
    <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2 xl:grid-cols-1">
      <Card title="Upcoming" icon={<CalendarClock />} subtitle={`Events in the next ${DAYS_AHEAD} days`}>
        {events.isLoading && <Spinner label="Loading events" />}
        {events.error && <ErrorNote error={events.error} onRetry={() => events.refetch()} />}
        {events.data && upcoming.length === 0 && <p className="text-sm text-muted">Nothing on your calendar this week.</p>}
        <div className="flex flex-col gap-4">
          {[...groups.entries()].map(([d, list]) => (
            <section key={d}>
              <h3 className={clsx("mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em]", d === today ? "text-accent-strong" : "text-muted")}>{dayName(d)}</h3>
              <ul className="flex flex-col gap-1">
                {list.map((e) => {
                  const live = new Date(e.startAt) <= now;
                  return (
                    <li key={e.id}>
                      <button type="button" onClick={() => onSelect(e)} className="flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left hover:bg-surface-2">
                        <span className="w-16 shrink-0 pt-px text-xs font-medium tabular-nums text-muted">{e.allDay ? "All day" : fmtTime(e.startAt, tz)}</span>
                        <span className={clsx("mt-0.5 w-[3px] self-stretch rounded-full", conflictIds.has(e.id) ? "bg-danger" : "bg-blue")} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink">{e.title}</span>
                          {!e.allDay && <span className="block text-xs text-muted">{live ? `Now · until ${fmtTime(e.endAt, tz)}` : `until ${fmtTime(e.endAt, tz)}`}</span>}
                          {e.location && (
                            <span className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted">
                              <MapPin aria-hidden className="size-3 shrink-0" /> <span className="truncate">{e.location}</span>
                            </span>
                          )}
                          {(e.needsPrep || conflictIds.has(e.id)) && (
                            <span className="mt-1 flex flex-wrap gap-1">
                              {e.needsPrep && (
                                <Badge tone="violet">
                                  <NotebookPen aria-hidden className="size-3" /> Prep {e.prepMin} min
                                </Badge>
                              )}
                              {conflictIds.has(e.id) && (
                                <Badge tone="danger">
                                  <AlertTriangle aria-hidden className="size-3" /> Conflict
                                </Badge>
                              )}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </Card>

      <Card title="Tasks due" icon={<Flag />} subtitle="Next 7 days, overdue first" action={<Link to="/app/tasks" className="shrink-0 whitespace-nowrap text-sm font-medium text-accent-strong hover:underline">All tasks</Link>}>
        {tasks.isLoading && <Spinner label="Loading tasks" />}
        {tasks.error && <ErrorNote error={tasks.error} onRetry={() => tasks.refetch()} />}
        {tasks.data && due.length === 0 && <p className="text-sm text-muted">Nothing due this week.</p>}
        <ul className="flex flex-col divide-y divide-line">
          {due.map((t) => {
            const overdue = new Date(t.dueAt!) < now;
            const dd = localISODate(new Date(t.dueAt!), tz);
            return (
              <li key={t.id} className="flex items-start justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{t.title}</span>
                  <span className={clsx("text-xs", overdue ? "font-medium text-danger" : "text-muted")}>
                    {overdue ? "Overdue · " : ""}
                    {dd === today ? "Today" : dd === addDaysISO(today, 1) ? "Tomorrow" : fmtDate(t.dueAt!, tz)}, {fmtTime(t.dueAt!, tz)}
                    {t.estimateMin ? ` · ${t.estimateMin} min` : ""}
                  </span>
                </span>
                <PriorityBadge priority={t.priority} />
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
