import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CalendarDays, Circle, Inbox, Lightbulb, Plus, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ConnectionDTO, DashboardDTO } from "@lifepilot/shared";
import { api, errorMessage } from "../api";
import { PlanTimeline } from "../components/PlanTimeline";
import { useToast } from "../components/toast";
import { Badge, Button, Card, Empty, ErrorNote, Input, PriorityBadge, Spinner } from "../components/ui";
import { fmtDate, fmtDateTime, fmtTime, relative } from "../lib/format";
import { useSession } from "../session";

function useClock(tz: string) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return { now, label: `${fmtDate(now, tz, { weekday: "long", month: "long", day: "numeric" })} · ${fmtTime(now, tz)}` };
}

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

export function DashboardPage() {
  const { me } = useSession();
  const tz = me!.preferences.timezone;
  const { now, label } = useClock(tz);
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const [quick, setQuick] = useState("");
  const q = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<DashboardDTO>("/dashboard"), refetchInterval: 60_000 });

  const add = useMutation({
    mutationFn: () => api.post("/tasks", { title: quick.trim() }),
    onSuccess: () => {
      setQuick("");
      qc.invalidateQueries();
      toast({ title: "Task added", body: "Add a due date or estimate from Tasks to help the planner.", tone: "success" });
    },
    onError: (e) => toast({ title: "Couldn't add task", body: errorMessage(e), tone: "error" }),
  });
  const complete = useMutation({
    mutationFn: (id: string) => api.post(`/tasks/${id}/complete`),
    onSuccess: () => qc.invalidateQueries(),
    onError: (e) => toast({ title: "Couldn't complete task", body: errorMessage(e), tone: "error" }),
  });
  const plan = useMutation({
    mutationFn: () => api.post("/plans/generate", {}),
    onSuccess: () => {
      qc.invalidateQueries();
      nav("/app/planner");
    },
    onError: (e) => toast({ title: "Planning failed", body: errorMessage(e), tone: "error" }),
  });

  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(now));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  if (q.isLoading) return <Spinner label="Loading your day" />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const total = d.progress.completedToday + d.progress.dueToday;
  const pct = total ? Math.round((d.progress.completedToday / total) * 100) : 0;
  const noData = d.progress.openTotal === 0 && d.upcomingEvents.length === 0 && d.importantEmails.length === 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{greeting}, {me!.user.name.split(" ")[0]}</h1>
          <p className="mt-1 text-sm text-muted">{label}</p>
        </div>
        <SyncStatus connections={d.connections} />
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (quick.trim()) add.mutate();
        }}
      >
        <label htmlFor="quick" className="sr-only">Quick add a task</label>
        <Input id="quick" value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="Quick add a task…" />
        <Button type="submit" variant="primary" loading={add.isPending} disabled={!quick.trim()}>
          <Plus className="size-4" /> Add
        </Button>
      </form>

      {noData && (
        <Card>
          <Empty icon={<Sparkles className="size-6" />} title="Nothing here yet" action={<Link to="/app/settings"><Button>Connect accounts or load demo data</Button></Link>}>
            Add a task above, create calendar events, or connect Gmail and Calendar so LifePilot can find deadlines for you.
          </Empty>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="flex flex-col gap-5 lg:col-span-2">
          <Card
            title="Today's priorities"
            action={<span className="text-xs text-muted">{d.progress.completedToday} done · {d.progress.dueToday} still due today</span>}
          >
            <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Today's completion">
              <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
            </div>
            {d.topTasks.length === 0 ? (
              <p className="text-sm text-muted">No open tasks. Enjoy the space — or add something above.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {d.topTasks.map((t, i) => (
                  <li key={t.taskId} className="flex items-start gap-3">
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">{i + 1}</span>
                    <span>
                      <span className="block text-sm font-medium">{t.title}</span>
                      <span className="block text-xs text-muted">{t.reason}</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card
            title="Schedule"
            action={
              d.plan ? (
                <Link to="/app/planner" className="text-sm text-accent">Open planner <ArrowRight className="inline size-3.5" /></Link>
              ) : null
            }
          >
            {d.plan ? (
              <>
                <p className="mb-2 text-xs text-muted">
                  {d.plan.status === "accepted" ? <Badge tone="ok">Accepted plan</Badge> : <Badge tone="accent">Proposed plan — review it in the planner</Badge>}
                </p>
                <PlanTimeline items={d.plan.items.filter((i) => new Date(i.endAt) > now)} tz={tz} now={now} compact />
              </>
            ) : (
              <Empty icon={<Sparkles className="size-6" />} title="No plan for today yet" action={<Button variant="primary" loading={plan.isPending} onClick={() => plan.mutate()}>Plan my day</Button>}>
                LifePilot fits your tasks between calendar events, inside your working hours.
              </Empty>
            )}
          </Card>

          <Card title="Due today" action={<Link to="/app/tasks" className="text-sm text-accent">All tasks</Link>}>
            {d.dueToday.length === 0 ? (
              <p className="text-sm text-muted">Nothing due today.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {d.dueToday.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 py-2">
                    <button aria-label={`Complete ${t.title}`} onClick={() => complete.mutate(t.id)} className="text-muted hover:text-accent">
                      <Circle className="size-5" />
                    </button>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{t.title}</span>
                      <span className={new Date(t.dueAt!) < now ? "text-xs text-danger" : "text-xs text-muted"}>
                        {new Date(t.dueAt!) < now ? "Overdue · " : ""}due {fmtDateTime(t.dueAt!, tz)}
                      </span>
                    </span>
                    <PriorityBadge priority={t.priority} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          {d.recommendations.length > 0 && (
            <Card title={<span className="flex items-center gap-1.5"><Lightbulb className="size-4 text-accent" /> Suggestions</span>}>
              <ul className="flex flex-col gap-2 text-sm">
                {d.recommendations.map((r) => <li key={r}>{r}</li>)}
              </ul>
              {d.plan && (
                <Button className="mt-3" size="sm" onClick={() => api.post("/plans/replan").then(() => { qc.invalidateQueries(); nav("/app/planner"); })}>
                  <RefreshCw className="size-3.5" /> Replan from now
                </Button>
              )}
            </Card>
          )}

          <Card title={<span className="flex items-center gap-1.5"><CalendarDays className="size-4 text-accent" /> Coming up</span>} action={<Link to="/app/calendar" className="text-sm text-accent">Calendar</Link>}>
            {d.upcomingEvents.length === 0 ? (
              <p className="text-sm text-muted">No events in the next day and a half.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {d.upcomingEvents.map((e) => (
                  <li key={e.id} className="text-sm">
                    <span className="font-medium">{e.title}</span>
                    <span className="block text-xs text-muted">{e.allDay ? `${fmtDate(e.startAt, tz)} · all day` : fmtDateTime(e.startAt, tz)}{e.source === "demo" ? " · demo" : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={<span className="flex items-center gap-1.5"><Inbox className="size-4 text-accent" /> Emails needing attention</span>} action={<Link to="/app/inbox" className="text-sm text-accent">Inbox</Link>}>
            {d.importantEmails.length === 0 ? (
              <p className="text-sm text-muted">{d.connections.some((c) => c.product === "gmail" && c.status === "active") ? "Nothing needs you right now." : "Connect Gmail (or load demo data) to see important emails here."}</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {d.importantEmails.map((i) => (
                  <li key={i.id} className="text-sm">
                    <span className="flex items-center gap-1.5 font-medium">
                      {i.suspicious && <AlertTriangle className="size-3.5 text-danger" aria-label="Suspicious" />}
                      <span className="truncate">{i.email.subject}</span>
                    </span>
                    <span className="block text-xs text-muted">{i.whyItMatters}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Upcoming deadlines">
            {d.deadlines.length === 0 ? (
              <p className="text-sm text-muted">No deadlines in the next week.</p>
            ) : (
              <ul className="flex flex-col gap-1.5 text-sm">
                {d.deadlines.map((x) => (
                  <li key={x.taskId} className="flex justify-between gap-2">
                    <span className="truncate">{x.title}</span>
                    <span className={x.overdue ? "shrink-0 text-xs text-danger" : "shrink-0 text-xs text-muted"}>{x.overdue ? "overdue" : fmtDate(x.dueAt, tz)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Recent reminders" action={<Link to="/app/notifications" className="text-sm text-accent">History</Link>}>
            {d.recentNotifications.length === 0 ? (
              <p className="text-sm text-muted">No reminders sent yet.</p>
            ) : (
              <ul className="flex flex-col gap-1.5 text-sm">
                {d.recentNotifications.map((n) => (
                  <li key={n.id}>
                    <span className="font-medium">{n.title}</span>
                    <span className="block text-xs text-muted">{relative(n.createdAt)}</span>
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
