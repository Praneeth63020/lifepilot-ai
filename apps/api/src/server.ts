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
// The same Redis connection holds rate-limit counters shared by every API instance.
const app = createApp(ctx, { checkRedis: async () => (await redis.ping()) === "PONG", redis });

const server = app.listen(config.port, () => {
  ctx.logger.info(
    {
      port: config.port,
      demoMode: config.demoMode,
      google: Boolean(config.google),
      ai: ctx.extractor.name,
      webPush: ctx.push.configured,
      mail: ctx.mailer.configured ? "smtp" : "not sent (dev only: links shown on the page)",
    },
    "LifePilot API listening",
  );
  // Check the SMTP login once at startup so a wrong password shows up now, not at the first reset.
  void ctx.mailer.verify?.().then((ok) => ok && ctx.logger.info("SMTP connection verified"));
  if (!config.google) ctx.logger.warn("Google OAuth not configured — Gmail/Calendar connect is disabled (demo data still available).");
});

const shutdown = (signal: string) => {
  ctx.logger.info({ signal }, "Shutting down");
  server.close(() => {
    close().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
// Last-resort logging: route handlers are covered by Express 5, but background promises are not.
process.on("unhandledRejection", (err) => ctx.logger.error({ err }, "Unhandled promise rejection"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
