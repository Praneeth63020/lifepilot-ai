import { Worker, type ConnectionOptions, type Job } from "bullmq";
import { eq } from "drizzle-orm";
import { notifications, reminders } from "@lifepilot/db";
import { REMINDER_QUEUE, SYNC_QUEUE, type ReminderJobData, type SyncJobData } from "@lifepilot/jobs";
import { processReminderJob, reconcileScheduledReminders, runSync, type CoreContext } from "@lifepilot/core";

export interface StartedWorkers {
  reminders: Worker<ReminderJobData>;
  sync: Worker<SyncJobData>;
  close(): Promise<void>;
}

export function startWorkers(ctx: CoreContext, connection: ConnectionOptions, prefix = "lifepilot"): StartedWorkers {
  const reminderWorker = new Worker<ReminderJobData>(
    REMINDER_QUEUE,
    async (job: Job<ReminderJobData>) => {
      const out = await processReminderJob(ctx, job.data);
      ctx.logger.info({ jobId: job.id, reminderId: job.data.reminderId, outcome: out }, "Reminder processed");
      return out;
    },
    { connection, prefix, concurrency: 10 },
  );

  // After the final retry fails, record the failure honestly instead of leaving it "scheduled" forever.
  reminderWorker.on("failed", async (job, err) => {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    ctx.logger.error({ jobId: job.id, err }, "Reminder delivery failed permanently");
    const r = await ctx.db.query.reminders.findFirst({ where: eq(reminders.id, job.data.reminderId) });
    if (!r || r.version !== job.data.version || r.status !== "scheduled") return;
    await ctx.db.update(reminders).set({ status: "fired", firedAt: ctx.now() }).where(eq(reminders.id, r.id));
    await ctx.db
      .insert(notifications)
      .values({
        userId: r.userId,
        reminderId: r.id,
        taskId: r.taskId,
        eventId: r.eventId,
        type: "delivery_failed",
        title: "A reminder could not be delivered",
        body: "Something went wrong while sending a reminder. Check your reminders list.",
        priority: r.priority,
        sound: "none",
        channel: "in_app",
        status: "failed",
        error: String(err?.message ?? err).slice(0, 500),
        idempotencyKey: `${r.id}:v${r.version}:failed`,
      })
      .onConflictDoNothing();
  });

  const syncWorker = new Worker<SyncJobData>(
    SYNC_QUEUE,
    async (job: Job<SyncJobData>) => {
      const out = await runSync(ctx, job.data.accountId);
      ctx.logger.info({ jobId: job.id, accountId: job.data.accountId, reason: job.data.reason, outcome: out }, "Sync processed");
      return out;
    },
    { connection, prefix, concurrency: 3 },
  );
  syncWorker.on("failed", (job, err) => ctx.logger.warn({ jobId: job?.id, err: err?.message }, "Sync attempt failed"));

  return {
    reminders: reminderWorker,
    sync: syncWorker,
    async close() {
      await Promise.all([reminderWorker.close(), syncWorker.close()]);
    },
  };
}

export { reconcileScheduledReminders };
