import { Router } from "express";
import { and, asc, eq, sql } from "drizzle-orm";
import { projects, subtasks } from "@lifepilot/db";
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
  subtaskCreateSchema,
  subtaskUpdateSchema,
  taskCreateSchema,
  taskListQuerySchema,
  taskUpdateSchema,
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
  r.get("/", async (req, res) => {
    const rows = await ctx.db.query.projects.findMany({ where: eq(projects.userId, uid(req)), orderBy: asc(projects.name) });
    res.json({ items: rows.map((p) => ({ id: p.id, name: p.name, color: p.color })) });
  });
  r.post("/", async (req, res) => {
    const input = parse(projectCreateSchema, req.body);
    const [p] = await ctx.db.insert(projects).values({ userId: uid(req), name: input.name, color: input.color ?? null }).returning();
    res.status(201).json({ id: p!.id, name: p!.name, color: p!.color });
  });
  r.delete("/:id", async (req, res) => {
    const userId = uid(req);
    const [row] = await ctx.db.delete(projects).where(and(eq(projects.id, idParam(req)), eq(projects.userId, userId))).returning();
    if (!row) throw notFound("Project");
    res.status(204).end();
  });
  return r;
}
