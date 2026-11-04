import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");
const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    REDIS_URL: z.string().min(1, "REDIS_URL is required"),
    API_PORT: z.coerce.number().int().default(4000),
    API_URL: z.url().default("http://localhost:4000"),
    WEB_URL: z.url().default("http://localhost:5173"),
    MOBILE_DEEP_LINK_SCHEME: z.string().default("lifepilot"),
    SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
    TOKEN_ENCRYPTION_KEY: z
      .string()
      .refine((v) => {
        try {
          return Buffer.from(v, "base64").length === 32;
        } catch {
          return false;
        }
      }, "TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key (openssl rand -base64 32)"),
    DEMO_MODE: bool,
    AI_PROVIDER: z.enum(["mock", "openai"]).default("mock"),
    OPENAI_API_KEY: optional,
    OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
    AI_TIMEOUT_MS: z.coerce.number().int().default(15000),
    GOOGLE_CLIENT_ID: optional,
    GOOGLE_CLIENT_SECRET: optional,
    GOOGLE_REDIRECT_URI: optional,
    GOOGLE_GMAIL_SCOPES: z.string().default("https://www.googleapis.com/auth/gmail.readonly"),
    GOOGLE_CALENDAR_SCOPES: z.string().default("https://www.googleapis.com/auth/calendar.readonly"),
    GMAIL_SYNC_WINDOW_DAYS: z.coerce.number().int().min(1).max(90).default(14),
    CALENDAR_SYNC_WINDOW_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    VAPID_PUBLIC_KEY: optional,
    VAPID_PRIVATE_KEY: optional,
    VAPID_SUBJECT: z.string().default("mailto:admin@example.com"),
    SMTP_URL: optional,
    MAIL_FROM: z.string().default("LifePilot <no-reply@example.com>"),
  })
  .superRefine((env, ctx) => {
    if (env.AI_PROVIDER === "openai" && !env.OPENAI_API_KEY) {
      ctx.addIssue({ code: "custom", path: ["OPENAI_API_KEY"], message: "AI_PROVIDER=openai requires OPENAI_API_KEY (or set AI_PROVIDER=mock)" });
    }
    if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET)) {
      ctx.addIssue({ code: "custom", path: ["GOOGLE_CLIENT_ID"], message: "Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither" });
    }
    if (env.NODE_ENV === "production") {
      if (env.SESSION_SECRET.startsWith("replace-")) ctx.addIssue({ code: "custom", path: ["SESSION_SECRET"], message: "Placeholder SESSION_SECRET in production" });
      if (!env.SMTP_URL) ctx.addIssue({ code: "custom", path: ["SMTP_URL"], message: "SMTP_URL is required in production (verification and reset emails)" });
      if (!env.API_URL.startsWith("https://") || !env.WEB_URL.startsWith("https://")) {
        ctx.addIssue({ code: "custom", path: ["API_URL"], message: "API_URL and WEB_URL must be https in production" });
      }
    }
  });

export type Config = ReturnType<typeof buildConfig>;

function buildConfig(env: z.infer<typeof envSchema>) {
  return {
    env: env.NODE_ENV,
    isProd: env.NODE_ENV === "production",
    logLevel: env.LOG_LEVEL,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    port: env.API_PORT,
    apiUrl: env.API_URL.replace(/\/$/, ""),
    webUrl: env.WEB_URL.replace(/\/$/, ""),
    sessionSecret: env.SESSION_SECRET,
    encryptionKey: Buffer.from(env.TOKEN_ENCRYPTION_KEY, "base64"),
    demoMode: env.DEMO_MODE,
    ai: {
      provider: env.AI_PROVIDER,
      openaiApiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL,
      timeoutMs: env.AI_TIMEOUT_MS,
    },
    google:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            redirectUri: env.GOOGLE_REDIRECT_URI ?? `${env.API_URL.replace(/\/$/, "")}/api/v1/integrations/google/callback`,
            scopes: {
              gmail: env.GOOGLE_GMAIL_SCOPES.split(/[\s,]+/).filter(Boolean),
              calendar: env.GOOGLE_CALENDAR_SCOPES.split(/[\s,]+/).filter(Boolean),
            },
          }
        : null,
    gmailWindowDays: env.GMAIL_SYNC_WINDOW_DAYS,
    calendarWindowDays: env.CALENDAR_SYNC_WINDOW_DAYS,
    vapid:
      env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
        ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT }
        : null,
    smtpUrl: env.SMTP_URL,
    mailFrom: env.MAIL_FROM,
  };
}

export class ConfigError extends Error {}

/** Load `.env` from the repo root (if present) and validate. Throws ConfigError with every problem listed. */
export function loadConfig(overrides: Record<string, string | undefined> = {}): Config {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const p = path.join(dir, ".env");
    if (existsSync(p)) {
      loadDotenv({ path: p, quiet: true });
      break;
    }
    dir = path.dirname(dir);
  }
  const parsed = envSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(env)"}: ${i.message}`);
    throw new ConfigError(`Invalid configuration:\n${lines.join("\n")}\nSee .env.example for documentation.`);
  }
  return buildConfig(parsed.data);
}
