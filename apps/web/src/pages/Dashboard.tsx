import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  AlarmClock,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BellRing,
  CalendarClock,
  CalendarDays,
  CalendarX,
  CheckCircle2,
  ChevronRight,
  Circle,
  FolderKanban,
  HelpCircle,
  Inbox,
  Lightbulb,
  ListChecks,
  Plus,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Timer,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ConnectionDTO, DashboardDTO, PlanItemDTO, RecommendationDTO, ReminderDTO } from "@lifepilot/shared";
import { api, errorMessage } from "../api";
import { PlanTimeline } from "../components/PlanTimeline";
import { useToast } from "../components/toast";
import { Badge, Button, Card, Empty, ErrorNote, Input, PriorityBadge, ProgressBar, Spinner, StatCard, buttonClass } from "../components/ui";
import { fmtDate, fmtDateTime, fmtTime, localISODate, relative, zonedToISO } from "../lib/format";
import { useSession } from "../session";
import { ProjectDot, useProjects } from "./Projects";

export function SyncStatus({ connections }: { connections: ConnectionDTO[] }) {
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {connections.map((c) => {
        const name = c.product === "gmail" ? "Gmail" : "Calendar";
        if (c.status === "not_connected") return <Badge key={c.product}>{name}: not connected</Badge>;
        if (c.provider === "demo" && c.status === "active") return <Badge key={c.product} tone="warn">{name}: demo data</Badge>;
        if (c.status === "active")
          return (
            <Badge key={c.product} tone={c.lastSyncError ? "warn" : "ok"} title={c.lastSyncError ?? undefined}>
              {name}: {c.lastSyncAt ? `synced ${relative(c.lastSyncAt)}` : "first sync pending"}
              {c.lastSyncError ? " · last attempt failed" : ""}
            </Badge>
          );
        return <Badge key={c.product} tone="danger" title={c.lastSyncError ?? undefined}>{name}: {c.status} — reconnect in Settings</Badge>;
      })}
    </div>
  );
}

/** Where each suggestion can be acted on, and how it looks. */
const RECOMMENDATION_META: Record<RecommendationDTO["kind"], { icon: LucideIcon; tone: string; to: string }> = {
  overdue: { icon: AlertCircle, tone: "text-danger", to: "/app/tasks" },
  conflict: { icon: CalendarX, tone: "text-danger", to: "/app/calendar" },
  unclear_deadline: { icon: HelpCircle, tone: "text-warn", to: "/app/inbox" },
  suspicious_email: { icon: ShieldAlert, tone: "text-danger", to: "/app/inbox" },
  no_estimate: { icon: Timer, tone: "text-muted", to: "/app/tasks" },
  not_planned: { icon: Sparkles, tone: "text-accent-strong", to: "/app/planner" },
  plan_outdated: { icon: RefreshCw, tone: "text-warn", to: "/app/planner" },
};

const RouterLink = ({ to, className, children }: { to: string; className?: string; children: ReactNode }) => (
  <Link to={to} className={className}>
    {children}
  </Link>
);

function useNow() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const SEE_ALL = "inline-flex items-center gap-1 text-sm font-medium text-accent-strong hover:underline";

