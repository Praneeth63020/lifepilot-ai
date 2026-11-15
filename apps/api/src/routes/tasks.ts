import { Router } from "express";
import { and, asc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { projects, subtasks, tasks } from "@lifepilot/db";
import {
  AppError,
  completeTask,
  createTask,
  deleteTask,
  getTask,
  listTasks,
  notFound,
  reopenTask,
  updateTask,
  type CoreContext,
} from "@lifepilot/core";
import {
  projectCreateSchema,
  projectUpdateSchema,
  subtaskCreateSchema,
  subtaskUpdateSchema,
  taskCreateSchema,
  taskListQuerySchema,
  taskUpdateSchema,
  type ProjectDTO,
} from "@lifepilot/shared";
import { uid } from "../auth.js";
import { idParam, parse } from "../http.js";
import { taskDTO } from "../serialize.js";

export function taskRoutes(ctx: CoreContext): Router {
  const r = Router();

  r.get("/", async (req, res) => {
    const q = parse(taskListQuerySchema, req.query);
    const { items, total } = await listTasks(ctx, uid(req), q);
    res.json({ items: items.map(taskDTO), total, limit: q.limit, offset: q.offset });
  });

  r.post("/", async (req, res) => {
    const input = parse(taskCreateSchema, req.body);
    const { task } = await createTask(ctx, uid(req), input);
    res.status(201).json(taskDTO(task));
  });

  r.get("/:id", async (req, res) => {
    res.json(taskDTO(await getTask(ctx, uid(req), idParam(req))));
  });

  r.patch("/:id", async (req, res) => {
    const input = parse(taskUpdateSchema, req.body);
    res.json(taskDTO(await updateTask(ctx, uid(req), idParam(req), input)));
  });

  r.delete("/:id", async (req, res) => {
    await deleteTask(ctx, uid(req), idParam(req));
    res.status(204).end();
  });

  r.post("/:id/complete", async (req, res) => {
    const out = await completeTask(ctx, uid(req), idParam(req));
    res.json({ task: taskDTO(out.task), next: out.next ? taskDTO(out.next) : null, cancelledReminders: out.cancelledReminders });
  });

  r.post("/:id/reopen", async (req, res) => {
    res.json(taskDTO(await reopenTask(ctx, uid(req), idParam(req))));
  });

  r.post("/:id/subtasks", async (req, res) => {
    const userId = uid(req);
    const task = await getTask(ctx, userId, idParam(req));
    const { title } = parse(subtaskCreateSchema, req.body);
    const [{ max } = { max: -1 }] = await ctx.db
      .select({ max: sql<number>`coalesce(max(${subtasks.position}), -1)::int` })
      .from(subtasks)
      .where(eq(subtasks.taskId, task.id));
    await ctx.db.insert(subtasks).values({ taskId: task.id, userId, title, position: max + 1 });
    res.status(201).json(taskDTO(await getTask(ctx, userId, task.id)));
  });

  return r;
}

export function subtaskRoutes(ctx: CoreContext): Router {
  const r = Router();
  r.patch("/:id", async (req, res) => {
    const userId = uid(req);
    const input = parse(subtaskUpdateSchema, req.body);
    const [row] = await ctx.db
      .update(subtasks)
      .set(input)
      .where(and(eq(subtasks.id, idParam(req)), eq(subtasks.userId, userId)))
      .returning();
    if (!row) throw notFound("Subtask");
    res.json(taskDTO(await getTask(ctx, userId, row.taskId)));
  });
  r.delete("/:id", async (req, res) => {
    const userId = uid(req);
    const [row] = await ctx.db.delete(subtasks).where(and(eq(subtasks.id, idParam(req)), eq(subtasks.userId, userId))).returning();
    if (!row) throw notFound("Subtask");
    res.json(taskDTO(await getTask(ctx, userId, row.taskId)));
  });
  return r;
}

export function projectRoutes(ctx: CoreContext): Router {
  const r = Router();

  /** Progress and deadline figures per project, derived from its tasks in two queries. */
  async function withStats(userId: string, rows: (typeof projects.$inferSelect)[]): Promise<ProjectDTO[]> {
    if (!rows.length) return [];
    const now = ctx.now();
    const ids = rows.map((p) => p.id);
    const stats = await ctx.db
      .select({
        projectId: tasks.projectId,
        open: sql<number>`count(*) filter (where ${tasks.status} = 'open')::int`,
        done: sql<number>`count(*) filter (where ${tasks.status} = 'done')::int`,
        overdue: sql<number>`count(*) filter (where ${tasks.status} = 'open' and ${tasks.dueAt} < ${now})::int`,
        lastDue: sql<Date | null>`max(${tasks.dueAt}) filter (where ${tasks.status} = 'open')`,
      })
      .from(tasks)
      .where(and(eq(tasks.userId, userId), inArray(tasks.projectId, ids)))
      .groupBy(tasks.projectId);
    // Earliest upcoming open deadline per project.
    const next = await ctx.db
      .selectDistinctOn([tasks.projectId], { projectId: tasks.projectId, taskId: tasks.id, title: tasks.title, dueAt: tasks.dueAt })
      .from(tasks)
      .where(and(eq(tasks.userId, userId), inArray(tasks.projectId, ids), eq(tasks.status, "open"), gte(tasks.dueAt, now)))
      .orderBy(tasks.projectId, asc(tasks.dueAt));
    const statBy = new Map(stats.map((x) => [x.projectId, x]));
    const nextBy = new Map(next.map((x) => [x.projectId, x]));
    return rows.map((p) => {
      const st = statBy.get(p.id);
      const nx = nextBy.get(p.id);
      const lastDue = st?.lastDue ? new Date(st.lastDue) : null;
      return {
        id: p.id,
        name: p.name,
        color: p.color,
        openTasks: st?.open ?? 0,
        doneTasks: st?.done ?? 0,
        overdueTasks: st?.overdue ?? 0,
        nextDue: nx ? { taskId: nx.taskId, title: nx.title, dueAt: nx.dueAt!.toISOString() } : null,
        lastDueAt: lastDue ? lastDue.toISOString() : null,
      };
    });
  }

  async function assertNameFree(userId: string, name: string, exceptId?: string) {
    const clash = await ctx.db.query.projects.findFirst({
      where: and(eq(projects.userId, userId), sql`lower(${projects.name}) = lower(${name})`, exceptId ? ne(projects.id, exceptId) : undefined),
    });
    if (clash) throw new AppError(409, "project_exists", `You already have a project called "${clash.name}"`);
  }

  r.get("/", async (req, res) => {
    const userId = uid(req);
    const rows = await ctx.db.query.projects.findMany({ where: eq(projects.userId, userId), orderBy: asc(projects.name) });
    res.json({ items: await withStats(userId, rows) });
  });
  r.get("/:id", async (req, res) => {
    const userId = uid(req);
    const p = await ctx.db.query.projects.findFirst({ where: and(eq(projects.id, idParam(req)), eq(projects.userId, userId)) });
    if (!p) throw notFound("Project");
    res.json((await withStats(userId, [p]))[0]);
  });
  r.post("/", async (req, res) => {
    const userId = uid(req);
    const input = parse(projectCreateSchema, req.body);
    await assertNameFree(userId, input.name);
    const [p] = await ctx.db.insert(projects).values({ userId, name: input.name, color: input.color ?? null }).returning();
    res.status(201).json((await withStats(userId, [p!]))[0]);
  });
  r.patch("/:id", async (req, res) => {
    const userId = uid(req);
    const id = idParam(req);
    const input = parse(projectUpdateSchema, req.body);
    if (input.name !== undefined) await assertNameFree(userId, input.name, id);
    const [p] = await ctx.db
      .update(projects)
      .set({ ...(input.name !== undefined ? { name: input.name } : {}), ...(input.color !== undefined ? { color: input.color ?? null } : {}) })
      .where(and(eq(projects.id, id), eq(projects.userId, userId)))
      .returning();
    if (!p) throw notFound("Project");
    res.json((await withStats(userId, [p]))[0]);
  });
  r.delete("/:id", async (req, res) => {
    const userId = uid(req);
    // Tasks are kept: the foreign key clears their project (ON DELETE SET NULL).
    const [row] = await ctx.db.delete(projects).where(and(eq(projects.id, idParam(req)), eq(projects.userId, userId))).returning();
    if (!row) throw notFound("Project");
    res.status(204).end();
  });
  return r;
}
