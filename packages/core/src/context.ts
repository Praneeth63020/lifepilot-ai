import type { Db } from "@lifepilot/db";
import type { JobScheduler } from "@lifepilot/jobs";
import type { Config } from "./config.js";
import type { Logger } from "./logger.js";
import type { InsightExtractor } from "./ai/extractor.js";
import type { Mailer } from "./mailer.js";
import type { PushSender } from "./push.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Everything a service needs. Injected so tests can swap clocks, fetch, queues and AI. */
export interface CoreContext {
  db: Db;
  config: Config;
  logger: Logger;
  jobs: JobScheduler;
  extractor: InsightExtractor;
  mailer: Mailer;
  push: PushSender;
  fetch: FetchLike;
  now: () => Date;
}

/** Expected, user-facing failures. Mapped to HTTP status codes by the API. */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new AppError(404, "not_found", `${what} not found`);
export const badRequest = (message: string, details?: unknown) => new AppError(400, "bad_request", message, details);
export const conflict = (message: string) => new AppError(409, "conflict", message);
export const forbidden = (message = "Not allowed") => new AppError(403, "forbidden", message);
