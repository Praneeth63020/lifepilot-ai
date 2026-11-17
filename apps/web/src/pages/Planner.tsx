import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertTriangle, CalendarClock, Check, ChevronLeft, ChevronRight, Clock, Flag, Hourglass, ListChecks, MoveRight, RefreshCw, Sparkles, Target, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type { CalendarEventDTO, DailyPlanDTO, PlanItemDTO } from "@lifepilot/shared";
import { api, errorMessage } from "../api";
import { PlanStatusBadge, PlannerWeek } from "../components/PlannerWeek";
import { TimeGrid, TimeGridLegend, type TimeGridItem } from "../components/TimeGrid";
import { useToast } from "../components/toast";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, ProgressBar, Spinner, cardClass, useTabs } from "../components/ui";
import { addDaysISO, fmtDate, fmtTime, isoToZoned, localISODate, minutesLabel, zonedToISO } from "../lib/format";
import { useSession, useTz } from "../session";

type PlannerView = "day" | "week";
const PLANNER_VIEWS: readonly PlannerView[] = ["day", "week"];

const KIND_LABEL: Record<PlanItemDTO["kind"], string> = {
  event: "Calendar event (fixed)",
  task: "Suggested focus block",
  prep: "Suggested preparation",
  break: "Suggested break",
};

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function mondayOf(date: string) {
  const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addDaysISO(date, -((wd + 6) % 7));
}

