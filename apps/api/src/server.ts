import { ConfigError, createCoreContext, loadConfig } from "@lifepilot/core";
import { createApp } from "./app.js";

let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`\n[LifePilot API] ${err.message}\n`);
    process.exit(1);
  }
  throw err;
}

const { ctx, redis, close } = createCoreContext(config, "api");
const app = createApp(ctx, { checkRedis: async () => (await redis.ping()) === "PONG" });

const server = app.listen(config.port, () => {
  ctx.logger.info(
    {
      port: config.port,
      demoMode: config.demoMode,
      google: Boolean(config.google),
      ai: ctx.extractor.name,
      webPush: ctx.push.configured,
      mail: ctx.mailer.configured ? "smtp" : "console (dev only)",
    },
    "LifePilot API listening",
  );
  if (!config.google) ctx.logger.warn("Google OAuth not configured — Gmail/Calendar connect is disabled (demo data still available).");
});

const shutdown = (signal: string) => {
  ctx.logger.info({ signal }, "Shutting down");
  server.close(() => {
    close().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
