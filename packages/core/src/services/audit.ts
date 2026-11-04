import { auditLogs } from "@lifepilot/db";
import type { CoreContext } from "../context.js";

/** Append-only security/audit trail. Never stores secrets or message content. */
export async function audit(
  ctx: Pick<CoreContext, "db" | "logger">,
  userId: string | null,
  action: string,
  targetType?: string,
  targetId?: string,
  metadata?: Record<string, unknown>,
  ip?: string,
): Promise<void> {
  try {
    await ctx.db.insert(auditLogs).values({ userId, action, targetType, targetId, metadata: metadata ?? null, ip });
  } catch (err) {
    ctx.logger.error({ err, action }, "Failed to write audit log");
  }
}
