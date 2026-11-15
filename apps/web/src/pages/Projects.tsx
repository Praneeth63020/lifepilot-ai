import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertTriangle, ArrowRight, CalendarClock, FolderKanban, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { ProjectDTO } from "@lifepilot/shared";
import { api, errorMessage } from "../api";
import { useToast } from "../components/toast";
import { Button, Card, Empty, ErrorNote, Field, Input, Menu, Modal, PageHeader, Spinner, buttonClass } from "../components/ui";
import { fmtDate, fmtDateTime } from "../lib/format";
import { useTz } from "../session";

export const PROJECT_COLORS = ["#4f46e5", "#0891b2", "#059669", "#d97706", "#dc2626", "#db2777", "#7c3aed", "#475569"];

export function ProjectDot({ color, className }: { color: string | null; className?: string }) {
  return <span aria-hidden className={clsx("inline-block size-2 shrink-0 rounded-full", className)} style={{ background: color ?? "var(--lp-muted)" }} />;
}

export function useProjects() {
  return useQuery({ queryKey: ["projects"], queryFn: () => api.get<{ items: ProjectDTO[] }>("/projects"), staleTime: 30_000 });
}

export function ColorPicker({ value, onChange, label }: { value: string; onChange: (c: string) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {PROJECT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          onClick={() => onChange(c)}
          className={clsx("size-7 rounded-full ring-offset-2 ring-offset-[var(--lp-surface)] transition", value === c ? "ring-2 ring-[var(--lp-ink)]" : "hover:scale-110")}
          style={{ background: c }}
        />
      ))}
    </div>
  );
}

