import { Router } from "express";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { projects, subtasks, tasks } from "@lifepilot/db";
import {
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
  const dto = (p: typeof projects.$inferSelect, openTasks: number): ProjectDTO => ({ id: p.id, name: p.name, color: p.color, openTasks });

  r.get("/", async (req, res) => {
    const userId = uid(req);
    const rows = await ctx.db.query.projects.findMany({ where: eq(projects.userId, userId), orderBy: asc(projects.name) });
    const counts = await ctx.db
      .select({ projectId: tasks.projectId, n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(eq(tasks.userId, userId), eq(tasks.status, "open"), isNotNull(tasks.projectId)))
      .groupBy(tasks.projectId);
    const byProject = new Map(counts.map((c) => [c.projectId, c.n]));
    res.json({ items: rows.map((p) => dto(p, byProject.get(p.id) ?? 0)) });
  });
  r.post("/", async (req, res) => {
    const input = parse(projectCreateSchema, req.body);
    const [p] = await ctx.db.insert(projects).values({ userId: uid(req), name: input.name, color: input.color ?? null }).returning();
    res.status(201).json(dto(p!, 0));
  });
  r.patch("/:id", async (req, res) => {
    const userId = uid(req);
    const input = parse(projectUpdateSchema, req.body);
    const [p] = await ctx.db
      .update(projects)
      .set({ ...(input.name !== undefined ? { name: input.name } : {}), ...(input.color !== undefined ? { color: input.color ?? null } : {}) })
      .where(and(eq(projects.id, idParam(req)), eq(projects.userId, userId)))
      .returning();
    if (!p) throw notFound("Project");
    const [{ n } = { n: 0 }] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(eq(tasks.userId, userId), eq(tasks.status, "open"), eq(tasks.projectId, p.id)));
    res.json(dto(p, n));
  });
  r.delete("/:id", async (req, res) => {
    const userId = uid(req);
    const [row] = await ctx.db.delete(projects).where(and(eq(projects.id, idParam(req)), eq(projects.userId, userId))).returning();
    if (!row) throw notFound("Project");
    res.status(204).end();
  });
  return r;
}
