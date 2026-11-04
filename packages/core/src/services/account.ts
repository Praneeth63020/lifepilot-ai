import { eq } from "drizzle-orm";
import {
  auditLogs,
  calendarEvents,
  connectedAccounts,
  dailyPlanItems,
  dailyPlans,
  emailInsights,
  notifications,
  projects,
  reminders,
  subtasks,
  syncedEmails,
  taskCompletions,
  tasks,
  userPreferences,
  users,
} from "@lifepilot/db";
import type { CoreContext } from "../context.js";
import { disconnect } from "./connections.js";

/** Everything we hold about a user, minus secrets (password hash, OAuth tokens). */
export async function exportUserData(ctx: CoreContext, userId: string) {
  const user = await ctx.db.query.users.findFirst({ where: eq(users.id, userId) });
  const strip = <T extends Record<string, unknown>>(rows: T[], keys: string[]) =>
    rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !keys.includes(k))));
  return {
    exportedAt: ctx.now().toISOString(),
    user: user ? { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt, emailVerifiedAt: user.emailVerifiedAt } : null,
    preferences: await ctx.db.query.userPreferences.findFirst({ where: eq(userPreferences.userId, userId) }),
    connectedAccounts: strip(await ctx.db.query.connectedAccounts.findMany({ where: eq(connectedAccounts.userId, userId) }), [
      "accessTokenEnc",
      "refreshTokenEnc",
    ]),
    projects: await ctx.db.query.projects.findMany({ where: eq(projects.userId, userId) }),
    tasks: await ctx.db.query.tasks.findMany({ where: eq(tasks.userId, userId) }),
    subtasks: await ctx.db.query.subtasks.findMany({ where: eq(subtasks.userId, userId) }),
    taskCompletions: await ctx.db.query.taskCompletions.findMany({ where: eq(taskCompletions.userId, userId) }),
    calendarEvents: await ctx.db.query.calendarEvents.findMany({ where: eq(calendarEvents.userId, userId) }),
    syncedEmails: await ctx.db.query.syncedEmails.findMany({ where: eq(syncedEmails.userId, userId) }),
    emailInsights: await ctx.db.query.emailInsights.findMany({ where: eq(emailInsights.userId, userId) }),
    reminders: await ctx.db.query.reminders.findMany({ where: eq(reminders.userId, userId) }),
    notifications: await ctx.db.query.notifications.findMany({ where: eq(notifications.userId, userId) }),
    dailyPlans: await ctx.db.query.dailyPlans.findMany({ where: eq(dailyPlans.userId, userId) }),
    dailyPlanItems: await ctx.db.query.dailyPlanItems.findMany({ where: eq(dailyPlanItems.userId, userId) }),
    auditLog: await ctx.db.query.auditLogs.findMany({ where: eq(auditLogs.userId, userId) }),
  };
}

/** Revoke Google access, unschedule jobs, then delete the user (FK cascades remove all owned rows). */
export async function deleteUserAccount(ctx: CoreContext, userId: string): Promise<void> {
  await disconnect(ctx, userId, "gmail", true);
  await disconnect(ctx, userId, "calendar", true);
  const scheduled = await ctx.db.query.reminders.findMany({ where: eq(reminders.userId, userId) });
  for (const r of scheduled) {
    if (r.status === "scheduled") await ctx.jobs.cancelReminder(r.id, r.version).catch(() => undefined);
  }
  await ctx.db.delete(users).where(eq(users.id, userId));
  ctx.logger.info({ userId }, "User account deleted");
}