export function PlannerPage() {
  const tz = useTz();
  const { me } = useSession();
  const prefs = me?.preferences;
  const now = useNow();
  const today = localISODate(now, tz);
  const [params] = useSearchParams();
  const paramDate = params.get("date");
  const [date, setDate] = useState(paramDate && /^\d{4}-\d{2}-\d{2}$/.test(paramDate) ? paramDate : today);
  const [view, setView] = useState<PlannerView>("day");
  const tabs = useTabs("planner-view", PLANNER_VIEWS, view, setView);
  const [editing, setEditing] = useState<PlanItemDTO | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const key = ["plan", date];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<{ plan: DailyPlanDTO | null }>("/plans/current", { date }) });
  const plan = q.data?.plan ?? null;

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysISO(mondayOf(date), i)), [date]);
  const weekPlans = useQueries({
    queries: weekDays.map((d) => ({ queryKey: ["plan", d], queryFn: () => api.get<{ plan: DailyPlanDTO | null }>("/plans/current", { date: d }), enabled: view === "week" })),
  });

  // Without a plan, preview the day's calendar so the empty state still shows what's fixed.
  const dayFrom = zonedToISO(date, "00:00", tz);
  const dayTo = zonedToISO(addDaysISO(date, 1), "00:00", tz);
  const dayEvents = useQuery({
    queryKey: ["events", dayFrom, dayTo],
    queryFn: () => api.get<{ items: CalendarEventDTO[] }>("/calendar/events", { from: dayFrom, to: dayTo }),
    enabled: view === "day" && !q.isLoading && !plan,
  });

  const onErr = (title: string) => (e: unknown) => toast({ title, body: errorMessage(e), tone: "error" });
  const setPlanFor = (d: string, p: DailyPlanDTO) => {
    qc.setQueryData(["plan", d], { plan: p });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
  const setPlan = (p: DailyPlanDTO) => setPlanFor(date, p);
  const generate = useMutation({ mutationFn: () => api.post<{ plan: DailyPlanDTO }>("/plans/generate", { date }), onSuccess: (r) => setPlan(r.plan), onError: onErr("Planning failed") });
  const generateDay = useMutation({
    mutationFn: (d: string) => api.post<{ plan: DailyPlanDTO }>("/plans/generate", { date: d }),
    onSuccess: (r, d) => {
      setPlanFor(d, r.plan);
      toast({ title: `Proposal ready for ${fmtDate(zonedToISO(d, "12:00", tz), tz)}`, body: "Open the day to review and accept it.", tone: "success" });
    },
    onError: onErr("Planning failed"),
  });
  const replan = useMutation({
    mutationFn: () => api.post<{ plan: DailyPlanDTO }>("/plans/replan"),
    onSuccess: (r) => {
      setPlan(r.plan);
      toast({ title: "New proposal ready", body: r.plan.changes?.length ? `${r.plan.changes.length} change(s) — review and accept.` : "Nothing needed to move.", tone: "success" });
    },
    onError: onErr("Replanning failed"),
  });
  const accept = useMutation({ mutationFn: (id: string) => api.post<{ plan: DailyPlanDTO }>(`/plans/${id}/accept`), onSuccess: (r) => { setPlan(r.plan); toast({ title: "Plan accepted", tone: "success" }); }, onError: onErr("Couldn't accept plan") });
  const reject = useMutation({ mutationFn: (id: string) => api.post<{ plan: DailyPlanDTO }>(`/plans/${id}/reject`), onSuccess: () => { qc.invalidateQueries({ queryKey: key }); toast({ title: "Plan rejected", tone: "info" }); }, onError: onErr("Couldn't reject plan") });
  const postpone = useMutation({
    mutationFn: (taskId: string) => api.patch(`/tasks/${taskId}`, { snoozedUntil: zonedToISO(addDaysISO(date, 1), "00:00", tz) }),
    onSuccess: () => { qc.invalidateQueries(); toast({ title: "Moved off today", body: "Regenerate the plan to update the schedule.", tone: "success" }); },
    onError: onErr("Couldn't postpone"),
  });

  const editable = plan !== null && plan.status !== "superseded" && plan.status !== "rejected";
  const gridItems = useMemo<TimeGridItem[]>(() => {
    if (plan) {
      return plan.items.map((i) => ({
        id: i.id,
        title: i.title,
        startAt: i.startAt,
        endAt: i.endAt,
        kind: i.kind,
        proposed: !i.isFact && plan.status === "proposed",
        detail: i.reason ?? undefined,
        kindLabel: KIND_LABEL[i.kind],
        onSelect: editable && !i.isFact ? () => setEditing(i) : undefined,
      }));
    }
    return (dayEvents.data?.items ?? []).map((e) => ({ id: e.id, title: e.title, startAt: e.startAt, endAt: e.endAt, allDay: e.allDay, kind: "event" as const, detail: e.needsPrep ? `prep ${e.prepMin} min` : undefined }));
  }, [plan, editable, dayEvents.data]);

  const step = (dir: number) => setDate(addDaysISO(date, dir * (view === "week" ? 7 : 1)));
  const dateLong = fmtDate(zonedToISO(date, "12:00", tz), tz, { weekday: "long", month: "long", day: "numeric" });
  const title =
    view === "week"
      ? `${fmtDate(zonedToISO(weekDays[0]!, "12:00", tz), tz, { month: "short", day: "numeric" })} – ${fmtDate(zonedToISO(weekDays[6]!, "12:00", tz), tz, { month: "short", day: "numeric", year: "numeric" })}`
      : date === today
        ? `Today, ${fmtDate(zonedToISO(date, "12:00", tz), tz, { month: "long", day: "numeric" })}`
        : dateLong;
  const inRange = view === "week" ? weekDays.includes(today) : date === today;
  const kindsInPlan = plan ? (["event", "task", "prep", "break"] as const).filter((k) => plan.items.some((i) => i.kind === k)) : (["event"] as const);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow={view === "week" ? "Weekly planner" : "Daily planner"}
        title={title}
        subtitle="Suggestions are built from your tasks, calendar and working hours. Nothing changes until you accept it, and your calendar is never edited."
        actions={
          view === "day" && (
            <>
              {date === today && plan && (
                <Button onClick={() => replan.mutate()} loading={replan.isPending}>
                  <RefreshCw className="size-4" /> Replan from now
                </Button>
              )}
              <Button variant="primary" onClick={() => generate.mutate()} loading={generate.isPending}>
                <Sparkles className="size-4" /> {plan ? "Regenerate" : "Generate plan"}
              </Button>
            </>
          )
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-xl border border-line bg-surface p-0.5 shadow-card">
            <Button size="sm" variant="ghost" aria-label={view === "week" ? "Previous week" : "Previous day"} onClick={() => step(-1)}><ChevronLeft className="size-4" /></Button>
            <Input type="date" aria-label="Plan date" className="h-8 w-auto border-0 bg-transparent px-2 focus:ring-0" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            <Button size="sm" variant="ghost" aria-label={view === "week" ? "Next week" : "Next day"} onClick={() => step(1)}><ChevronRight className="size-4" /></Button>
          </div>
          {!inRange && <Button size="sm" variant="secondary" onClick={() => setDate(today)}>Today</Button>}
        </div>
        <div role="tablist" aria-label="Planner view" className="flex rounded-xl border border-line bg-surface p-0.5 shadow-card">
          {PLANNER_VIEWS.map((v) => (
            <button key={v} {...tabs.tabProps(v)} className={clsx("h-8 rounded-[10px] px-4 text-sm font-medium capitalize transition-colors", view === v ? "bg-ink text-canvas" : "text-muted hover:bg-surface-2 hover:text-ink")}>
              {v}
            </button>
          ))}
        </div>
      </div>

      <div {...tabs.panelProps} className="flex min-w-0 flex-col gap-5">
        {view === "week" ? (
          <PlannerWeek
            days={weekDays}
            today={today}
            tz={tz}
            now={now}
            results={weekPlans}
            workStartMin={prefs?.workStartMin ?? 9 * 60}
            workEndMin={prefs?.workEndMin ?? 18 * 60}
            pendingDay={generateDay.isPending ? generateDay.variables : undefined}
            onPlan={(d) => generateDay.mutate(d)}
            onOpen={(d) => {
              setDate(d);
              setView("day");
            }}
          />
        ) : (
          <>
            {q.isLoading && <Spinner label="Loading plan" />}
            {q.error && <ErrorNote error={q.error} onRetry={() => q.refetch()} />}

            {plan && (plan.drift?.length ?? 0) > 0 && (
              <div role="status" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-warn/40 bg-warn/10 p-4 text-sm sm:flex-row sm:items-start">
                <AlertTriangle className="size-5 shrink-0 text-warn" aria-hidden />
                <div className="flex-1">
                  <p className="font-semibold">This plan is out of date</p>
                  <ul className="mt-1 list-disc pl-5 text-muted">
                    {plan.drift.map((d) => <li key={d}>{d}</li>)}
                  </ul>
                  <p className="mt-1 text-muted">Nothing was changed. {date === today ? "Replan from now to get a revised proposal; your current plan stays until you accept it." : "Regenerate to get a revised proposal."}</p>
                </div>
                <Button className="shrink-0" onClick={() => (date === today ? replan.mutate() : generate.mutate())} loading={replan.isPending || generate.isPending}>
                  <RefreshCw className="size-4" /> {date === today ? "Replan from now" : "Regenerate"}
                </Button>
              </div>
            )}

            {!q.isLoading && !q.error && (
              <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
                <section aria-labelledby="planner-schedule-heading" className={clsx(cardClass, "min-w-0 overflow-hidden")}>
                  <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
                    <div className="min-w-0">
                      <h2 id="planner-schedule-heading" className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                        {plan ? "Schedule" : "Your calendar"}
                        {plan && <PlanStatusBadge status={plan.status} />}
                      </h2>
                      <p className="mt-0.5 text-xs text-muted">
                        {plan ? `Generated ${fmtTime(plan.generatedAt, tz)} by ${plan.generator}${plan.status === "proposed" ? " · review it, then accept or reject" : ""}` : `No plan for ${dateLong} yet`}
                      </p>
                    </div>
                    {plan?.status === "proposed" && (
                      <div className="flex gap-2">
                        <Button size="sm" variant="ghost" onClick={() => reject.mutate(plan.id)} loading={reject.isPending}><X className="size-4" /> Reject</Button>
                        <Button size="sm" variant="primary" onClick={() => accept.mutate(plan.id)} loading={accept.isPending}><Check className="size-4" /> Accept</Button>
                      </div>
                    )}
                  </header>

                  {plan && (
                    <div className="grid grid-cols-1 gap-px border-b border-line bg-line sm:grid-cols-3">
                      <Stat icon={<Clock />} label="Free in working hours" value={minutesLabel(plan.stats.freeMinutes)} />
                      <Stat icon={<Target />} label="Task time scheduled" value={minutesLabel(plan.stats.scheduledTaskMinutes)} />
                      <Stat
                        icon={<Hourglass />}
                        label="Needed today"
                        value={minutesLabel(plan.stats.requiredTodayMinutes)}
                        extra={
                          plan.stats.requiredTodayMinutes > 0 ? (
                            <ProgressBar
                              className="mt-2"
                              label="Share of today's required work that is scheduled"
                              tone={plan.stats.scheduledTaskMinutes >= plan.stats.requiredTodayMinutes ? "ok" : "accent"}
                              value={(plan.stats.scheduledTaskMinutes / plan.stats.requiredTodayMinutes) * 100}
                            />
                          ) : undefined
                        }
                      />
                    </div>
                  )}

                  <div className="flex flex-col gap-3 px-4 pt-4 sm:px-5">
                    {plan?.changes && plan.changes.length > 0 && plan.status === "proposed" && (
                      <div className="rounded-xl border border-accent/40 bg-accent-soft p-3 text-sm">
                        <p className="font-semibold">What changed</p>
                        <ul className="mt-1 flex flex-col gap-0.5 text-ink/80">
                          {plan.changes.map((c) => (
                            <li key={c.taskId + c.change} className="flex flex-wrap items-center gap-x-1.5">
                              <span className="font-medium text-ink">{c.title}:</span>
                              {c.change === "moved" ? (
                                <>moved {fmtTime(c.from!, tz)} <MoveRight aria-label="to" className="size-3.5" /> {fmtTime(c.to!, tz)}</>
                              ) : c.change === "added" ? (
                                `added at ${fmtTime(c.to!, tz)}`
                              ) : (
                                "no longer fits today"
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {!plan && (
                      <div className="rounded-xl border border-dashed border-line bg-surface-2/50">
                        <Empty icon={<Sparkles className="size-6" />} title={`No plan for ${fmtDate(zonedToISO(date, "12:00", tz), tz)}`} action={<Button variant="primary" onClick={() => generate.mutate()} loading={generate.isPending}>Generate plan</Button>}>
                          The planner never schedules over calendar events, stays inside your working hours, and adds breaks and preparation time.
                        </Empty>
                      </div>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <TimeGridLegend kinds={[...kindsInPlan]} proposed={plan?.status === "proposed"} />
                      {plan && editable && plan.items.some((i) => !i.isFact) && <p className="text-xs text-muted">Select a suggested block to change its time.</p>}
                    </div>
                  </div>

                  <div className="px-2 pb-3 pt-2 sm:px-3">
                    {plan && plan.items.length === 0 ? (
                      <ol aria-label="Schedule" className="px-3 py-6 text-sm text-muted"><li>Nothing scheduled.</li></ol>
                    ) : (
                      <TimeGrid
                        days={[date]}
                        tz={tz}
                        today={today}
                        now={now}
                        items={gridItems}
                        hideHeader
                        hourHeight={72}
                        startMin={prefs?.workStartMin ?? 7 * 60}
                        endMin={prefs?.workEndMin ?? 21 * 60}
                        workStartMin={prefs?.workStartMin}
                        workEndMin={prefs?.workEndMin}
                        listLabel={plan ? () => "Schedule" : undefined}
                        emptyLabel={plan ? "Nothing scheduled" : "No events on this day"}
                      />
                    )}
                  </div>
                </section>

                {plan ? (
                  <PlanSide plan={plan} tz={tz} date={date} today={today} onPostpone={(id) => postpone.mutate(id)} postponing={postpone.isPending ? postpone.variables : undefined} />
                ) : (
                  <Card title="How planning works" icon={<ListChecks />}>
                    <ul className="flex flex-col gap-2 text-sm text-muted">
                      <li>Calendar events are fixed; focus blocks only go into free time inside your working hours.</li>
                      <li>Events marked "needs preparation" get a prep block before them.</li>
                      <li>You review the proposal and accept or reject it. Generating again never overwrites an accepted plan without your say.</li>
                    </ul>
                  </Card>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {editing && plan && <MoveBlockModal item={editing} plan={plan} tz={tz} onClose={() => setEditing(null)} onSaved={setPlan} />}
    </div>
  );
}

function Stat({ icon, label, value, extra }: { icon: ReactNode; label: string; value: string; extra?: ReactNode }) {
  return (
    <div className="bg-surface px-4 py-3 sm:px-5">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted [&>svg]:size-3.5">
        <span aria-hidden className="contents">{icon}</span>
        {label}
      </p>
      <p className="mt-1 font-display text-xl font-semibold tabular-nums">{value}</p>
      {extra}
    </div>
  );
}

function PlanSide({ plan, tz, date, today, onPostpone, postponing }: { plan: DailyPlanDTO; tz: string; date: string; today: string; onPostpone: (taskId: string) => void; postponing?: string }) {
  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-5 md:grid-cols-2 xl:grid-cols-1">
      {plan.warnings.length > 0 && (
        <section className="rounded-[var(--radius-card)] border border-warn/40 bg-warn/10 p-4 sm:p-5 md:col-span-2 xl:col-span-1">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-warn">
            <AlertTriangle aria-hidden className="size-4" /> {plan.warnings.length === 1 ? "Warning" : `${plan.warnings.length} warnings`}
          </h2>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm text-ink">
            {plan.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </section>
      )}

      <Card title={date === today ? "Today's top 3" : "Top 3 for this day"} icon={<Target />} subtitle="What matters most, and why">
        {plan.topTasks.length === 0 ? <p className="text-sm text-muted">No open tasks.</p> : (
          <ol className="flex flex-col gap-3">
            {plan.topTasks.map((t, i) => (
              <li key={t.taskId} className="flex items-start gap-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-ink">{i + 1}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{t.title}</span>
                  <span className="block text-xs text-muted">{t.reason}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card title="Needs time soon" icon={<Hourglass />} subtitle="Didn't fit into this day's free time">
        {plan.unscheduled.length === 0 ? <p className="text-sm text-muted">Everything urgent fits.</p> : (
          <ul className="flex flex-col gap-2.5 text-sm">
            {plan.unscheduled.map((t) => (
              <li key={t.taskId} className="border-l-2 border-danger/50 pl-3">
                <span className="block font-medium">{t.title}</span>
                <span className="block text-xs text-muted">{t.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Can wait" icon={<CalendarClock />} subtitle="Safe to move off this day">
        {plan.postponable.length === 0 ? <p className="text-sm text-muted">Nothing to postpone.</p> : (
          <ul className="flex flex-col divide-y divide-line text-sm">
            {plan.postponable.map((t) => (
              <li key={t.taskId} className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <span className="min-w-0">
                  <span className="block font-medium">{t.title}</span>
                  <span className="block text-xs text-muted">{t.reason}</span>
                </span>
                <Button size="sm" variant="secondary" className="shrink-0" loading={postponing === t.taskId} onClick={() => onPostpone(t.taskId)} aria-label={`Not today: ${t.title}`}>Not today</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Deadlines this week" icon={<Flag />}>
        {plan.deadlines.length === 0 ? <p className="text-sm text-muted">None.</p> : (
          <ul className="flex flex-col gap-2 text-sm">
            {plan.deadlines.map((d) => (
              <li key={d.taskId} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate">{d.title}</span>
                <span className={clsx("shrink-0 text-xs tabular-nums", d.overdue ? "font-semibold text-danger" : "text-muted")}>
                  {d.overdue ? "Overdue" : `${fmtDate(d.dueAt, tz)}, ${fmtTime(d.dueAt, tz)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function MoveBlockModal({ item, plan, tz, onClose, onSaved }: { item: PlanItemDTO; plan: DailyPlanDTO; tz: string; onClose: () => void; onSaved: (p: DailyPlanDTO) => void }) {
  const start = isoToZoned(item.startAt, tz);
  const [time, setTime] = useState(start.time);
  const dur = new Date(item.endAt).getTime() - new Date(item.startAt).getTime();
  const m = useMutation({
    mutationFn: () => {
      const s = zonedToISO(plan.date, time, tz);
      return api.patch<{ plan: DailyPlanDTO }>(`/plans/${plan.id}/items`, { items: [{ id: item.id, startAt: s, endAt: new Date(new Date(s).getTime() + dur).toISOString() }] });
    },
    onSuccess: (r) => {
      onSaved(r.plan);
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title={`Move "${item.title}"`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>Save</Button></>}>
      {m.error && <div className="mb-3"><ErrorNote error={new Error(errorMessage(m.error))} /></div>}
      <p className="mb-3 text-sm text-muted">
        Now {fmtTime(item.startAt, tz)} – {fmtTime(item.endAt, tz)}
        {item.reason ? ` · ${item.reason}` : ""}
      </p>
      <Field label="New start time" htmlFor="mv" hint={`Keeps its ${minutesLabel(Math.round(dur / 60000))} length. Can't overlap a calendar event.${plan.status === "accepted" ? " This changes your accepted plan." : ""}`}>
        <Input id="mv" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      </Field>
    </Modal>
  );
}
