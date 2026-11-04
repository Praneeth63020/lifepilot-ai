import { Router } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { tasks, userPreferences } from "@lifepilot/db";
import { getPrefs, syncTaskReminders, type CoreContext } from "@lifepilot/core";
import { preferencesSchema } from "@lifepilot/shared";
import { uid } from "../auth.js";
import { parse } from "../http.js";
import { prefsDTO } from "../serialize.js";

export function preferenceRoutes(ctx: CoreContext): Router {
  const r = Router();

  r.get("/", async (req, res) => {
    res.json(prefsDTO(await getPrefs(ctx, uid(req))));
  });

  r.patch("/", async (req, res) => {
    const userId = uid(req);
    const input = parse(preferencesSchema, req.body);
    const before = await getPrefs(ctx, userId);
    const { onboardingCompleted, ...rest } = input;
    const merged = { ...before, ...rest };
    if (merged.workStartMin >= merged.workEndMin) {
      res.status(400).json({ error: { code: "validation_error", message: "Work start must be before work end" } });
      return;
    }
    await ctx.db
      .update(userPreferences)
      .set({ ...rest, ...(onboardingCompleted !== undefined ? { onboardingCompletedAt: onboardingCompleted ? ctx.now() : null } : {}) })
      .where(eq(userPreferences.userId, userId));
    // Reminder-affecting changes re-plan every open task's reminders.
    const reminderKeys = ["timezone", "quietHoursEnabled", "quietStartMin", "quietEndMin", "reminderLeadMin", "maxRemindersPerTask"] as const;
    if (reminderKeys.some((k) => rest[k] !== undefined && rest[k] !== before[k])) {
      const open = await ctx.db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.userId, userId), inArray(tasks.status, ["open"])));
      for (const t of open) await syncTaskReminders(ctx, userId, t.id);
    }
    res.json(prefsDTO(await getPrefs(ctx, userId)));
  });

  return r;
}
