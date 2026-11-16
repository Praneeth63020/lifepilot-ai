import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertTriangle, ChevronLeft, ChevronRight, ExternalLink, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { CalendarEventDTO, ConflictDTO, DailyPlanDTO, TaskDTO } from "@lifepilot/shared";
import { api, errorMessage } from "../api";
import { CalendarMonth } from "../components/CalendarMonth";
import { CalendarUpcoming } from "../components/CalendarUpcoming";
import { TimeGrid, TimeGridLegend, type TimeGridItem } from "../components/TimeGrid";
import { useToast } from "../components/toast";
import { Badge, Button, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Textarea, Toggle, cardClass, useTabs } from "../components/ui";
import { addDaysISO, fmtDate, fmtDateTime, fmtTime, localISODate, minutesLabel, zonedToISO } from "../lib/format";
import { useSession, useTz } from "../session";

type View = "day" | "week" | "month";
const VIEWS: readonly View[] = ["day", "week", "month"];

function weekday(date: string) {
  return new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
}

function rangeFor(view: View, anchor: string): { days: string[] } {
  if (view === "day") return { days: [anchor] };
  if (view === "week") {
    const start = addDaysISO(anchor, -((weekday(anchor) + 6) % 7)); // Monday
    return { days: Array.from({ length: 7 }, (_, i) => addDaysISO(start, i)) };
  }
  const first = `${anchor.slice(0, 7)}-01`;
  const start = addDaysISO(first, -((weekday(first) + 6) % 7));
  return { days: Array.from({ length: 42 }, (_, i) => addDaysISO(start, i)) };
}

