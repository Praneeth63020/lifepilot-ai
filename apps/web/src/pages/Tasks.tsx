import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AlarmClock, BellPlus, CheckCircle2, ChevronDown, Circle, Mail, Pencil, Plus, Repeat, Trash2 } from "lucide-react";
import { useState } from "react";
import type { TaskDTO } from "@lifepilot/shared";
import { api, errorMessage } from "../api";
import { TaskFormModal } from "../components/TaskForm";
import { useToast } from "../components/toast";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, PriorityBadge, Select, Spinner } from "../components/ui";
import { addDaysISO, fmtDateTime, localISODate, minutesLabel, zonedToISO } from "../lib/format";
import { useTz } from "../session";

export function TasksPage() {
  const tz = useTz();
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<"open" | "done" | "all">("open");
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState("");
  const [sort, setSort] = useState<"due" | "priority" | "created">("due");
  const [editing, setEditing] = useState<TaskDTO | null | "new">(null);
  const [reminderFor, setReminderFor] = useState<TaskDTO | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["tasks", status, search, priority, sort],
    queryFn: () => api.get<{ items: TaskDTO[]; total: number }>("/tasks", { status, q: search || undefined, priority: priority || undefined, sort }),
    placeholderData: keepPreviousData,
  });
  const done = (msg: string) => () => {
    qc.invalidateQueries();
    toast({ title: msg, tone: "success" });
  };
  const fail = (title: string) => (e: unknown) => toast({ title, body: errorMessage(e), tone: "error" });
  const toggle = useMutation({
    mutationFn: (t: TaskDTO) => api.post(`/tasks/${t.id}/${t.status === "open" ? "complete" : "reopen"}`),
    onSuccess: (_r, t) => done(t.status === "open" ? (t.recurrence !== "none" ? "Done — next occurrence created" : "Done — reminders cancelled") : "Reopened")(),
    onError: fail("Couldn't update task"),
  });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/tasks/${id}`), onSuccess: done("Task deleted"), onError: fail("Couldn't delete task") });
  const postpone = useMutation({
    mutationFn: (t: TaskDTO) => api.patch(`/tasks/${t.id}`, { snoozedUntil: zonedToISO(addDaysISO(localISODate(new Date(), tz), 1), "00:00", tz) }),
    onSuccess: done("Hidden from today's plan"),
    onError: fail("Couldn't postpone"),
  });
  const subToggle = useMutation({ mutationFn: (s: { id: string; done: boolean }) => api.patch(`/subtasks/${s.id}`, { done: !s.done }), onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }) });
  const subAdd = useMutation({ mutationFn: (v: { id: string; title: string }) => api.post(`/tasks/${v.id}/subtasks`, { title: v.title }), onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }) });

  return (
    <div>
      <PageHeader title="Tasks" subtitle="Everything works without Gmail or Calendar connected." actions={<Button variant="primary" onClick={() => setEditing("new")}><Plus className="size-4" /> New task</Button>} />

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        <Input aria-label="Search tasks" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className="sm:col-span-1" />
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="open">Open</option>
          <option value="done">Completed</option>
          <option value="all">All</option>
        </Select>
        <Select aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="">Any priority</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </Select>
        <Select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="due">Sort by due date</option>
          <option value="priority">Sort by priority</option>
          <option value="created">Newest first</option>
        </Select>
      </div>

      {q.isLoading && <Spinner label="Loading tasks" />}
      {q.error && <ErrorNote error={q.error} onRetry={() => q.refetch()} />}
      {q.data && (
        <Card>
          {q.data.items.length === 0 ? (
            <Empty title={search || priority ? "No matching tasks" : status === "done" ? "Nothing completed yet" : "No open tasks"} action={status === "open" && !search ? <Button onClick={() => setEditing("new")}>Add your first task</Button> : undefined} />
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {q.data.items.map((t) => {
                const overdue = t.status === "open" && t.dueAt && new Date(t.dueAt) < new Date();
                const subsDone = t.subtasks.filter((s) => s.done).length;
                return (
                  <li key={t.id} className="py-3">
                    <div className="flex items-start gap-3">
                      <button aria-label={t.status === "open" ? `Complete ${t.title}` : `Reopen ${t.title}`} onClick={() => toggle.mutate(t)} className={clsx("mt-0.5", t.status === "done" ? "text-ok" : "text-muted hover:text-accent")}>
                        {t.status === "done" ? <CheckCircle2 className="size-5" /> : <Circle className="size-5" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className={clsx("text-sm font-medium", t.status === "done" && "text-muted line-through")}>{t.title}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                          <PriorityBadge priority={t.priority} />
                          {t.dueAt && <span className={overdue ? "text-danger" : ""}>{overdue ? "Overdue · " : "Due "}{fmtDateTime(t.dueAt, tz)}</span>}
                          {t.estimateMin ? <span>· {minutesLabel(t.estimateMin)}</span> : <span title="The planner assumes 30 minutes">· no estimate</span>}
                          {t.recurrence !== "none" && <Badge><Repeat className="size-3" /> {t.recurrence}</Badge>}
                          {t.sourceType === "email" && <Badge tone="accent"><Mail className="size-3" /> from email</Badge>}
                          {t.snoozedUntil && new Date(t.snoozedUntil) > new Date() && <Badge>postponed</Badge>}
                          {t.tags.map((tag) => <Badge key={tag}>#{tag}</Badge>)}
                          {t.subtasks.length > 0 && (
                            <button className="flex items-center gap-0.5 hover:text-ink" onClick={() => setExpanded(expanded === t.id ? null : t.id)} aria-expanded={expanded === t.id}>
                              {subsDone}/{t.subtasks.length} subtasks <ChevronDown className="size-3" />
                            </button>
                          )}
                        </div>
                        {t.description && <p className="mt-1 whitespace-pre-line text-xs text-muted">{t.description}</p>}
                        {expanded === t.id && (
                          <div className="mt-2 rounded-lg bg-surface-2 p-2">
                            <ul className="flex flex-col gap-1">
                              {t.subtasks.map((s) => (
                                <li key={s.id}>
                                  <label className="flex items-center gap-2 text-sm">
                                    <input type="checkbox" checked={s.done} onChange={() => subToggle.mutate(s)} className="accent-[var(--lp-accent)]" />
                                    <span className={s.done ? "text-muted line-through" : ""}>{s.title}</span>
                                  </label>
                                </li>
                              ))}
                            </ul>
                            <form
                              className="mt-2 flex gap-2"
                              onSubmit={(e) => {
                                e.preventDefault();
                                const input = (e.currentTarget.elements.namedItem("sub") as HTMLInputElement);
                                if (input.value.trim()) subAdd.mutate({ id: t.id, title: input.value.trim() });
                                input.value = "";
                              }}
                            >
                              <Input name="sub" aria-label="New subtask" placeholder="Add subtask" className="h-8" />
                              <Button size="sm" type="submit">Add</Button>
                            </form>
                          </div>
                        )}
                      </div>
                      {t.status === "open" && (
                        <div className="flex shrink-0 gap-0.5">
                          {t.subtasks.length === 0 && <Button size="sm" variant="ghost" aria-label="Add subtasks" onClick={() => setExpanded(expanded === t.id ? null : t.id)}><Plus className="size-4" /></Button>}
                          <Button size="sm" variant="ghost" aria-label={`Remind me about ${t.title}`} onClick={() => setReminderFor(t)}><BellPlus className="size-4" /></Button>
                          <Button size="sm" variant="ghost" aria-label={`Postpone ${t.title}`} title="Not today" onClick={() => postpone.mutate(t)}><AlarmClock className="size-4" /></Button>
                          <Button size="sm" variant="ghost" aria-label={`Edit ${t.title}`} onClick={() => setEditing(t)}><Pencil className="size-4" /></Button>
                          <Button size="sm" variant="ghost" aria-label={`Delete ${t.title}`} onClick={() => confirm(`Delete "${t.title}"? This can't be undone.`) && remove.mutate(t.id)}><Trash2 className="size-4" /></Button>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {q.data.total > q.data.items.length && <p className="pt-3 text-xs text-muted">Showing {q.data.items.length} of {q.data.total}. Narrow the search to see more.</p>}
        </Card>
      )}

      {editing && <TaskFormModal key={editing === "new" ? "new" : editing.id} open onClose={() => setEditing(null)} task={editing === "new" ? null : editing} />}
      {reminderFor && <ReminderModal task={reminderFor} tz={tz} onClose={() => setReminderFor(null)} />}
    </div>
  );
}

function ReminderModal({ task, tz, onClose }: { task: TaskDTO; tz: string; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [date, setDate] = useState(localISODate(new Date(), tz));
  const [time, setTime] = useState(() => {
    const d = new Date(Date.now() + 60 * 60_000);
    return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  });
  const m = useMutation({
    mutationFn: () => api.post<{ remindAt: string }>("/reminders", { taskId: task.id, remindAt: zonedToISO(date, time, tz), note: task.title }),
    onSuccess: (r) => {
      toast({ title: "Reminder scheduled", body: `${fmtDateTime(r.remindAt, tz)} (adjusted for quiet hours if needed)`, tone: "success" });
      qc.invalidateQueries({ queryKey: ["reminders"] });
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title={`Remind me: ${task.title}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>Schedule</Button></>}>
      {m.error && <div className="mb-3"><ErrorNote error={new Error(errorMessage(m.error))} /></div>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date" htmlFor="r-d"><Input id="r-d" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Time" htmlFor="r-t"><Input id="r-t" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
