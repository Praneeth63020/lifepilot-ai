/**
 * Queue contracts shared by the API (producer) and the worker (consumer).
 * Jobs live in Redis (BullMQ), so scheduled reminders survive API/worker restarts.
 * The database remains the source of truth: every job re-checks DB state before acting.
 */
import { Queue, type ConnectionOptions } from "bullmq";
import { Redis } from "ioredis";

export const REMINDER_QUEUE = "reminders";
export const SYNC_QUEUE = "sync";
export const SYNC_INTERVAL_MS = 15 * 60_000;

export interface ReminderJobData {
  reminderId: string;
  version: number;
}

export interface SyncJobData {
  accountId: string;
  reason: "initial" | "scheduled" | "manual";
}

export function reminderJobId(reminderId: string, version: number): string {
  return `rem_${reminderId}_v${version}`;
}

export function syncSchedulerId(accountId: string): string {
  return `sync_${accountId}`;
}

export function createRedis(url: string): Redis {
  // maxRetriesPerRequest: null is required by BullMQ workers.
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true });
}

/** Producer-side facade so the API never deals with BullMQ details directly. */
export interface JobScheduler {
  scheduleReminder(reminderId: string, version: number, at: Date): Promise<void>;
  cancelReminder(reminderId: string, version: number): Promise<void>;
  enqueueSync(accountId: string, reason: SyncJobData["reason"]): Promise<void>;
  startRecurringSync(accountId: string): Promise<void>;
  stopRecurringSync(accountId: string): Promise<void>;
  close(): Promise<void>;
}

export class BullJobScheduler implements JobScheduler {
  readonly reminders: Queue<ReminderJobData>;
  readonly sync: Queue<SyncJobData>;

  constructor(connection: ConnectionOptions, prefix = "lifepilot") {
    this.reminders = new Queue<ReminderJobData>(REMINDER_QUEUE, {
      connection,
      prefix,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: { age: 7 * 24 * 3600, count: 10_000 },
        removeOnFail: { age: 30 * 24 * 3600 },
      },
    });
    this.sync = new Queue<SyncJobData>(SYNC_QUEUE, {
      connection,
      prefix,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 1000 },
      },
    });
  }

  async scheduleReminder(reminderId: string, version: number, at: Date): Promise<void> {
    const delay = Math.max(0, at.getTime() - Date.now());
    // Deterministic jobId → re-adding the same (reminder, version) is a no-op (idempotent).
    await this.reminders.add("fire", { reminderId, version }, { jobId: reminderJobId(reminderId, version), delay });
  }

  async cancelReminder(reminderId: string, version: number): Promise<void> {
    const job = await this.reminders.getJob(reminderJobId(reminderId, version));
    // A job that is already running can't be removed; the worker re-checks DB status and no-ops.
    if (job) await job.remove().catch(() => undefined);
  }

  async enqueueSync(accountId: string, reason: SyncJobData["reason"]): Promise<void> {
    await this.sync.add("sync", { accountId, reason }, { jobId: `sync_${accountId}_${reason}_${Date.now()}` });
  }

  async startRecurringSync(accountId: string): Promise<void> {
    await this.sync.upsertJobScheduler(
      syncSchedulerId(accountId),
      { every: SYNC_INTERVAL_MS },
      { name: "sync", data: { accountId, reason: "scheduled" } },
    );
  }

  async stopRecurringSync(accountId: string): Promise<void> {
    await this.sync.removeJobScheduler(syncSchedulerId(accountId));
  }

  async close(): Promise<void> {
    await Promise.all([this.reminders.close(), this.sync.close()]);
  }
}