function sourceBadge(e: CalendarEventDTO) {
  if (e.source === "google") return <Badge title="Imported from Google Calendar (read-only)">Google</Badge>;
  if (e.source === "demo") return <Badge tone="warn" title="Synthetic demo event">Demo</Badge>;
  return <Badge tone="accent" title="Created in LifePilot">Local</Badge>;
}

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function CalendarPage() {
  const tz = useTz();
  const { me } = useSession();
  const prefs = me?.preferences;
  const navigate = useNavigate();
  const now = useNow();
  const today = localISODate(now, tz);
  const [view, setView] = useState<View>("week");
  const viewTabs = useTabs("calendar-view", VIEWS, view, setView);
  const [anchor, setAnchor] = useState(today);
  const [selected, setSelected] = useState<CalendarEventDTO | null>(null);
  const [creating, setCreating] = useState(false);
  const { days } = rangeFor(view, anchor);
  const from = zonedToISO(days[0]!, "00:00", tz);
  const to = zonedToISO(addDaysISO(days[days.length - 1]!, 1), "00:00", tz);

  const events = useQuery({ queryKey: ["events", from, to], queryFn: () => api.get<{ items: CalendarEventDTO[] }>("/calendar/events", { from, to }) });
  const conflicts = useQuery({ queryKey: ["conflicts", from, to], queryFn: () => api.get<{ items: ConflictDTO[] }>("/calendar/conflicts", { from, to }) });
  const tasks = useQuery({ queryKey: ["tasks", "due-range", to], queryFn: () => api.get<{ items: TaskDTO[] }>("/tasks", { status: "open", dueBefore: to, limit: 200 }) });
  const plan = useQuery({ queryKey: ["plan", anchor], queryFn: () => api.get<{ plan: DailyPlanDTO | null }>("/plans/current", { date: anchor }), enabled: view === "day" });

  const conflictList = conflicts.data?.items ?? [];
  const conflictIds = useMemo(() => new Set((conflicts.data?.items ?? []).flatMap((c) => [c.a.id, c.b.id])), [conflicts.data]);
  const byDay = useMemo(() => {
    const m = new Map<string, { events: CalendarEventDTO[]; tasks: TaskDTO[] }>();
    for (const d of days) m.set(d, { events: [], tasks: [] });
    for (const e of events.data?.items ?? []) {
      // An event appears on every local day it touches.
      for (const d of days) {
        const ds = zonedToISO(d, "00:00", tz);
        const de = zonedToISO(addDaysISO(d, 1), "00:00", tz);
        if (e.startAt < de && e.endAt > ds) m.get(d)!.events.push(e);
      }
    }
    for (const t of tasks.data?.items ?? []) if (t.dueAt) m.get(localISODate(new Date(t.dueAt), tz))?.tasks.push(t);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.data, tasks.data, days.join(), tz]);

  const activePlan = view === "day" && plan.data?.plan && (plan.data.plan.status === "proposed" || plan.data.plan.status === "accepted") ? plan.data.plan : null;

  const gridItems = useMemo<TimeGridItem[]>(() => {
    if (view === "month") return [];
    const out: TimeGridItem[] = (events.data?.items ?? []).map((e) => ({
      id: e.id,
      title: e.title,
      startAt: e.startAt,
      endAt: e.endAt,
      allDay: e.allDay,
      kind: "event",
      conflict: conflictIds.has(e.id),
      detail: [e.needsPrep ? `prep ${e.prepMin} min` : null, e.location].filter(Boolean).join(" · ") || undefined,
      onSelect: () => setSelected(e),
    }));
    for (const t of tasks.data?.items ?? []) {
      if (!t.dueAt) continue;
      out.push({ id: `due-${t.id}`, title: t.title, startAt: t.dueAt, endAt: t.dueAt, kind: "due", day: localISODate(new Date(t.dueAt), tz), timeLabel: `Due ${fmtTime(t.dueAt, tz)}` });
    }
    for (const i of activePlan?.items ?? []) {
      if (i.isFact) continue; // events are already on the grid
      out.push({
        id: `plan-${i.id}`,
        title: i.title,
        startAt: i.startAt,
        endAt: i.endAt,
        kind: i.kind === "event" ? "task" : i.kind,
        proposed: activePlan!.status !== "accepted",
        detail: activePlan!.status === "accepted" ? "accepted plan" : "proposed plan",
        kindLabel: `${i.kind === "task" ? "Planned focus block" : i.kind === "prep" ? "Planned preparation" : "Planned break"} (not on your calendar)`,
        onSelect: () => navigate(`/app/planner?date=${activePlan!.date}`),
      });
    }
    return out;
  }, [view, events.data, tasks.data, activePlan, conflictIds, tz, navigate]);

  const step = (dir: number) => {
    if (view === "day") setAnchor(addDaysISO(anchor, dir));
    else if (view === "week") setAnchor(addDaysISO(anchor, dir * 7));
    else {
      const [y, mo] = anchor.split("-").map(Number);
      const d = new Date(Date.UTC(y!, mo! - 1 + dir, 1));
      setAnchor(d.toISOString().slice(0, 10));
    }
  };
  const title =
    view === "month"
      ? fmtDate(zonedToISO(anchor, "12:00", tz), tz, { month: "long", year: "numeric" })
      : view === "week"
        ? `${fmtDate(zonedToISO(days[0]!, "12:00", tz), tz, { month: "short", day: "numeric" })} – ${fmtDate(zonedToISO(days[6]!, "12:00", tz), tz, { month: "short", day: "numeric", year: "numeric" })}`
        : fmtDate(zonedToISO(anchor, "12:00", tz), tz, { weekday: "long", month: "long", day: "numeric" });
  const inRange = days.includes(today);

  // Range summary from loaded data only.
  const rangeEvents = (events.data?.items ?? []).filter((e) => !e.allDay);
  const busyMin = rangeEvents.reduce((s, e) => s + Math.max(0, Math.round((Math.min(new Date(e.endAt).getTime(), new Date(to).getTime()) - Math.max(new Date(e.startAt).getTime(), new Date(from).getTime())) / 60000)), 0);
  const dueCount = [...byDay.values()].reduce((s, c) => s + c.tasks.length, 0);
  const prepCount = (events.data?.items ?? []).filter((e) => e.needsPrep).length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Calendar"
        title={title}
        subtitle="Imported events are read-only. LifePilot suggests changes; it never edits your Google Calendar."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-xl border border-line bg-surface p-0.5 shadow-card">
              <Button size="sm" variant="ghost" aria-label="Previous" onClick={() => step(-1)}><ChevronLeft className="size-4" /></Button>
              <Button size="sm" variant="ghost" onClick={() => setAnchor(today)} disabled={inRange && (view !== "day" || anchor === today)} className="disabled:opacity-60">Today</Button>
              <Button size="sm" variant="ghost" aria-label="Next" onClick={() => step(1)}><ChevronRight className="size-4" /></Button>
            </div>
            <div role="tablist" aria-label="View" className="flex rounded-xl border border-line bg-surface p-0.5 shadow-card">
              {VIEWS.map((v) => (
                <button key={v} {...viewTabs.tabProps(v)} className={clsx("h-8 rounded-[10px] px-3 text-sm font-medium capitalize transition-colors", view === v ? "bg-ink text-canvas" : "text-muted hover:bg-surface-2 hover:text-ink")}>
                  {v}
                </button>
              ))}
            </div>
            <Button variant="primary" onClick={() => setCreating(true)}><Plus className="size-4" /> New event</Button>
          </div>
        }
      />

      {conflictList.length > 0 && (
        <div className="rounded-[var(--radius-card)] border border-danger/30 bg-danger/[0.06] p-4 text-sm">
          <p className="flex items-center gap-2 font-semibold text-danger">
            <AlertTriangle className="size-4" aria-hidden /> {conflictList.length} conflict{conflictList.length > 1 ? "s" : ""} in this range
          </p>
          <ul className="mt-2 grid gap-2 lg:grid-cols-2">
            {conflictList.map((c) => (
              <li key={c.a.id + c.b.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-danger/20 bg-surface px-3 py-2">
                <span className="min-w-0 text-ink">
                  <span className="font-medium">"{c.a.title}"</span> overlaps <span className="font-medium">"{c.b.title}"</span>
                  <span className="block text-xs text-muted">by {c.overlapMinutes} min · {fmtDateTime(c.overlapStart, tz)}</span>
                </span>
                <button className="shrink-0 rounded-lg px-2 py-1 text-sm font-medium text-accent-strong underline-offset-2 hover:bg-accent-soft hover:underline" onClick={() => setSelected((events.data?.items ?? []).find((e) => e.id === c.b.id) ?? null)}>
                  suggest new times
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <section {...viewTabs.panelProps} className={clsx(cardClass, "min-w-0 overflow-hidden")}>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-3 sm:px-5">
            <p className="text-sm text-muted">
              {events.data ? (
                <>
                  <span className="font-medium text-ink">{events.data.items.length}</span> event{events.data.items.length === 1 ? "" : "s"}
                  {busyMin > 0 && <> · {minutesLabel(busyMin)} booked</>}
                  {dueCount > 0 && <> · <span className="font-medium text-ink">{dueCount}</span> task{dueCount === 1 ? "" : "s"} due</>}
                  {prepCount > 0 && <> · {prepCount} need{prepCount === 1 ? "s" : ""} prep</>}
                  {conflictList.length > 0 && <> · <span className="font-medium text-danger">{conflictList.length} conflict{conflictList.length === 1 ? "" : "s"}</span></>}
                </>
              ) : (
                " "
              )}
            </p>
            {view !== "month" && <TimeGridLegend kinds={activePlan ? ["event", "task", "prep", "break", "due"] : ["event", "due"]} proposed={activePlan?.status === "proposed"} conflict={conflictList.length > 0} />}
          </div>

          {events.isLoading && <div className="px-5"><Spinner label="Loading events" /></div>}
          {events.error && <div className="p-4"><ErrorNote error={events.error} onRetry={() => events.refetch()} /></div>}

          {events.data && view !== "month" && (
            <div className="px-2 pb-3 pt-1 sm:px-3">
              {view === "day" && activePlan && (
                <p className="px-2 pb-2 pt-1 text-xs text-muted">
                  {activePlan.status === "accepted" ? "Your accepted plan" : "A proposed plan"} for this day is shown alongside your events — plan blocks aren't on your calendar.{" "}
                  <button type="button" className="font-medium text-accent-strong hover:underline" onClick={() => navigate(`/app/planner?date=${activePlan.date}`)}>Open in planner</button>
                </p>
              )}
              <TimeGrid
                days={days}
                tz={tz}
                today={today}
                now={now}
                items={gridItems}
                startMin={prefs?.workStartMin ?? 7 * 60}
                endMin={prefs?.workEndMin ?? 21 * 60}
                workStartMin={prefs?.workStartMin}
                workEndMin={prefs?.workEndMin}
                hourHeight={view === "day" ? 64 : 56}
                minColumnWidth={view === "week" ? 88 : 0}
                onDayClick={view === "week" ? (d) => { setAnchor(d); setView("day"); } : undefined}
                emptyLabel="No events — free day"
              />
            </div>
          )}

          {events.data && view === "month" && (
            <CalendarMonth
              days={days}
              anchor={anchor}
              today={today}
              tz={tz}
              byDay={byDay}
              conflictIds={conflictIds}
              onOpenDay={(d) => { setAnchor(d); setView("day"); }}
              onSelectEvent={setSelected}
            />
          )}
        </section>

        <aside aria-label="Upcoming events and tasks" className="min-w-0">
          <CalendarUpcoming tz={tz} today={today} now={now} onSelect={setSelected} />
        </aside>
      </div>

      {selected && <EventModal key={selected.id} event={selected} tz={tz} onClose={() => setSelected(null)} />}
      {creating && <NewEventModal tz={tz} defaultDate={anchor} onClose={() => setCreating(false)} />}
    </div>
  );
}

function EventModal({ event, tz, onClose }: { event: CalendarEventDTO; tz: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [needsPrep, setNeedsPrep] = useState(event.needsPrep);
  const [prepMin, setPrepMin] = useState(event.prepMin);
  const alts = useQuery({ queryKey: ["alternatives", event.id], queryFn: () => api.get<{ suggestions: { startAt: string; endAt: string }[]; note: string }>(`/calendar/events/${event.id}/alternatives`) });
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/calendar/events/${event.id}`, body),
    onSuccess: () => { qc.invalidateQueries(); toast({ title: "Event updated", tone: "success" }); onClose(); },
    onError: (e) => toast({ title: "Couldn't update event", body: errorMessage(e), tone: "error" }),
  });
  const del = useMutation({
    mutationFn: () => api.del(`/calendar/events/${event.id}`),
    onSuccess: () => { qc.invalidateQueries(); toast({ title: "Event deleted", tone: "success" }); onClose(); },
    onError: (e) => toast({ title: "Couldn't delete event", body: errorMessage(e), tone: "error" }),
  });
  return (
    <Modal open onClose={onClose} title={event.title} footer={<>
      {event.source === "local" && <Button variant="danger" loading={del.isPending} onClick={() => confirm("Delete this event?") && del.mutate()}>Delete</Button>}
      <Button variant="primary" loading={save.isPending} onClick={() => save.mutate({ needsPrep, prepMin })}>Save</Button>
    </>}>
      <div className="flex flex-col gap-3 text-sm">
        <p className="flex flex-wrap items-center gap-2">
          {event.allDay ? `${fmtDate(event.startAt, tz)} · all day` : `${fmtDateTime(event.startAt, tz)} – ${fmtTime(event.endAt, tz)}`} {sourceBadge(event)}
        </p>
        {event.location && <p className="text-muted">{event.location}</p>}
        {event.description && <p className="whitespace-pre-line text-muted">{event.description}</p>}
        {event.htmlLink && <a href={event.htmlLink} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-accent-strong">Open in Google Calendar <ExternalLink className="size-3.5" /></a>}
        {event.readOnly && <p className="rounded-lg bg-surface-2 p-2 text-xs text-muted">This event is {event.source === "demo" ? "synthetic demo data" : "imported from Google Calendar"}. Its time and details are read-only here.</p>}
        <Toggle checked={needsPrep} onChange={setNeedsPrep} label="Needs preparation" description="Adds a prep block in your plan and a reminder before it starts." />
        {needsPrep && (
          <Field label="Preparation time" htmlFor="prep">
            <Select id="prep" value={prepMin} onChange={(e) => setPrepMin(Number(e.target.value))}>
              {[10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}
            </Select>
          </Field>
        )}
        {!event.allDay && (
          <div>
            <p className="mb-1 font-medium">Alternative times</p>
            {alts.isLoading ? <Spinner label="Finding free slots" /> : alts.data?.suggestions.length ? (
              <ul className="flex flex-col gap-1">
                {alts.data.suggestions.map((s) => (
                  <li key={s.startAt} className="flex items-center justify-between gap-2 rounded-lg border border-line px-2 py-1">
                    <span>{fmtDateTime(s.startAt, tz)} – {fmtTime(s.endAt, tz)}</span>
                    {event.source === "local" && <Button size="sm" variant="ghost" onClick={() => save.mutate({ startAt: s.startAt, endAt: s.endAt })}>Move here</Button>}
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs text-muted">No free slot of the same length in your working hours over the next few days.</p>}
            {alts.data?.note && <p className="mt-1 text-xs text-muted">{alts.data.note}</p>}
          </div>
        )}
      </div>
    </Modal>
  );
}

function NewEventModal({ tz, defaultDate, onClose }: { tz: string; defaultDate: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("11:00");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [needsPrep, setNeedsPrep] = useState(false);
  const m = useMutation({
    mutationFn: () => api.post("/calendar/events", { title, startAt: zonedToISO(date, start, tz), endAt: zonedToISO(date, end, tz), location: location || null, description: description || null, needsPrep }),
    onSuccess: () => { qc.invalidateQueries(); toast({ title: "Event added to LifePilot", body: "It's stored in LifePilot only, not in Google Calendar.", tone: "success" }); onClose(); },
  });
  return (
    <Modal open onClose={onClose} title="New event" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!title.trim()} loading={m.isPending} onClick={() => m.mutate()}>Add event</Button></>}>
      <div className="flex flex-col gap-3">
        {m.error && <ErrorNote error={new Error(errorMessage(m.error))} />}
        <Field label="Title" htmlFor="e-t"><Input id="e-t" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Date" htmlFor="e-d"><Input id="e-d" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Start" htmlFor="e-s"><Input id="e-s" type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="End" htmlFor="e-e"><Input id="e-e" type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        <Field label="Location" htmlFor="e-l"><Input id="e-l" value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
        <Field label="Notes" htmlFor="e-n"><Textarea id="e-n" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Toggle checked={needsPrep} onChange={setNeedsPrep} label="Needs preparation" />
      </div>
    </Modal>
  );
}
