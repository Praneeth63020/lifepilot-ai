import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AlarmClock, BellPlus, CalendarClock, CheckCircle2, ChevronDown, Circle, FolderKanban, ListChecks, ListPlus, Mail, Pencil, Plus, Repeat, Search, Timer, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { ProjectDTO, TaskDTO } from "@lifepilot/shared";
import { api, errorMessage } from "../api";
import { TaskFormModal } from "../components/TaskForm";
import { useToast } from "../components/toast";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Menu, Modal, PageHeader, PriorityBadge, Select, Spinner, type MenuItem } from "../components/ui";
import { addDaysISO, fmtDateTime, localISODate, minutesLabel, zonedToISO } from "../lib/format";
import { useTz } from "../session";

export const PROJECT_COLORS = ["#4f46e5", "#0891b2", "#059669", "#d97706", "#dc2626", "#db2777", "#7c3aed", "#475569"];

export function ProjectDot({ color, className }: { color: string | null; className?: string }) {
  return <span aria-hidden className={clsx("inline-block size-2 shrink-0 rounded-full", className)} style={{ background: color ?? "var(--lp-muted)" }} />;
}

export function useProjects() {
  return useQuery({ queryKey: ["projects"], queryFn: () => api.get<{ items: ProjectDTO[] }>("/projects"), staleTime: 30_000 });
}

export function TasksPage() {
  const tz = useTz();
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<"open" | "done" | "all">("open");
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState("");
  const [projectId, setProjectId] = useState("");
  const [sort, setSort] = useState<"due" | "priority" | "created">("due");
  const [editing, setEditing] = useState<TaskDTO | null | "new">(null);
  const [reminderFor, setReminderFor] = useState<TaskDTO | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [managingProjects, setManagingProjects] = useState(false);

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
  const subToggle = useMutation({ mutationFn: (s: { id: string; done: boolean }) => api.patch(`/subtasks/${s.id}`, { done: !s.done }), onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }) });
  const subAdd = useMutation({ mutationFn: (v: { id: string; title: string }) => api.post(`/tasks/${v.id}/subtasks`, { title: v.title }), onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }) });

  const filtered = Boolean(search || priority || projectId);
  const activeProject = projectId ? projectById.get(projectId) : undefined;

  return (
    <div>
      <PageHeader
        title="Tasks"
        subtitle="Everything you need to do, in one list. Due times drive reminders and your daily plan."
        actions={
          <>
            <Button onClick={() => setManagingProjects(true)}><FolderKanban className="size-4" /> Projects</Button>
            <Button variant="primary" onClick={() => setEditing("new")}><Plus className="size-4" /> New task</Button>
          </>
        }
      />

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
        <Card className="!p-0">
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
            <ul className="divide-y divide-line">
              {q.data.items.map((t) => {
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
                      <button aria-label={t.status === "open" ? `Complete ${t.title}` : `Reopen ${t.title}`} onClick={() => toggle.mutate(t)} className={clsx("mt-0.5 shrink-0 rounded-full", t.status === "done" ? "text-ok" : "text-muted hover:text-accent")}>
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
              })}
            </ul>
          )}
          {q.data.total > q.data.items.length && <p className="border-t border-line px-5 py-3 text-xs text-muted">Showing {q.data.items.length} of {q.data.total}. Narrow the search to see more.</p>}
        </Card>
      )}

      {editing && <TaskFormModal key={editing === "new" ? "new" : editing.id} open onClose={() => setEditing(null)} task={editing === "new" ? null : editing} defaultProjectId={projectId || null} />}
      {reminderFor && <ReminderModal task={reminderFor} tz={tz} onClose={() => setReminderFor(null)} />}
      {managingProjects && <ProjectsModal onClose={() => setManagingProjects(false)} onDeleted={(id) => id === projectId && setProjectId("")} />}
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
        active ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-ink hover:bg-surface-2",
      )}
    >
      {children}
    </button>
  );
}

function ProjectsModal({ onClose, onDeleted }: { onClose: () => void; onDeleted: (id: string) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const projects = useProjects();
  const [name, setName] = useState("");
  const [color, setColor] = useState(PROJECT_COLORS[0]!);
  const refresh = () => qc.invalidateQueries();
  const fail = (title: string) => (e: unknown) => toast({ title, body: errorMessage(e), tone: "error" });
  const create = useMutation({
    mutationFn: () => api.post<ProjectDTO>("/projects", { name: name.trim(), color }),
    onSuccess: () => {
      setName("");
      setColor(PROJECT_COLORS[((projects.data?.items.length ?? 0) + 1) % PROJECT_COLORS.length]!);
      refresh();
    },
    onError: fail("Couldn't create project"),
  });
  const update = useMutation({
    mutationFn: (v: { id: string; name?: string; color?: string }) => api.patch<ProjectDTO>(`/projects/${v.id}`, { name: v.name, color: v.color }),
    onSuccess: refresh,
    onError: fail("Couldn't update project"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/projects/${id}`),
    onSuccess: (_r, id) => {
      onDeleted(id);
      refresh();
      toast({ title: "Project deleted", body: "Its tasks were kept without a project.", tone: "success" });
    },
    onError: fail("Couldn't delete project"),
  });

  return (
    <Modal open onClose={onClose} title="Projects" footer={<Button onClick={onClose}>Done</Button>}>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <Field label="New project" htmlFor="p-name">
          <div className="flex gap-2">
            <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Thesis, Home, Job search" maxLength={100} />
            <Button type="submit" variant="primary" loading={create.isPending} disabled={!name.trim()}>Add</Button>
          </div>
        </Field>
        <ColorPicker value={color} onChange={setColor} label="Colour for the new project" />
      </form>

      <div className="mt-5">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Your projects</p>
        {projects.isLoading && <Spinner label="Loading projects" />}
        {projects.data?.items.length === 0 && <p className="text-sm text-muted">No projects yet. Group related tasks, then filter by project on the Tasks page.</p>}
        <ul className="flex flex-col divide-y divide-line">
          {projects.data?.items.map((p) => (
            <li key={p.id} className="flex flex-col gap-2 py-2.5">
              <div className="flex items-center gap-2">
                <ProjectDot color={p.color} className="size-2.5" />
                <Input
                  aria-label={`Name of ${p.name}`}
                  defaultValue={p.name}
                  className="h-8"
                  maxLength={100}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== p.name) update.mutate({ id: p.id, name: v });
                    else e.target.value = p.name;
                  }}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                />
                <span className="w-16 shrink-0 text-right text-xs text-muted">{p.openTasks} open</span>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Delete ${p.name}`}
                  onClick={() => confirm(`Delete "${p.name}"? Its ${p.openTasks} open task(s) are kept without a project.`) && remove.mutate(p.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <ColorPicker value={p.color ?? ""} onChange={(c) => update.mutate({ id: p.id, color: c })} label={`Colour of ${p.name}`} compact />
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

function ColorPicker({ value, onChange, label, compact }: { value: string; onChange: (c: string) => void; label: string; compact?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className={clsx("flex flex-wrap gap-1.5", compact && "pl-[18px]")}>
      {PROJECT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          onClick={() => onChange(c)}
          className={clsx("rounded-full ring-offset-2 ring-offset-[var(--lp-surface)] transition", compact ? "size-4" : "size-6", value === c ? "ring-2 ring-[var(--lp-ink)]" : "hover:scale-110")}
          style={{ background: c }}
        />
      ))}
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