export function DashboardPage() {
  const { me } = useSession();
  const tz = me!.preferences.timezone;
  const now = useNow();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const [quick, setQuick] = useState("");
  const q = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<DashboardDTO>("/dashboard"), refetchInterval: 60_000 });
  const projects = useProjects();
  const reminders = useQuery({ queryKey: ["reminders", "scheduled"], queryFn: () => api.get<{ items: ReminderDTO[] }>("/reminders", { status: "scheduled" }) });

  const fail = (title: string) => (e: unknown) => toast({ title, body: errorMessage(e), tone: "error" });
  const add = useMutation({
    mutationFn: () => api.post("/tasks", { title: quick.trim() }),
    onSuccess: () => {
      setQuick("");
      qc.invalidateQueries();
      toast({ title: "Task added", body: "Add a due date or estimate from Tasks to help the planner.", tone: "success" });
    },
    onError: fail("Couldn't add task"),
  });
  const replan = useMutation({
    mutationFn: () => api.post("/plans/replan"),
    onSuccess: () => {
      qc.invalidateQueries();
      nav("/app/planner");
    },
    onError: fail("Couldn't replan"),
  });
  const complete = useMutation({ mutationFn: (id: string) => api.post(`/tasks/${id}/complete`), onSuccess: () => qc.invalidateQueries(), onError: fail("Couldn't complete task") });
  const plan = useMutation({
    mutationFn: () => api.post("/plans/generate", {}),
    onSuccess: () => {
      qc.invalidateQueries();
      nav("/app/planner");
    },
    onError: fail("Planning failed"),
  });
  const snooze = useMutation({
    mutationFn: (id: string) => api.post(`/reminders/${id}/snooze`, { minutes: 60 }),
    onSuccess: () => {
      qc.invalidateQueries();
      toast({ title: "Reminder snoozed for an hour", tone: "success" });
    },
    onError: fail("Couldn't snooze"),
  });
  const notificationDone = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/complete`),
    onSuccess: () => {
      qc.invalidateQueries();
      toast({ title: "Task completed", tone: "success" });
    },
    onError: fail("Couldn't complete task"),
  });

  if (q.isLoading) return <Spinner label="Loading your day" />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const total = d.progress.completedToday + d.progress.dueToday;
  const pct = total ? Math.round((d.progress.completedToday / total) * 100) : 0;
  const overdue = d.deadlines.filter((x) => x.overdue).length;
  const upcomingDeadlines = d.deadlines.filter((x) => !x.overdue);
  const noData = d.progress.openTotal === 0 && d.upcomingEvents.length === 0 && d.importantEmails.length === 0;
  const gmailConnected = d.connections.some((c) => c.product === "gmail" && c.status === "active");
  const nextReminders = (reminders.data?.items ?? []).filter((r) => new Date(r.remindAt) > now).slice(0, 4);
  const activeProjects = (projects.data?.items ?? []).filter((p) => p.openTasks > 0 || p.doneTasks > 0).slice(0, 4);

  return (
    <div className="flex flex-col gap-6">
      {/* Title row: what this is, where the data comes from, quick capture. */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-strong">Command centre</p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight sm:text-[28px]">Today at a glance</h1>
          <div className="mt-2">
            <SyncStatus connections={d.connections} />
          </div>
        </div>
        <form
          className="flex w-full gap-2 xl:max-w-xl"
          onSubmit={(e) => {
            e.preventDefault();
            if (quick.trim()) add.mutate();
          }}
        >
          <label htmlFor="quick" className="sr-only">Quick add a task</label>
          <Input id="quick" value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="Quick add a task…" className="h-11" />
          <Button type="submit" variant="dark" className="h-11" loading={add.isPending} disabled={!quick.trim()}>
            <Plus className="size-4" /> Add
          </Button>
        </form>
      </div>

      {/* Headline numbers, all from the dashboard API. */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Due today" value={d.progress.dueToday} hint={overdue ? `${overdue} overdue` : "Nothing overdue"} icon={<ListChecks />} tone="accent" href="/app/tasks" LinkComponent={RouterLink} />
        <StatCard label="Completed today" value={d.progress.completedToday} hint={total ? `${pct}% of today's work` : "No work due today"} icon={<CheckCircle2 />} tone="ok" href="/app/tasks?status=done" LinkComponent={RouterLink} />
        <StatCard label="Upcoming events" value={d.upcomingEvents.length} hint="Next 36 hours" icon={<CalendarDays />} tone="blue" href="/app/calendar" LinkComponent={RouterLink} />
        <StatCard
          label="Emails needing attention"
          value={d.importantEmails.length}
          hint={gmailConnected ? (d.importantEmails.some((e) => e.suspicious) ? "Includes a flagged email" : "From your smart inbox") : "Gmail not connected"}
          icon={<Inbox />}
          tone="violet"
          href="/app/inbox"
          LinkComponent={RouterLink}
        />
        <StatCard
          label="Deadlines this week"
          value={upcomingDeadlines.length}
          hint={upcomingDeadlines[0] ? `Next: ${fmtDate(upcomingDeadlines[0].dueAt, tz)}` : "None coming up"}
          icon={<CalendarClock />}
          tone={overdue ? "danger" : "neutral"}
          href="/app/tasks"
          LinkComponent={RouterLink}
        />
      </div>

      {noData && (
        <Card>
          <Empty icon={<Sparkles />} title="Nothing here yet" action={<Link to="/app/settings" className={buttonClass({ variant: "primary" })}>Connect accounts or load demo data</Link>}>
            Add a task above, create calendar events, or connect Gmail and Calendar so LifePilot can find deadlines for you.
          </Empty>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-12">
        {/* Main column */}
        <div className="flex min-w-0 flex-col gap-6 xl:col-span-8">
          <Card
            title="Daily schedule"
            icon={<CalendarClock />}
            subtitle={d.plan ? (d.plan.status === "accepted" ? "Your accepted plan for today" : "Proposed plan — review it in the planner") : "Today's calendar. Plan your day to fit tasks around it."}
            action={
              <div className="flex items-center gap-2">
                {d.plan && <Badge tone={d.plan.status === "accepted" ? "ok" : "accent"}>{d.plan.status === "accepted" ? "Accepted" : "Proposed"}</Badge>}
                <Link to="/app/planner" className={SEE_ALL}>Planner <ArrowRight className="size-3.5" /></Link>
              </div>
            }
          >
            <DayStrip items={d.plan ? d.plan.items : todaysEvents(d, tz)} tz={tz} now={now} startMin={me!.preferences.workStartMin} endMin={me!.preferences.workEndMin} date={d.date} />
            {d.plan ? (
              <div className="mt-4">
                <PlanTimeline items={d.plan.items.filter((i) => new Date(i.endAt) > now)} tz={tz} now={now} compact />
              </div>
            ) : (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface-2 px-4 py-3">
                <p className="text-sm text-muted">No plan for today yet. LifePilot fits your tasks between calendar events, inside your working hours.</p>
                <Button variant="primary" loading={plan.isPending} onClick={() => plan.mutate()}>
                  <Sparkles className="size-4" /> Plan my day
                </Button>
              </div>
            )}
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card
              title="Today's priorities"
              icon={<ListChecks />}
              subtitle={`${d.progress.completedToday} done · ${d.progress.dueToday} still due today`}
            >
              <ProgressBar value={pct} label="Today's completion" className="mb-4" />
              {d.topTasks.length === 0 ? (
                <p className="text-sm text-muted">No open tasks. Enjoy the space — or add something above.</p>
              ) : (
                <ol className="flex flex-col gap-3">
                  {d.topTasks.map((t, i) => (
                    <li key={t.taskId} className="flex items-start gap-3">
                      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-accent text-xs font-bold text-accent-ink">{i + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{t.title}</span>
                        <span className="block text-xs text-muted">{t.reason}</span>
                      </span>
                      <button aria-label={`Complete ${t.title}`} title="Mark done" onClick={() => complete.mutate(t.taskId)} className="mt-0.5 shrink-0 text-muted hover:text-ok">
                        <Circle className="size-5" />
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </Card>

            <Card title="Due today" icon={<AlarmClock />} action={<Link to="/app/tasks" className={SEE_ALL}>All tasks</Link>}>
              {d.dueToday.length === 0 ? (
                <p className="text-sm text-muted">Nothing due today.</p>
              ) : (
                <ul className="-my-1 flex flex-col divide-y divide-line">
                  {d.dueToday.map((t) => {
                    const late = new Date(t.dueAt!) < now;
                    return (
                      <li key={t.id} className="flex items-center gap-3 py-2.5">
                        <button aria-label={`Complete ${t.title}`} onClick={() => complete.mutate(t.id)} className="shrink-0 text-muted hover:text-ok">
                          <Circle className="size-5" />
                        </button>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{t.title}</span>
                          <span className={late ? "text-xs font-medium text-danger" : "text-xs text-muted"}>{late ? "Overdue · " : ""}due {fmtDateTime(t.dueAt!, tz)}</span>
                        </span>
                        <PriorityBadge priority={t.priority} />
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Project progress" icon={<FolderKanban />} action={<Link to="/app/projects" className={SEE_ALL}>Projects</Link>}>
              {projects.isLoading ? (
                <Spinner label="Loading projects" />
              ) : activeProjects.length === 0 ? (
                <p className="text-sm text-muted">
                  No projects with tasks yet. <Link to="/app/projects" className="font-medium text-accent-strong hover:underline">Create a project</Link> to group related work and track progress.
                </p>
              ) : (
                <ul className="flex flex-col gap-4">
                  {activeProjects.map((p) => {
                    const all = p.openTasks + p.doneTasks;
                    return (
                      <li key={p.id}>
                        <Link to={`/app/tasks?project=${p.id}`} className="group block">
                          <span className="flex items-center gap-2 text-sm font-medium group-hover:text-accent-strong">
                            <ProjectDot color={p.color} className="size-2.5" />
                            <span className="min-w-0 flex-1 truncate">{p.name}</span>
                            <span className="text-xs font-normal text-muted">{p.doneTasks}/{all}</span>
                          </span>
                          <ProgressBar value={all ? (p.doneTasks / all) * 100 : 0} label={`${p.name} progress`} tone="ink" className="mt-2 h-1.5" />
                          <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                            {p.overdueTasks > 0 && <span className="font-medium text-danger">{p.overdueTasks} overdue</span>}
                            {p.nextDue && <span>Next: {p.nextDue.title} · {fmtDate(p.nextDue.dueAt, tz)}</span>}
                            {p.lastDueAt && <span>Done by {fmtDate(p.lastDueAt, tz)}</span>}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <Card title="Coming up" icon={<CalendarDays />} action={<Link to="/app/calendar" className={SEE_ALL}>Calendar</Link>}>
              {d.upcomingEvents.length === 0 ? (
                <p className="text-sm text-muted">No events in the next day and a half.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {d.upcomingEvents.map((e) => (
                    <li key={e.id} className="flex gap-3">
                      <span className="w-16 shrink-0 pt-0.5 text-xs font-semibold tabular-nums text-muted">{e.allDay ? "All day" : fmtTime(e.startAt, tz)}</span>
                      <span className="min-w-0 flex-1 border-l-2 border-blue/50 pl-3">
                        <span className="block truncate text-sm font-medium">{e.title}</span>
                        <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                          {fmtDate(e.startAt, tz)}
                          {e.source === "demo" && <span>· demo</span>}
                          {e.needsPrep && <Badge tone="violet">prep {e.prepMin} min</Badge>}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Reminders" icon={<BellRing />} action={<Link to="/app/notifications" className={SEE_ALL}>All</Link>}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Upcoming</p>
              {nextReminders.length === 0 ? (
                <p className="mb-4 text-sm text-muted">No reminders scheduled.</p>
              ) : (
                <ul className="mb-4 flex flex-col gap-2">
                  {nextReminders.map((r) => (
                    <li key={r.id} className="flex items-center gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{r.title}</span>
                        <span className="text-xs text-muted">{fmtDateTime(r.remindAt, tz)}</span>
                      </span>
                      <Button size="sm" variant="ghost" aria-label={`Snooze ${r.title} for an hour`} title="Snooze 1 hour" onClick={() => snooze.mutate(r.id)}>
                        +1h
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Recently sent</p>
              {d.recentNotifications.length === 0 ? (
                <p className="text-sm text-muted">No reminders sent yet.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {d.recentNotifications.map((n) => (
                    <li key={n.id} className="flex items-center gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{n.title}</span>
                        <span className="text-xs text-muted">{relative(n.createdAt)}</span>
                      </span>
                      {n.taskId && n.status === "available" && (
                        <Button size="sm" variant="ghost" aria-label={`Mark ${n.title} done`} onClick={() => notificationDone.mutate(n.id)}>
                          Done
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Upcoming deadlines" icon={<CalendarClock />}>
              {d.deadlines.length === 0 ? (
                <p className="text-sm text-muted">No deadlines in the next week.</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {d.deadlines.map((x) => (
                    <li key={x.taskId} className="flex items-center justify-between gap-2">
                      <span className="truncate">{x.title}</span>
                      <span className={x.overdue ? "shrink-0 rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger" : "shrink-0 text-xs text-muted"}>{x.overdue ? "overdue" : fmtDate(x.dueAt, tz)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>

        {/* Side column */}
        <div className="flex min-w-0 flex-col gap-6 xl:col-span-4">
          {d.recommendations.length > 0 && (
            <section className="rounded-[var(--radius-card)] bg-side p-5 text-side-ink shadow-card">
              <h2 className="flex items-center gap-2 text-[15px] font-semibold">
                <span className="grid size-7 place-items-center rounded-lg bg-accent text-accent-ink" aria-hidden><Lightbulb className="size-4" /></span>
                Suggestions
              </h2>
              <ul className="mt-4 flex flex-col gap-1">
                {d.recommendations.map((r) => {
                  const meta = RECOMMENDATION_META[r.kind];
                  const Icon = meta.icon;
                  return (
                    <li key={r.kind}>
                      <Link to={meta.to} className="group -mx-2 flex gap-2.5 rounded-xl px-2 py-2 text-sm hover:bg-side-2">
                        <Icon className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                        <span className="flex-1 text-side-ink">{r.text}</span>
                        <ChevronRight className="mt-0.5 size-4 shrink-0 text-side-muted opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                      </Link>
                    </li>
                  );
                })}
              </ul>
              {d.plan && (
                <Button className="mt-3" size="sm" variant="primary" loading={replan.isPending} onClick={() => replan.mutate()}>
                  <RefreshCw className="size-3.5" /> Replan from now
                </Button>
              )}
            </section>
          )}

          <Card title="Smart inbox" icon={<Inbox />} subtitle="Emails that need you" action={<Link to="/app/inbox" className={SEE_ALL}>Inbox</Link>}>
            {d.importantEmails.length === 0 ? (
              <p className="text-sm text-muted">{gmailConnected ? "Nothing needs you right now." : "Connect Gmail (or load demo data) to see important emails here."}</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {d.importantEmails.map((i) => (
                  <li key={i.id} className="rounded-xl border border-line p-3">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      {i.suspicious && <AlertTriangle className="size-3.5 shrink-0 text-danger" aria-label="Suspicious" />}
                      <span className="truncate">{i.email.subject}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted">{i.email.fromName ?? i.email.fromAddress}</span>
                    <span className="mt-2 flex flex-wrap items-center gap-1.5">
                      {i.deadlineAt ? <Badge tone="accent">Due {fmtDate(i.deadlineAt, tz)}</Badge> : i.deadlineCertainty === "ambiguous" ? <Badge tone="warn">Date unclear</Badge> : null}
                      {i.taskId ? <Badge tone="ok">Task created</Badge> : i.proposedTaskTitle ? <Badge>Task suggested</Badge> : null}
                      {i.suspicious && <Badge tone="danger">Review manually</Badge>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

        </div>
      </div>
    </div>
  );
}

/** Today's timed events as plan-like items, for the timeline when there's no plan yet. */
function todaysEvents(d: DashboardDTO, tz: string): PlanItemDTO[] {
  return d.upcomingEvents
    .filter((e) => !e.allDay && localISODate(new Date(e.startAt), tz) === d.date)
    .map((e) => ({ id: e.id, kind: "event", title: e.title, startAt: e.startAt, endAt: e.endAt, taskId: null, eventId: e.id, reason: null, isFact: true }));
}

const STRIP_TONE: Record<PlanItemDTO["kind"], string> = {
  event: "bg-blue/15 text-blue border-blue/30",
  task: "bg-accent text-accent-ink border-accent",
  prep: "bg-violet/15 text-violet border-violet/30",
  break: "bg-ok/10 text-ok border-ok/25",
};

/**
 * A horizontal day timeline across working hours: events, focus blocks, prep and breaks placed by
 * time, with a "now" marker. Decorative summary only; the readable list sits next to it.
 */
function DayStrip({ items, tz, now, startMin, endMin, date }: { items: PlanItemDTO[]; tz: string; now: Date; startMin: number; endMin: number; date: string }) {
  const hh = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const start = new Date(zonedToISO(date, hh(Math.max(0, startMin - 60)), tz)).getTime();
  const end = new Date(zonedToISO(date, hh(Math.min(23 * 60 + 59, endMin + 60)), tz)).getTime();
  const span = end - start;
  const pos = (t: number) => Math.max(0, Math.min(100, ((t - start) / span) * 100));
  const hours: number[] = [];
  for (let m = Math.ceil(Math.max(0, startMin - 60) / 60) * 60; m <= Math.min(24 * 60, endMin + 60); m += 60) hours.push(m);
  const nowPct = now.getTime() >= start && now.getTime() <= end ? pos(now.getTime()) : null;
  const visible = items.filter((i) => new Date(i.endAt).getTime() > start && new Date(i.startAt).getTime() < end);
  return (
    <div aria-hidden className="relative">
      <div className="relative h-16 overflow-hidden rounded-2xl border border-line bg-surface-2">
        {/* working hours band */}
        <div className="absolute inset-y-0 bg-surface" style={{ left: `${pos(new Date(zonedToISO(date, hh(startMin), tz)).getTime())}%`, right: `${100 - pos(new Date(zonedToISO(date, hh(endMin), tz)).getTime())}%` }} />
        {visible.map((i) => {
          const l = pos(new Date(i.startAt).getTime());
          const r = pos(new Date(i.endAt).getTime());
          return (
            <div
              key={i.id}
              className={clsx("absolute top-2 bottom-2 overflow-hidden rounded-lg border px-1.5 py-1 text-[11px] font-medium leading-tight", STRIP_TONE[i.kind])}
              style={{ left: `${l}%`, width: `max(${r - l}%, 6px)` }}
            >
              <span className="block truncate">{i.title}</span>
            </div>
          );
        })}
        {visible.length === 0 && (
          <p className="absolute inset-0 grid place-items-center text-xs font-medium text-muted">Nothing on your calendar today</p>
        )}
        {nowPct !== null && (
          <div className="absolute inset-y-0 w-0.5 bg-danger" style={{ left: `${nowPct}%` }}>
            <span className="absolute -top-0 left-1 rounded bg-danger px-1 text-[10px] font-semibold text-white">now</span>
          </div>
        )}
      </div>
      <div className="relative mt-1.5 h-4 text-[11px] tabular-nums text-muted">
        {hours.map((m) => (
          <span key={m} className="absolute -translate-x-1/2" style={{ left: `${pos(new Date(zonedToISO(date, hh(Math.min(m, 23 * 60 + 59)), tz)).getTime())}%` }}>
            {m % 120 === 0 || hours.length <= 8 ? hh(m % (24 * 60)).replace(/^0/, "") : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
