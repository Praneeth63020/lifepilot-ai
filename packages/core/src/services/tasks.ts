import { and, asc, desc, eq, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { DateTime } from "luxon";
import { projects, subtasks, taskCompletions, tasks } from "@lifepilot/db";
import type { TaskCreateInput, TaskUpdateInput } from "@lifepilot/shared";
import { badRequest, notFound, type CoreContext } from "../context.js";
import { cancelTaskReminders, syncTaskReminders } from "./reminders.js";
import { getPrefs } from "./prefs.js";

export type TaskRow = typeof tasks.$inferSelect;
export type SubtaskRow = typeof subtasks.$inferSelect;
export type TaskWithSubtasks = TaskRow & { subtasks: SubtaskRow[] };

async function assertOwnedRefs(ctx: CoreContext, userId: string, input: { projectId?: string | null; dependsOnTaskId?: string | null }, selfId?: string) {
  if (input.projectId) {
    const p = await ctx.db.query.projects.findFirst({ where: and(eq(projects.id, input.projectId), eq(projects.userId, userId)) });
    if (!p) throw notFound("Project");
  }
  if (input.dependsOnTaskId) {
    if (input.dependsOnTaskId === selfId) throw badRequest("A task cannot depend on itself");
    const d = await ctx.db.query.tasks.findFirst({ where: and(eq(tasks.id, input.dependsOnTaskId), eq(tasks.userId, userId)) });
    if (!d) throw notFound("Dependency task");
    if (selfId && d.dependsOnTaskId === selfId) throw badRequest("Circular dependency");
  }
}

export async function getTask(ctx: CoreContext, userId: string, taskId: string): Promise<TaskWithSubtasks> {
  const t = await ctx.db.query.tasks.findFirst({ where: and(eq(tasks.id, taskId), eq(tasks.userId, userId)) });
  if (!t) throw notFound("Task");
  const subs = await ctx.db.query.subtasks.findMany({ where: eq(subtasks.taskId, t.id), orderBy: asc(subtasks.position) });
  return { ...t, subtasks: subs };
}

export async function createTask(
  ctx: CoreContext,
  userId: string,
  input: TaskCreateInput,
  source: { sourceType?: TaskRow["sourceType"]; sourceId?: string | null } = {},
): Promise<{ task: TaskWithSubtasks; created: boolean }> {
  await assertOwnedRefs(ctx, userId, input);
  const [row] = await ctx.db
    .insert(tasks)
    .values({
      userId,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      estimateMin: input.estimateMin ?? null,
      category: input.category ?? null,
      tags: input.tags ?? [],
      projectId: input.projectId ?? null,
      recurrence: input.recurrence,
      dependsOnTaskId: input.dependsOnTaskId ?? null,
      sourceType: source.sourceType ?? "manual",
      sourceId: source.sourceId ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) {
    // Same source item already produced a task (idempotent re-processing).
    const existing = await ctx.db.query.tasks.findFirst({
      where: and(eq(tasks.userId, userId), eq(tasks.sourceType, source.sourceType ?? "manual"), eq(tasks.sourceId, source.sourceId ?? "")),
    });
    if (!existing) throw new Error("Task insert conflicted but no existing task found");
    return { task: await getTask(ctx, userId, existing.id), created: false };
  }
  if (input.subtasks?.length) {
    await ctx.db.insert(subtasks).values(input.subtasks.map((title, i) => ({ taskId: row.id, userId, title, position: i })));
  }
  await syncTaskReminders(ctx, userId, row.id);
  return { task: await getTask(ctx, userId, row.id), created: true };
}

export async function updateTask(ctx: CoreContext, userId: string, taskId: string, input: TaskUpdateInput): Promise<TaskWithSubtasks> {
  const cur = await getTask(ctx, userId, taskId);
  await assertOwnedRefs(ctx, userId, input, taskId);
  const patch: Partial<typeof tasks.$inferInsert> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description ?? null;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.dueAt !== undefined) patch.dueAt = input.dueAt ? new Date(input.dueAt) : null;
  if (input.estimateMin !== undefined) patch.estimateMin = input.estimateMin ?? null;
  if (input.category !== undefined) patch.category = input.category ?? null;
  if (input.tags !== undefined) patch.tags = input.tags;
  if (input.projectId !== undefined) patch.projectId = input.projectId ?? null;
  if (input.recurrence !== undefined) patch.recurrence = input.recurrence;
  if (input.dependsOnTaskId !== undefined) patch.dependsOnTaskId = input.dependsOnTaskId ?? null;
  if (input.snoozedUntil !== undefined) patch.snoozedUntil = input.snoozedUntil ? new Date(input.snoozedUntil) : null;
  if (Object.keys(patch).length) await ctx.db.update(tasks).set(patch).where(eq(tasks.id, cur.id));
  await syncTaskReminders(ctx, userId, cur.id);
  return getTask(ctx, userId, cur.id);
}

function nextOccurrence(dueAt: Date, recurrence: TaskRow["recurrence"], tz: string): Date | null {
  const dt = DateTime.fromJSDate(dueAt, { zone: tz });
  if (recurrence === "daily") return dt.plus({ days: 1 }).toJSDate();
  if (recurrence === "weekly") return dt.plus({ weeks: 1 }).toJSDate();
  if (recurrence === "monthly") return dt.plus({ months: 1 }).toJSDate();
  return null;
}

export async function completeTask(ctx: CoreContext, userId: string, taskId: string): Promise<{ task: TaskWithSubtasks; next: TaskWithSubtasks | null; cancelledReminders: number }> {
  const cur = await getTask(ctx, userId, taskId);
  if (cur.status === "done") return { task: cur, next: null, cancelledReminders: 0 };
  const now = ctx.now();
  await ctx.db.update(tasks).set({ status: "done", completedAt: now }).where(eq(tasks.id, cur.id));
  await ctx.db.insert(taskCompletions).values({ taskId: cur.id, userId, completedAt: now });
  const cancelledReminders = await cancelTaskReminders(ctx, userId, cur.id);

  let next: TaskWithSubtasks | null = null;
  if (cur.recurrence !== "none" && cur.dueAt) {
    const prefs = await getPrefs(ctx, userId);
    let due = nextOccurrence(cur.dueAt, cur.recurrence, prefs.timezone);
    while (due && due <= now) due = nextOccurrence(due, cur.recurrence, prefs.timezone);
    if (due) {
      const created = await createTask(ctx, userId, {
        title: cur.title,
        description: cur.description,
        priority: cur.priority,
        dueAt: due.toISOString(),
        estimateMin: cur.estimateMin,
        category: cur.category,
        tags: cur.tags,
        projectId: cur.projectId,
        recurrence: cur.recurrence,
        subtasks: cur.subtasks.map((s) => s.title),
      });
      next = created.task;
    }
  }
  return { task: await getTask(ctx, userId, cur.id), next, cancelledReminders };
}

export async function reopenTask(ctx: CoreContext, userId: string, taskId: string): Promise<TaskWithSubtasks> {
  const cur = await getTask(ctx, userId, taskId);
  if (cur.status === "open") return cur;
  await ctx.db.update(tasks).set({ status: "open", completedAt: null }).where(eq(tasks.id, cur.id));
  const [last] = await ctx.db
    .select()
    .from(taskCompletions)
    .where(and(eq(taskCompletions.taskId, cur.id), isNull(taskCompletions.reopenedAt)))
    .orderBy(desc(taskCompletions.completedAt))
    .limit(1);
  if (last) await ctx.db.update(taskCompletions).set({ reopenedAt: ctx.now() }).where(eq(taskCompletions.id, last.id));
  await syncTaskReminders(ctx, userId, cur.id);
  return getTask(ctx, userId, cur.id);
}

export async function deleteTask(ctx: CoreContext, userId: string, taskId: string): Promise<void> {
  const cur = await getTask(ctx, userId, taskId);
  await cancelTaskReminders(ctx, userId, cur.id);
  await ctx.db.update(tasks).set({ dependsOnTaskId: null }).where(and(eq(tasks.userId, userId), eq(tasks.dependsOnTaskId, cur.id)));
  await ctx.db.delete(tasks).where(eq(tasks.id, cur.id));
}

export async function listTasks(
  ctx: CoreContext,
  userId: string,
  q: { status: "open" | "done" | "all"; q?: string; priority?: TaskRow["priority"]; projectId?: string; tag?: string; dueBefore?: string; sort: "due" | "priority" | "created"; limit: number; offset: number },
): Promise<{ items: TaskWithSubtasks[]; total: number }> {
  const conds: SQL[] = [eq(tasks.userId, userId)];
  if (q.status !== "all") conds.push(eq(tasks.status, q.status));
  if (q.q) {
    const term = `%${q.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    conds.push(or(ilike(tasks.title, term), ilike(tasks.description, term))!);
  }
  if (q.priority) conds.push(eq(tasks.priority, q.priority));
  if (q.projectId) conds.push(eq(tasks.projectId, q.projectId));
  if (q.tag) conds.push(sql`${q.tag} = any(${tasks.tags})`);
  if (q.dueBefore) conds.push(lte(tasks.dueAt, new Date(q.dueBefore)));
  const where = and(...conds);
  const priorityOrder = sql`case ${tasks.priority} when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`;
  const orderBy =
    q.sort === "priority"
      ? [priorityOrder, sql`${tasks.dueAt} asc nulls last`]
      : q.sort === "created"
        ? [desc(tasks.createdAt)]
        : [sql`${tasks.dueAt} asc nulls last`, priorityOrder];
  const rows = await ctx.db.select().from(tasks).where(where).orderBy(...orderBy).limit(q.limit).offset(q.offset);
  const [{ count } = { count: 0 }] = await ctx.db.select({ count: sql<number>`count(*)::int` }).from(tasks).where(where);
  const subs = rows.length
    ? await ctx.db.query.subtasks.findMany({ where: inArray(subtasks.taskId, rows.map((r) => r.id)), orderBy: asc(subtasks.position) })
    : [];
  return { items: rows.map((r) => ({ ...r, subtasks: subs.filter((s) => s.taskId === r.id) })), total: count };
}
