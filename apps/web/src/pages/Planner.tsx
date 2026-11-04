import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Pencil, RefreshCw, Sparkles, X } from "lucide-react";
import { useState } from "react";
import type { DailyPlanDTO, PlanItemDTO } from "@lifepilot/shared";
import { api, errorMessage } from "../api";
import { PlanLegend, PlanTimeline } from "../components/PlanTimeline";
import { useToast } from "../components/toast";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Spinner } from "../components/ui";
import { addDaysISO, fmtDate, fmtTime, isoToZoned, localISODate, minutesLabel, zonedToISO } from "../lib/format";
import { useTz } from "../session";

export function PlannerPage() {
  const tz = useTz();
  const today = localISODate(new Date(), tz);
  const [date, setDate] = useState(today);
  const [editing, setEditing] = useState<PlanItemDTO | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const key = ["plan", date];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<{ plan: DailyPlanDTO | null }>("/plans/current", { date }) });
  const plan = q.data?.plan ?? null;

  const onErr = (title: string) => (e: unknown) => toast({ title, body: errorMessage(e), tone: "error" });
  const setPlan = (p: DailyPlanDTO) => {
    qc.setQueryData(key, { plan: p });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
  const generate = useMutation({ mutationFn: () => api.post<{ plan: DailyPlanDTO }>("/plans/generate", { date }), onSuccess: (r) => setPlan(r.plan), onError: onErr("Planning failed") });
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

  return (
    <div>
      <PageHeader
        title="Daily planner"
        subtitle="Suggestions are built from your tasks, calendar and working hours. Nothing changes until you accept it, and your calendar is never edited."
        actions={
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
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <Button size="sm" variant="ghost" aria-label="Previous day" onClick={() => setDate(addDaysISO(date, -1))}><ChevronLeft className="size-4" /></Button>
        <Input type="date" aria-label="Plan date" className="w-auto" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <Button size="sm" variant="ghost" aria-label="Next day" onClick={() => setDate(addDaysISO(date, 1))}><ChevronRight className="size-4" /></Button>
        {date !== today && <Button size="sm" variant="ghost" onClick={() => setDate(today)}>Today</Button>}
      </div>

      {q.isLoading && <Spinner label="Loading plan" />}
      {q.error && <ErrorNote error={q.error} onRetry={() => q.refetch()} />}
      {!q.isLoading && !plan && (
        <Card>
          <Empty icon={<Sparkles className="size-6" />} title={`No plan for ${fmtDate(zonedToISO(date, "12:00", tz), tz)}`} action={<Button variant="primary" onClick={() => generate.mutate()} loading={generate.isPending}>Generate plan</Button>}>
            The planner never schedules over calendar events, stays inside your working hours, and adds breaks and preparation time.
          </Empty>
        </Card>
      )}

      {plan && (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="flex flex-col gap-5 lg:col-span-2">
            <Card
              title={
                <span className="flex items-center gap-2">
                  Schedule
                  {plan.status === "accepted" ? <Badge tone="ok">Accepted</Badge> : plan.status === "proposed" ? <Badge tone="accent">Proposed</Badge> : <Badge>{plan.status}</Badge>}
                </span>
              }
              action={
                plan.status === "proposed" && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => reject.mutate(plan.id)} loading={reject.isPending}><X className="size-4" /> Reject</Button>
                    <Button size="sm" variant="primary" onClick={() => accept.mutate(plan.id)} loading={accept.isPending}><Check className="size-4" /> Accept</Button>
                  </div>
                )
              }
            >
              {plan.warnings.length > 0 && (
                <ul className="mb-3 flex flex-col gap-1.5">
                  {plan.warnings.map((w) => (
                    <li key={w} className="flex gap-2 rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn"><AlertTriangle className="mt-0.5 size-4 shrink-0" /> {w}</li>
                  ))}
                </ul>
              )}
              {plan.changes && plan.changes.length > 0 && plan.status === "proposed" && (
                <div className="mb-3 rounded-lg border border-accent/30 bg-accent-soft p-3 text-sm">
                  <p className="font-medium">What changed</p>
                  <ul className="mt-1 text-muted">
                    {plan.changes.map((c) => (
                      <li key={c.taskId + c.change}>
                        {c.title}: {c.change === "moved" ? `moved ${fmtTime(c.from!, tz)} → ${fmtTime(c.to!, tz)}` : c.change === "added" ? `added at ${fmtTime(c.to!, tz)}` : "no longer fits today"}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="mb-3"><PlanLegend /></div>
              {plan.items.length === 0 ? (
                <p className="text-sm text-muted">Nothing scheduled.</p>
              ) : (
                <div className="flex flex-col">
                  <PlanTimeline items={plan.items} tz={tz} />
                  {plan.status !== "superseded" && plan.items.some((i) => !i.isFact) && (
                    <details className="mt-3 text-sm">
                      <summary className="cursor-pointer text-muted">Adjust a suggested block</summary>
                      <ul className="mt-2 flex flex-col gap-1">
                        {plan.items.filter((i) => !i.isFact).map((i) => (
                          <li key={i.id} className="flex items-center justify-between gap-2">
                            <span className="truncate">{fmtTime(i.startAt, tz)} · {i.title}</span>
                            <Button size="sm" variant="ghost" onClick={() => setEditing(i)} aria-label={`Move ${i.title}`}><Pencil className="size-3.5" /> Move</Button>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}
              <p className="mt-3 text-xs text-muted">
                {minutesLabel(plan.stats.freeMinutes)} free in working hours · {minutesLabel(plan.stats.scheduledTaskMinutes)} of task time scheduled · generated {fmtTime(plan.generatedAt, tz)} by {plan.generator}
              </p>
            </Card>
          </div>

          <div className="flex flex-col gap-5">
            <Card title="Top 3 and why">
              {plan.topTasks.length === 0 ? <p className="text-sm text-muted">No open tasks.</p> : (
                <ol className="flex flex-col gap-2 text-sm">
                  {plan.topTasks.map((t, i) => (
                    <li key={t.taskId}><span className="font-medium">{i + 1}. {t.title}</span><span className="block text-xs text-muted">{t.reason}</span></li>
                  ))}
                </ol>
              )}
            </Card>
            <Card title="Needs time soon">
              {plan.unscheduled.length === 0 ? <p className="text-sm text-muted">Everything urgent fits.</p> : (
                <ul className="flex flex-col gap-2 text-sm">
                  {plan.unscheduled.map((t) => <li key={t.taskId}><span className="font-medium">{t.title}</span><span className="block text-xs text-muted">{t.reason}</span></li>)}
                </ul>
              )}
            </Card>
            <Card title="Can wait">
              {plan.postponable.length === 0 ? <p className="text-sm text-muted">Nothing to postpone.</p> : (
                <ul className="flex flex-col gap-2 text-sm">
                  {plan.postponable.map((t) => (
                    <li key={t.taskId} className="flex items-start justify-between gap-2">
                      <span><span className="font-medium">{t.title}</span><span className="block text-xs text-muted">{t.reason}</span></span>
                      <Button size="sm" variant="ghost" onClick={() => postpone.mutate(t.taskId)}>Not today</Button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Deadlines this week">
              {plan.deadlines.length === 0 ? <p className="text-sm text-muted">None.</p> : (
                <ul className="flex flex-col gap-1.5 text-sm">
                  {plan.deadlines.map((d) => (
                    <li key={d.taskId} className="flex justify-between gap-2"><span className="truncate">{d.title}</span><span className={d.overdue ? "text-xs text-danger" : "text-xs text-muted"}>{d.overdue ? "overdue" : fmtDate(d.dueAt, tz)}</span></li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}

      {editing && plan && <MoveBlockModal item={editing} plan={plan} tz={tz} onClose={() => setEditing(null)} onSaved={setPlan} />}
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
      <Field label="New start time" htmlFor="mv" hint={`Keeps its ${minutesLabel(Math.round(dur / 60000))} length. Can't overlap a calendar event.`}>
        <Input id="mv" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      </Field>
    </Modal>
  );
}
