import cookieParser from "cookie-parser";
import cors from "cors";
import express, { Router } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { sql } from "drizzle-orm";
import type { CoreContext } from "@lifepilot/core";
import type { AppConfigDTO } from "@lifepilot/shared";
import { CSRF_HEADER, csrfGuard, requireUser, sessionMiddleware } from "./auth.js";
import { errorHandler } from "./http.js";
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
}

export function createApp(ctx: CoreContext, opts: AppOptions = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", ctx.config.isProd ? 1 : false);

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
  if (ctx.config.env !== "test") {
    app.use(
      pinoHttp({
        logger: ctx.logger,
        autoLogging: { ignore: (req) => req.url?.startsWith("/api/v1/health") ?? false },
        customProps: (req) => ({ userId: (req as express.Request).userId }),
      }),
    );
  }
  app.use(express.json({ limit: "200kb" }));
  app.use(cookieParser());
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: ctx.config.env === "test" ? 10_000 : 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: { code: "rate_limited", message: "Too many requests. Slow down a little." } },
    }),
  );

  const v1 = Router();

  // Public: liveness only reveals "ok". Readiness reveals only up/down per dependency.
  v1.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  v1.get("/health/ready", async (_req, res) => {
    const db = await ctx.db.execute(sql`select 1`).then(() => true, () => false);
    const redis = opts.checkRedis ? await opts.checkRedis().catch(() => false) : true;
    res.status(db && redis ? 200 : 503).json({ status: db && redis ? "ready" : "degraded", db, redis });
  });
  v1.get("/config", (_req, res) => {
    const cfg: AppConfigDTO = {
      demoMode: ctx.config.demoMode,
      googleConfigured: Boolean(ctx.config.google),
      aiProvider: ctx.extractor.name.startsWith("openai") ? "openai" : "mock",
      webPushPublicKey: ctx.push.publicKey,
      mailConfigured: ctx.mailer.configured,
    };
    res.json(cfg);
  });

  v1.use(csrfGuard);
  v1.use(sessionMiddleware(ctx));
  v1.use("/auth", authRoutes(ctx));
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
