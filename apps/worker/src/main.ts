import { ConfigError, createCoreContext, failInterruptedSyncJobs, loadConfig, reconcileScheduledReminders } from "@lifepilot/core";
import { createRedis } from "@lifepilot/jobs";
import { startWorkers } from "./workers.js";

let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`\n[LifePilot worker] ${err.message}\n`);
    process.exit(1);
  }
  throw err;
}

const { ctx, close } = createCoreContext(config, "worker");
// Workers need their own blocking connection.
const workerRedis = createRedis(config.redisUrl);
const workers = startWorkers(ctx, workerRedis);

// Reminders persist in Postgres; make sure every scheduled one has a queue job (e.g. after Redis data loss).
reconcileScheduledReminders(ctx)
  .then((n) => ctx.logger.info({ reconciled: n }, "LifePilot worker started"))
  .catch((err) => ctx.logger.error({ err }, "Reminder reconciliation failed"));

// Sync jobs left "running" by a crash would otherwise show as running forever in Settings.
const sweepInterruptedSyncs = () =>
  failInterruptedSyncJobs(ctx)
    .then((n) => n && ctx.logger.warn({ count: n }, "Marked interrupted sync jobs as failed"))
    .catch((err) => ctx.logger.error({ err }, "Interrupted-sync sweep failed"));
void sweepInterruptedSyncs();
const sweepTimer = setInterval(sweepInterruptedSyncs, 10 * 60_000);
sweepTimer.unref();

let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(sweepTimer);
  ctx.logger.info({ signal }, "Worker shutting down (finishing active jobs)");
  // Don't outlive the orchestrator's stop grace period; unfinished jobs are retried by BullMQ.
  setTimeout(() => process.exit(1), 25_000).unref();
  try {
    await workers.close();
    await workerRedis.quit().catch(() => undefined);
    await close();
  } catch (err) {
    ctx.logger.error({ err }, "Error during worker shutdown");
    process.exit(1);
  }
  process.exit(0);
};
process.on("unhandledRejection", (err) => ctx.logger.error({ err }, "Unhandled promise rejection"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
