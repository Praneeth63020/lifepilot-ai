import cookieParser from "cookie-parser";
import cors from "cors";
import express, { Router } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { sql } from "drizzle-orm";
import type { CoreContext } from "@lifepilot/core";
import type { Redis } from "@lifepilot/jobs";
import type { AppConfigDTO } from "@lifepilot/shared";
import { CSRF_HEADER, csrfGuard, requireUser, sessionMiddleware } from "./auth.js";
import { errorHandler } from "./http.js";
import { serializeRequest } from "./http-logging.js";
import { createRateLimiters, DEFAULT_RATE_LIMITS, TEST_RATE_LIMITS, type RateLimits } from "./rate-limit.js";
import { accountRoutes } from "./routes/account.js";
import { authRoutes } from "./routes/auth.js";
import { calendarRoutes } from "./routes/calendar.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { insightRoutes } from "./routes/insights.js";
import { integrationRoutes } from "./routes/integrations.js";
import { notificationRoutes, pushRoutes, reminderRoutes } from "./routes/notifications.js";
import { planRoutes } from "./routes/plans.js";
import { preferenceRoutes } from "./routes/preferences.js";
import { projectRoutes, subtaskRoutes, taskRoutes } from "./routes/tasks.js";

export interface AppOptions {
  /** Readiness probe for dependencies other than Postgres (e.g. Redis). */
  checkRedis?: () => Promise<boolean>;
  /** Log each request (default: on outside tests). */
  requestLogging?: boolean;
  /** Shared rate-limit counters. Without it each instance counts on its own (single-instance and tests). */
  redis?: Redis;
  /** Override limits (tests). Defaults: DEFAULT_RATE_LIMITS, or very high limits under NODE_ENV=test. */
  rateLimits?: Partial<RateLimits>;
  /** Redis key prefix for rate-limit counters (tests isolate runs with it). */
  rateLimitNamespace?: string;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export function createApp(ctx: CoreContext, opts: AppOptions = {}) {
  const app = express();
  app.disable("x-powered-by");
  // Hop count must match the real proxy chain or every client shares one rate-limit bucket.
  app.set("trust proxy", ctx.config.trustProxyHops > 0 ? ctx.config.trustProxyHops : false);

  app.use(helmet());
  app.use(
    cors({
      origin: ctx.config.webUrl,
      credentials: true,
      methods: ["GET", "POST", "PATCH", "DELETE"],
      allowedHeaders: ["content-type", CSRF_HEADER],
      maxAge: 600,
    }),
  );
  if (opts.requestLogging ?? ctx.config.env !== "test") {
    app.use(
      pinoHttp({
        logger: ctx.logger,
        // OAuth codes, state and tokens in query strings never reach the logs.
        serializers: { req: serializeRequest },
        autoLogging: { ignore: (req) => req.url?.startsWith("/api/v1/health") ?? false },
        customProps: (req) => ({ userId: (req as express.Request).userId }),
      }),
    );
  }
  app.use(express.json({ limit: "200kb" }));
  app.use(cookieParser());
  const limiters = createRateLimiters({
    limits: { ...(ctx.config.env === "test" ? TEST_RATE_LIMITS : DEFAULT_RATE_LIMITS), ...opts.rateLimits },
    redis: opts.redis,
    logger: ctx.logger,
    namespace: opts.rateLimitNamespace,
  });
  app.use(limiters.general);

  const v1 = Router();

  // Public: liveness only reveals "ok". Readiness reveals only up/down per dependency.
  v1.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  v1.get("/health/ready", async (_req, res) => {
    const db = await ctx.db.execute(sql`select 1`).then(() => true, () => false);
    const redis = opts.checkRedis ? await withTimeout(opts.checkRedis(), 2000).catch(() => false) : true;
    res.status(db && redis ? 200 : 503).json({ status: db && redis ? "ready" : "degraded", db, redis });
  });
  v1.get("/config", (_req, res) => {
    const cfg: AppConfigDTO = {
      demoMode: ctx.config.demoMode,
      googleConfigured: Boolean(ctx.config.google),
      aiProvider: ctx.extractor.name.startsWith("openai") ? "openai" : "mock",
      webPushPublicKey: ctx.push.publicKey,
      mailConfigured: ctx.mailer.configured,
      supportEmail: ctx.config.supportEmail,
      supportResponseTime: ctx.config.supportResponseTime,
    };
    res.json(cfg);
  });

  v1.use(csrfGuard);
  v1.use(sessionMiddleware(ctx));
  v1.use("/auth", authRoutes(ctx, limiters));
  v1.use("/integrations", integrationRoutes(ctx)); // has a public OAuth callback, rest requires auth
  v1.use(requireUser);
  v1.use("/preferences", preferenceRoutes(ctx));
  v1.use("/tasks", taskRoutes(ctx));
  v1.use("/subtasks", subtaskRoutes(ctx));
  v1.use("/projects", projectRoutes(ctx));
  v1.use("/calendar", calendarRoutes(ctx));
  v1.use("/insights", insightRoutes(ctx));
  v1.use("/plans", planRoutes(ctx));
  v1.use("/dashboard", dashboardRoutes(ctx));
  v1.use("/reminders", reminderRoutes(ctx));
  v1.use("/notifications", notificationRoutes(ctx));
  v1.use("/push", pushRoutes(ctx));
  v1.use("/account", accountRoutes(ctx));

  app.use("/api/v1", v1);
  app.use((_req, res) => {
    res.status(404).json({ error: { code: "not_found", message: "Route not found" } });
  });
  app.use(errorHandler(ctx));
  return app;
}
