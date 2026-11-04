import { eq } from "drizzle-orm";
import { userPreferences } from "@lifepilot/db";
import type { CoreContext } from "../context.js";

export type Prefs = typeof userPreferences.$inferSelect;

export async function getPrefs(ctx: CoreContext, userId: string): Promise<Prefs> {
  const row = await ctx.db.query.userPreferences.findFirst({ where: eq(userPreferences.userId, userId) });
  if (row) return row;
  const [created] = await ctx.db.insert(userPreferences).values({ userId }).onConflictDoNothing().returning();
  return created ?? (await ctx.db.query.userPreferences.findFirst({ where: eq(userPreferences.userId, userId) }))!;
}

export function quietOf(p: Prefs) {
  return { enabled: p.quietHoursEnabled, startMin: p.quietStartMin, endMin: p.quietEndMin };
}
