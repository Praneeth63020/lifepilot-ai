import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AlarmClock, BellPlus, CalendarClock, CheckCircle2, ChevronDown, Circle, FolderKanban, ListChecks, ListPlus, Mail, Pencil, Plus, Repeat, Search, Timer, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { TaskDTO } from "@lifepilot/shared";
import { api, errorMessage } from "../api";
import { TaskFormModal } from "../components/TaskForm";
import { useToast } from "../components/toast";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Menu, Modal, PageHeader, PriorityBadge, Select, Spinner, buttonClass, type MenuItem, ProgressBar } from "../components/ui";
import { addDaysISO, fmtDateTime, localISODate, minutesLabel, zonedToISO } from "../lib/format";
import { useTz } from "../session";
import { ProjectDeadlines, ProjectDot, ProjectFormModal, ProjectProgress, useProjects } from "./Projects";

export function TasksPage() {
  const tz = useTz();
  const qc = useQueryClient();
  const toast = useToast();
  // The project filter lives in the URL (?project=…) so project pages can link straight to it;
  // the header search (?q=…) and dashboard links (?status=done) start here too.
  const [params, setParams] = useSearchParams();
  const initialStatus = params.get("status");
  const [status, setStatus] = useState<"open" | "done" | "all">(initialStatus === "done" || initialStatus === "all" ? initialStatus : "open");
  const [search, setSearch] = useState(params.get("q") ?? "");
  const urlQuery = params.get("q");
  useEffect(() => {
    if (urlQuery !== null) setSearch(urlQuery);
  }, [urlQuery]);
  const [priority, setPriority] = useState("");
  const projectId = params.get("project") ?? "";
  const setProjectId = (id: string) => setParams(id ? { project: id } : {}, { replace: true });
  const [sort, setSort] = useState<"due" | "priority" | "created">("due");
  const [editing, setEditing] = useState<TaskDTO | null | "new">(null);
  const [reminderFor, setReminderFor] = useState<TaskDTO | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editingProject, setEditingProject] = useState(false);

  const projects = useProjects();
  const projectById = new Map((projects.data?.items ?? []).map((p) => [p.id, p]));
  const q = useQuery({
    queryKey: ["tasks", status, search, priority, projectId, sort],
    queryFn: () => api.get<{ items: TaskDTO[]; total: number }>("/tasks", { status, q: search || undefined, priority: priority || undefined, projectId: projectId || undefined, sort }),
    placeholderData: keepPreviousData,
  });
  const done = (msg: string) => () => {
    qc.invalidateQueries();
    toast({ title: msg, tone: "success" });
  };
  const fail = (title: string) => (e: unknown) => toast({ title, body: errorMessage(e), tone: "error" });
  const toggle = useMutation({
    mutationFn: (t: TaskDTO) => api.post(`/tasks/${t.id}/${t.status === "open" ? "complete" : "reopen"}`),
    onSuccess: (_r, t) => done(t.status === "open" ? (t.recurrence !== "none" && t.dueAt ? "Done — next occurrence created" : "Done — reminders cancelled") : "Reopened")(),
    onError: fail("Couldn't update task"),
  });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/tasks/${id}`), onSuccess: done("Task deleted"), onError: fail("Couldn't delete task") });
  const postpone = useMutation({
    mutationFn: (t: TaskDTO) => api.patch(`/tasks/${t.id}`, { snoozedUntil: zonedToISO(addDaysISO(localISODate(new Date(), tz), 1), "00:00", tz) }),
    onSuccess: done("Hidden from today's plan"),
    onError: fail("Couldn't postpone"),
  });
  const subToggle = useMutation({
    mutationFn: (s: { id: string; done: boolean }) => api.patch(`/subtasks/${s.id}`, { done: !s.done }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
    onError: fail("Couldn't update subtask"),
  });
  const subAdd = useMutation({
    mutationFn: (v: { id: string; title: string }) => api.post(`/tasks/${v.id}/subtasks`, { title: v.title }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
    onError: fail("Couldn't add subtask"),
  });

  const filtered = Boolean(search || priority || projectId);
  const activeProject = projectId ? projectById.get(projectId) : undefined;
  const groups = groupTasks(q.data?.items ?? [], sort, tz);
  const items = q.data?.items ?? [];
  const now = new Date();
  const glance = {
    overdue: items.filter((t) => t.status === "open" && t.dueAt && new Date(t.dueAt) < now).length,
    today: items.filter((t) => t.status === "open" && t.dueAt && localISODate(new Date(t.dueAt), tz) === localISODate(now, tz)).length,
    noEstimate: items.filter((t) => t.status === "open" && !t.estimateMin).length,
    byPriority: (["urgent", "high", "medium", "low"] as const).map((p) => [p, items.filter((t) => t.status === "open" && t.priority === p).length] as const),
  };
  const renderTask = (t: TaskDTO) => {
                const overdue = t.status === "open" && t.dueAt && new Date(t.dueAt) < new Date();
                const subsDone = t.subtasks.filter((s) => s.done).length;
                const project = t.projectId ? projectById.get(t.projectId) : undefined;
                const menu: MenuItem[] = [
                  { label: t.subtasks.length ? "Show subtasks" : "Add subtasks", icon: <ListPlus className="size-4" />, onSelect: () => setExpanded(expanded === t.id ? null : t.id) },
                  { label: "Remind me…", icon: <BellPlus className="size-4" />, onSelect: () => setReminderFor(t) },
                  { label: "Not today", icon: <AlarmClock className="size-4" />, onSelect: () => postpone.mutate(t) },
                  { label: "Delete", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => confirm(`Delete "${t.title}"? This can't be undone.`) && remove.mutate(t.id) },
                ];
                return (
                  <li key={t.id} className={clsx("px-4 py-3 sm:px-5", overdue && "bg-danger/[0.03]")}>
                    <div className="flex items-start gap-3">
                      <button aria-label={t.status === "open" ? `Complete ${t.title}` : `Reopen ${t.title}`} onClick={() => toggle.mutate(t)} className={clsx("mt-0.5 shrink-0 rounded-full", t.status === "done" ? "text-ok" : "text-muted hover:text-accent-strong")}>
                        {t.status === "done" ? <CheckCircle2 className="size-5" /> : <Circle className="size-5" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className={clsx("text-sm font-medium leading-5", t.status === "done" && "text-muted line-through")}>{t.title}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                          <PriorityBadge priority={t.priority} />
                          {t.dueAt && (
                            <span className={clsx("inline-flex items-center gap-1", overdue && "font-medium text-danger")}>
                              <CalendarClock className="size-3.5" aria-hidden />
                              {overdue ? "Overdue · " : ""}{fmtDateTime(t.dueAt, tz)}
                            </span>
                          )}
                          {t.estimateMin ? (
                            <span className="inline-flex items-center gap-1"><Timer className="size-3.5" aria-hidden />{minutesLabel(t.estimateMin)}</span>
                          ) : (
                            t.status === "open" && <span title="The planner assumes 30 minutes">No estimate</span>
                          )}
                          {project && (
                            <button onClick={() => setProjectId(project.id)} className="inline-flex items-center gap-1 rounded-full border border-line px-1.5 py-px hover:text-ink" title={`Show ${project.name}`}>
                              <ProjectDot color={project.color} /> {project.name}
                            </button>
                          )}
                          {t.recurrence !== "none" && <Badge><Repeat className="size-3" /> {t.recurrence}</Badge>}
                          {t.sourceType === "email" && <Badge tone="accent"><Mail className="size-3" /> from email</Badge>}
                          {t.snoozedUntil && new Date(t.snoozedUntil) > new Date() && <Badge>not today</Badge>}
                          {t.tags.map((tag) => <Badge key={tag}>#{tag}</Badge>)}
                          {t.subtasks.length > 0 && (
                            <button className="inline-flex items-center gap-0.5 hover:text-ink" onClick={() => setExpanded(expanded === t.id ? null : t.id)} aria-expanded={expanded === t.id}>
                              {subsDone}/{t.subtasks.length} subtasks <ChevronDown className={clsx("size-3 transition-transform", expanded === t.id && "rotate-180")} />
                            </button>
                          )}
                        </div>
                        {t.description && <p className="mt-1.5 line-clamp-2 whitespace-pre-line text-xs text-muted">{t.description}</p>}
                        {expanded === t.id && (
                          <div className="mt-2 rounded-lg bg-surface-2 p-2">
                            {t.subtasks.length > 0 && (
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
                            )}
                            <form
                              className={clsx("flex gap-2", t.subtasks.length > 0 && "mt-2")}
                              onSubmit={(e) => {
                                e.preventDefault();
                                const input = e.currentTarget.elements.namedItem("sub") as HTMLInputElement;
                                if (input.value.trim()) subAdd.mutate({ id: t.id, title: input.value.trim() });
                                input.value = "";
                              }}
                            >
                              <Input name="sub" aria-label="New subtask" placeholder="Add a subtask" className="h-8" autoFocus />
                              <Button size="sm" type="submit">Add</Button>
                            </form>
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center">
                        {t.status === "open" && (
                          <>
                            <Button size="sm" variant="ghost" aria-label={`Edit ${t.title}`} title="Edit" onClick={() => setEditing(t)}><Pencil className="size-4" /></Button>
                            <Menu label={`More actions for ${t.title}`} items={menu} />
                          </>
                        )}
                        {t.status === "done" && (
                          <Button size="sm" variant="ghost" aria-label={`Delete ${t.title}`} title="Delete" onClick={() => confirm(`Delete "${t.title}"? This can't be undone.`) && remove.mutate(t.id)}><Trash2 className="size-4" /></Button>
                        )}
                      </div>
                    </div>
                  </li>
                );
  };

  return (
    <div>
      <PageHeader
        title="Tasks"
        subtitle="Everything you need to do, in one list. Due times drive reminders and your daily plan."
        actions={
          <>
            <Link to="/app/projects" className={buttonClass()}><FolderKanban className="size-4" /> Projects</Link>
            <Button variant="primary" onClick={() => setEditing("new")}><Plus className="size-4" /> New task</Button>
          </>
        }
      />

      {activeProject && (
        <Card className="mb-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <ProjectDot color={activeProject.color} className="size-2.5" />
                <h2 className="min-w-0 break-words font-semibold">{activeProject.name}</h2>
                <Button size="sm" variant="ghost" aria-label={`Edit project ${activeProject.name}`} onClick={() => setEditingProject(true)}><Pencil className="size-4" /></Button>
              </div>
              <div className="mt-3 max-w-md"><ProjectProgress project={activeProject} /></div>
            </div>
            <div className="sm:w-72"><ProjectDeadlines project={activeProject} tz={tz} /></div>
          </div>
        </Card>
      )}

      {(projects.data?.items.length ?? 0) > 0 && (
        <div role="group" aria-label="Filter by project" className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
          <Chip active={!projectId} onClick={() => setProjectId("")}>All projects</Chip>
          {projects.data!.items.map((p) => (
            <Chip key={p.id} active={projectId === p.id} onClick={() => setProjectId(projectId === p.id ? "" : p.id)}>
              <ProjectDot color={p.color} /> {p.name} <span className="text-muted">{p.openTasks}</span>
            </Chip>
          ))}
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-[2fr_1fr_1fr_1fr]">
        <div className="relative col-span-2 lg:col-span-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input aria-label="Search tasks" placeholder="Search tasks…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
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
        <Select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="col-span-2 lg:col-span-1">
          <option value="due">Sort by due date</option>
          <option value="priority">Sort by priority</option>
          <option value="created">Newest first</option>
        </Select>
      </div>

      {q.isLoading && <Spinner label="Loading tasks" />}
      {q.error && <ErrorNote error={q.error} onRetry={() => q.refetch()} />}
      {q.data && (
      <div className="grid gap-6 xl:grid-cols-12">
        <Card className="!p-0 self-start overflow-hidden xl:col-span-9">
          {q.data.items.length === 0 ? (
            <div className="p-4">
              <Empty
                icon={<ListChecks className="size-6" />}
                title={filtered ? "No matching tasks" : status === "done" ? "Nothing completed yet" : activeProject ? `No open tasks in ${activeProject.name}` : "No open tasks"}
                action={status === "open" && !search ? <Button onClick={() => setEditing("new")}>{activeProject ? "Add a task" : "Add your first task"}</Button> : undefined}
              >
                {filtered ? "Try clearing the search or filters." : status === "open" ? "Add what's on your mind. LifePilot schedules reminders and fits it into your day." : undefined}
              </Empty>
            </div>
          ) : (
            <ul className="divide-y divide-line" aria-label="Tasks">
              {groups.map((g) => (
                <li key={g.key}>
                  {g.label && (
                    <h3 className={clsx("flex items-center gap-2 border-b border-line bg-surface-2/60 px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em] sm:px-5", g.tone === "danger" ? "text-danger" : "text-muted")}>
                      {g.label} <span className="rounded-full bg-surface px-1.5 py-px text-[11px] font-medium normal-case tracking-normal text-muted">{g.items.length}</span>
                    </h3>
                  )}
                  <ul className="divide-y divide-line">{g.items.map(renderTask)}</ul>
                </li>
              ))}
            </ul>
          )}
          {q.data.total > q.data.items.length && <p className="border-t border-line px-5 py-3 text-xs text-muted">Showing {q.data.items.length} of {q.data.total}. Narrow the search to see more.</p>}
        </Card>
        <aside className="flex flex-col gap-6 xl:col-span-3">
          <Card title="At a glance" subtitle="In this view">
            <dl className="grid grid-cols-3 gap-3 xl:grid-cols-1 2xl:grid-cols-3">
              {[["Overdue", glance.overdue, glance.overdue ? "text-danger" : ""], ["Due today", glance.today, ""], ["No estimate", glance.noEstimate, ""]].map(([label, n, cls]) => (
                <div key={label as string} className="rounded-xl bg-surface-2 px-3 py-2.5">
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className={clsx("font-display text-2xl font-semibold", cls as string)}>{n}</dd>
                </div>
              ))}
            </dl>
            <p className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-muted">Open by priority</p>
            <ul className="flex flex-col gap-2">
              {glance.byPriority.map(([p, n]) => (
                <li key={p} className="flex items-center gap-3 text-sm">
                  <span className="w-16"><PriorityBadge priority={p} /></span>
                  <ProgressBar value={items.length ? (n / Math.max(1, items.filter((t) => t.status === "open").length)) * 100 : 0} label={`${p} priority share`} tone={p === "urgent" || p === "high" ? "accent" : "ink"} className="h-1.5 flex-1" />
                  <span className="w-6 text-right tabular-nums text-muted">{n}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="bg-accent-soft">
            <p className="text-sm font-semibold">Plan around it</p>
            <p className="mt-1 text-sm text-muted">Give tasks a due time and an estimate — the planner fits them between your meetings and reminders arrive on time.</p>
            <Link to="/app/planner" className={buttonClass({ variant: "dark", size: "sm", className: "mt-3" })}>Open planner</Link>
          </Card>
        </aside>
      </div>
      )}

      {editing && <TaskFormModal key={editing === "new" ? "new" : editing.id} open onClose={() => setEditing(null)} task={editing === "new" ? null : editing} defaultProjectId={projectId || null} />}
      {reminderFor && <ReminderModal task={reminderFor} tz={tz} onClose={() => setReminderFor(null)} />}
      {editingProject && activeProject && <ProjectFormModal project={activeProject} onClose={() => setEditingProject(false)} />}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={clsx(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
        active ? "border-accent bg-accent-soft text-accent-strong" : "border-line bg-surface text-ink hover:bg-surface-2",
      )}
    >
      {children}
    </button>
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

type TaskGroup = { key: string; label: string | null; tone?: "danger"; items: TaskDTO[] };

/** Sections for the list: by due date (overdue, today, …) or by priority; one flat list otherwise. */
function groupTasks(items: TaskDTO[], sort: "due" | "priority" | "created", tz: string): TaskGroup[] {
  if (sort === "created") return [{ key: "all", label: null, items }];
  if (sort === "priority") {
    const order = ["urgent", "high", "medium", "low"] as const;
    return order.map((p) => ({ key: p, label: `${p[0]!.toUpperCase()}${p.slice(1)} priority`, items: items.filter((t) => t.priority === p) })).filter((g) => g.items.length);
  }
  const now = new Date();
  const today = localISODate(now, tz);
  const tomorrow = addDaysISO(today, 1);
  const weekEnd = addDaysISO(today, 7);
  const buckets: TaskGroup[] = [
    { key: "overdue", label: "Overdue", tone: "danger", items: [] },
    { key: "today", label: "Today", items: [] },
    { key: "tomorrow", label: "Tomorrow", items: [] },
    { key: "week", label: "Next 7 days", items: [] },
    { key: "later", label: "Later", items: [] },
    { key: "none", label: "No due date", items: [] },
    { key: "done", label: "Completed", items: [] },
  ];
  const by = Object.fromEntries(buckets.map((b) => [b.key, b]));
  for (const t of items) {
    if (t.status === "done") by.done!.items.push(t);
    else if (!t.dueAt) by.none!.items.push(t);
    else if (new Date(t.dueAt) < now) by.overdue!.items.push(t);
    else {
      const day = localISODate(new Date(t.dueAt), tz);
      if (day === today) by.today!.items.push(t);
      else if (day === tomorrow) by.tomorrow!.items.push(t);
      else if (day <= weekEnd) by.week!.items.push(t);
      else by.later!.items.push(t);
    }
  }
  return buckets.filter((b) => b.items.length);
}
