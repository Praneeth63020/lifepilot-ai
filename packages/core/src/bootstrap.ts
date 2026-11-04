import { createDb } from "@lifepilot/db";
import { BullJobScheduler, createRedis } from "@lifepilot/jobs";
import { createExtractor } from "./ai/extractor.js";
import type { Config } from "./config.js";
import type { CoreContext } from "./context.js";
import { createLogger } from "./logger.js";
import { createMailer } from "./mailer.js";
import { createPushSender } from "./push.js";

/** Build the production context: real DB pool, Redis-backed queues, configured providers. */
export function createCoreContext(config: Config, name: string) {
  const logger = createLogger(config.logLevel, name);
  const { db, pool } = createDb(config.databaseUrl);
  const redis = createRedis(config.redisUrl);
  const jobs = new BullJobScheduler(redis);
  const ctx: CoreContext = {
    db,
    config,
    logger,
    jobs,
    extractor: createExtractor(config.ai, logger),
    mailer: createMailer(config.smtpUrl, config.mailFrom, logger),
    push: createPushSender(config.vapid),
    fetch: (input, init) => fetch(input, init),
    now: () => new Date(),
  };
  return {
    ctx,
    pool,
    redis,
    async close() {
      await jobs.close();
      await redis.quit().catch(() => undefined);
      await pool.end();
    },
  };
}
