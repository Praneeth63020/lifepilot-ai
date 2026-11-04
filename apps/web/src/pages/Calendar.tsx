import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertTriangle, ChevronLeft, ChevronRight, ExternalLink, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import type { CalendarEventDTO, ConflictDTO, DailyPlanDTO, TaskDTO } from "@lifepilot/shared";
import { api, errorMessage } from "../api";
import { useToast } from "../components/toast";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Textarea, Toggle } from "../components/ui";
import { addDaysISO, fmtDate, fmtDateTime, fmtTime, localISODate, zonedToISO } from "../lib/format";
import { useTz } from "../session";

type View = "day" | "week" | "month";

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

export function CalendarPage() {
  const tz = useTz();
  const today = localISODate(new Date(), tz);
  const [view, setView] = useState<View>("week");
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
  }, [events.data, tasks.data, days, tz]);

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

  return (
    <div>
      <PageHeader title="Calendar" subtitle="Imported events are read-only. LifePilot suggests changes; it never edits your Google Calendar." actions={<Button variant="primary" onClick={() => setCreating(true)}><Plus className="size-4" /> New event</Button>} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" aria-label="Previous" onClick={() => step(-1)}><ChevronLeft className="size-4" /></Button>
          <Button size="sm" variant="ghost" aria-label="Next" onClick={() => step(1)}><ChevronRight className="size-4" /></Button>
          <Button size="sm" variant="ghost" onClick={() => setAnchor(today)}>Today</Button>
          <h2 className="ml-2 text-base font-semibold">{title}</h2>
        </div>
        <div role="tablist" aria-label="View" className="flex rounded-lg border border-line p-0.5">
          {(["day", "week", "month"] as View[]).map((v) => (
            <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={clsx("rounded-md px-3 py-1 text-sm capitalize", view === v ? "bg-accent-soft text-accent" : "text-muted hover:text-ink")}>
              {v}
            </button>
          ))}
        </div>
      </div>

      {(conflicts.data?.items.length ?? 0) > 0 && (
        <div className="mb-4 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm">
          <p className="flex items-center gap-1.5 font-medium text-danger"><AlertTriangle className="size-4" /> {conflicts.data!.items.length} conflict{conflicts.data!.items.length > 1 ? "s" : ""} in this range</p>
          <ul className="mt-1 text-muted">
            {conflicts.data!.items.map((c) => (
              <li key={c.a.id + c.b.id}>
                "{c.a.title}" overlaps "{c.b.title}" by {c.overlapMinutes} min ({fmtDateTime(c.overlapStart, tz)}) —{" "}
                <button className="text-accent underline-offset-2 hover:underline" onClick={() => setSelected((events.data?.items ?? []).find((e) => e.id === c.b.id) ?? null)}>suggest new times</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {events.isLoading && <Spinner label="Loading events" />}
      {events.error && <ErrorNote error={events.error} onRetry={() => events.refetch()} />}

      {events.data && view !== "month" && (
        <div className={clsx("grid gap-3", view === "week" ? "md:grid-cols-7" : "grid-cols-1")}>
          {days.map((d) => {
            const cell = byDay.get(d)!;
            return (
              <Card key={d} className={clsx("min-h-32 !p-3", d === today && "ring-1 ring-accent/50")}>
                <p className={clsx("mb-2 text-xs font-semibold uppercase tracking-wide", d === today ? "text-accent" : "text-muted")}>{fmtDate(zonedToISO(d, "12:00", tz), tz)}</p>
                <ul className="flex flex-col gap-1.5">
                  {cell.events.map((e) => (
                    <li key={e.id}>
                      <button onClick={() => setSelected(e)} className={clsx("w-full rounded-lg border px-2 py-1.5 text-left text-xs hover:bg-surface-2", conflictIds.has(e.id) ? "border-danger/50" : "border-line")}>
                        <span className="block font-medium text-ink">{e.title}</span>
                        <span className="flex flex-wrap items-center gap-1 text-muted">
                          {e.allDay ? "All day" : `${fmtTime(e.startAt, tz)}–${fmtTime(e.endAt, tz)}`} {sourceBadge(e)}
                          {conflictIds.has(e.id) && <Badge tone="danger">conflict</Badge>}
                        </span>
                      </button>
                    </li>
                  ))}
                  {cell.tasks.map((t) => (
                    <li key={t.id} className="rounded-lg bg-accent-soft px-2 py-1 text-xs">
                      <span className="font-medium text-accent">Task due {fmtTime(t.dueAt!, tz)}</span>
                      <span className="block text-ink">{t.title}</span>
                    </li>
                  ))}
                  {view === "day" &&
                    plan.data?.plan?.items
                      .filter((i) => !i.isFact)
                      .map((i) => (
                        <li key={i.id} className="rounded-lg border border-dashed border-accent/50 px-2 py-1 text-xs">
                          <span className="font-medium">{fmtTime(i.startAt, tz)} · {i.title}</span>
                          <span className="block text-muted">{plan.data!.plan!.status === "accepted" ? "Accepted plan block" : "Proposed plan block"} — not on your calendar</span>
                        </li>
                      ))}
                  {cell.events.length === 0 && cell.tasks.length === 0 && <li className="text-xs text-muted">Free</li>}
                </ul>
              </Card>
            );
          })}
        </div>
      )}

      {events.data && view === "month" && (
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-line bg-line text-xs">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((w) => <div key={w} className="bg-surface-2 px-2 py-1 font-medium text-muted">{w}</div>)}
          {days.map((d) => {
            const cell = byDay.get(d)!;
            const inMonth = d.slice(0, 7) === anchor.slice(0, 7);
            return (
              <button key={d} onClick={() => { setAnchor(d); setView("day"); }} className={clsx("min-h-20 bg-surface p-1.5 text-left hover:bg-surface-2", !inMonth && "opacity-40")}>
                <span className={clsx("font-medium", d === today && "rounded bg-accent px-1 text-accent-ink")}>{Number(d.slice(8))}</span>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {cell.events.slice(0, 3).map((e) => <li key={e.id} className={clsx("truncate", conflictIds.has(e.id) && "text-danger")}>{e.allDay ? "" : fmtTime(e.startAt, tz) + " "}{e.title}</li>)}
                  {cell.events.length > 3 && <li className="text-muted">+{cell.events.length - 3} more</li>}
                  {cell.tasks.length > 0 && <li className="text-accent">{cell.tasks.length} due</li>}
                </ul>
              </button>
            );
          })}
        </div>
      )}

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
        {event.htmlLink && <a href={event.htmlLink} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-accent">Open in Google Calendar <ExternalLink className="size-3.5" /></a>}
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
        <div className="grid grid-cols-3 gap-3">
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