/** Share of a project's tasks that are done, as a labelled bar. */
export function ProjectProgress({ project }: { project: ProjectDTO }) {
  const total = project.openTasks + project.doneTasks;
  const pct = total ? Math.round((project.doneTasks / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-muted">
        <span>{total ? `${project.doneTasks} of ${total} done` : "No tasks yet"}</span>
        {total > 0 && <span>{pct}%</span>}
      </div>
      <div role="progressbar" aria-label={`${project.name} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: project.color ?? "var(--lp-accent)" }} />
      </div>
    </div>
  );
}

/** Deadline summary: overdue work, the next deadline, and when the remaining work is due. */
export function ProjectDeadlines({ project, tz }: { project: ProjectDTO; tz: string }) {
  if (!project.overdueTasks && !project.nextDue && !project.lastDueAt) {
    return <p className="text-xs text-muted">{project.openTasks ? "No due dates on open tasks." : "Nothing open."}</p>;
  }
  return (
    <ul className="flex flex-col gap-1 text-xs">
      {project.overdueTasks > 0 && (
        <li className="flex items-center gap-1.5 font-medium text-danger">
          <AlertTriangle className="size-3.5" aria-hidden /> {project.overdueTasks} overdue
        </li>
      )}
      {project.nextDue && (
        <li className="flex items-start gap-1.5">
          <CalendarClock className="mt-px size-3.5 shrink-0 text-muted" aria-hidden />
          <span>
            <span className="text-muted">Next:</span> {project.nextDue.title} · {fmtDateTime(project.nextDue.dueAt, tz)}
          </span>
        </li>
      )}
      {project.lastDueAt && project.lastDueAt !== project.nextDue?.dueAt && (
        <li className="text-muted">All open work due by {fmtDate(project.lastDueAt, tz)}</li>
      )}
    </ul>
  );
}

export function ProjectFormModal({ project, onClose, onSaved }: { project?: ProjectDTO | null; onClose: () => void; onSaved?: (p: ProjectDTO) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const projects = useProjects();
  const [name, setName] = useState(project?.name ?? "");
  const [color, setColor] = useState(project?.color ?? PROJECT_COLORS[(projects.data?.items.length ?? 0) % PROJECT_COLORS.length]!);
  const trimmed = name.trim();
  // Same rule as the server, checked as you type.
  const duplicate = projects.data?.items.find((p) => p.id !== project?.id && p.name.toLowerCase() === trimmed.toLowerCase());
  const m = useMutation({
    mutationFn: () => (project ? api.patch<ProjectDTO>(`/projects/${project.id}`, { name: trimmed, color }) : api.post<ProjectDTO>("/projects", { name: trimmed, color })),
    onSuccess: (p) => {
      qc.invalidateQueries();
      toast({ title: project ? "Project updated" : "Project created", tone: "success" });
      onSaved?.(p);
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={project ? "Edit project" : "New project"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} disabled={!trimmed || Boolean(duplicate)} onClick={() => m.mutate()}>
            {project ? "Save" : "Create project"}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed && !duplicate) m.mutate();
        }}
      >
        {m.error && <ErrorNote error={new Error(errorMessage(m.error))} />}
        <Field label="Name" htmlFor="p-name" hint={duplicate ? undefined : "e.g. Thesis, Home move, Job search"}>
          <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} aria-invalid={Boolean(duplicate)} aria-describedby={duplicate ? "p-name-dup" : undefined} />
          {duplicate && <p id="p-name-dup" className="mt-1 text-xs text-danger">You already have a project called "{duplicate.name}".</p>}
        </Field>
        <Field label="Colour" htmlFor="p-color">
          <ColorPicker value={color} onChange={setColor} label="Project colour" />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function ProjectsPage() {
  const tz = useTz();
  const qc = useQueryClient();
  const toast = useToast();
  const projects = useProjects();
  const [editing, setEditing] = useState<ProjectDTO | "new" | null>(null);
  const remove = useMutation({
    mutationFn: (p: ProjectDTO) => api.del(`/projects/${p.id}`),
    onSuccess: () => {
      qc.invalidateQueries();
      toast({ title: "Project deleted", body: "Its tasks were kept, without a project.", tone: "success" });
    },
    onError: (e) => toast({ title: "Couldn't delete project", body: errorMessage(e), tone: "error" }),
  });
  const confirmDelete = (p: ProjectDTO) =>
    confirm(`Delete "${p.name}"? ${p.openTasks + p.doneTasks ? `Its ${p.openTasks + p.doneTasks} task(s) are kept, without a project.` : "It has no tasks."}`) && remove.mutate(p);

  const items = projects.data?.items ?? [];
  return (
    <div>
      <PageHeader
        title="Projects"
        subtitle="Group related tasks, track progress and see what's due next."
        actions={<Button variant="primary" onClick={() => setEditing("new")}><Plus className="size-4" /> New project</Button>}
      />
      {projects.isLoading && <Spinner label="Loading projects" />}
      {projects.error && <ErrorNote error={projects.error} onRetry={() => projects.refetch()} />}
      {projects.data && items.length === 0 && (
        <Card>
          <Empty icon={<FolderKanban className="size-6" />} title="No projects yet" action={<Button variant="primary" onClick={() => setEditing("new")}>Create a project</Button>}>
            Use a project for anything with several steps, like a thesis, a move or a job search. Then assign tasks to it and follow progress here.
          </Empty>
        </Card>
      )}
      {items.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((p) => (
            <li key={p.id}>
              <Card className="flex h-full flex-col gap-4">
                <div className="flex items-start gap-2">
                  <ProjectDot color={p.color} className="mt-1.5 size-2.5" />
                  <Link to={`/app/tasks?project=${p.id}`} className="min-w-0 flex-1 break-words font-semibold hover:text-accent">
                    {p.name}
                  </Link>
                  <Menu
                    label={`More actions for ${p.name}`}
                    items={[
                      { label: "Edit", icon: <Pencil className="size-4" />, onSelect: () => setEditing(p) },
                      { label: "Delete", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => confirmDelete(p) },
                    ]}
                  />
                </div>
                <ProjectProgress project={p} />
                <ProjectDeadlines project={p} tz={tz} />
                <div className="mt-auto flex items-center justify-between border-t border-line pt-3 text-xs text-muted">
                  <span>{p.openTasks} open</span>
                  <Link to={`/app/tasks?project=${p.id}`} className={buttonClass({ variant: "ghost", size: "sm" })}>
                    View tasks <ArrowRight className="size-3.5" />
                  </Link>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {editing && <ProjectFormModal project={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
