/**
 * Rate limiting shared by every API instance.
 *
 * Counters live in Redis (one key per client and window), so limits hold across instances.
 * If Redis is unreachable, each instance falls back to its own in-memory counters: limits keep
 * working (per instance) instead of failing open (unlimited, a gift to password guessing) or
 * failing closed (nobody can sign in). The fallback is logged.
 *
 * Clients are identified by `req.ip`, which only honours X-Forwarded-For for the configured
 * number of trusted proxy hops (TRUST_PROXY_HOPS), so the header can't be spoofed to get a fresh
 * budget. IPv6 addresses are grouped by /56 subnet. Per-account limits key on a SHA-256 of the
 * email address, so addresses are never written to Redis.
 */
import type { Request, RequestHandler } from "express";
import rateLimit, { MemoryStore, type IncrementResponse, type Options, type Store } from "express-rate-limit";
import { sha256, type Logger } from "@lifepilot/core";
import type { Redis } from "@lifepilot/jobs";

// INCR, and start the window on the first hit. PTTL < 0 also repairs a key that lost its expiry.
const INCREMENT = `
local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { hits, ttl }`;

export class RedisRateLimitStore implements Store {
  readonly localKeys = false;
  readonly prefix: string;
  private windowMs = 60_000;
  private readonly fallback = new MemoryStore();
  private lastWarning = 0;

  constructor(
    private readonly redis: Redis,
    name: string,
    private readonly logger: Logger,
    namespace = "lifepilot:rl",
  ) {
    this.prefix = `${namespace}:${name}:`;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
    this.fallback.init(options);
  }

  async increment(key: string): Promise<IncrementResponse> {
    try {
      const [hits, ttl] = (await this.redis.eval(INCREMENT, 1, this.prefix + key, String(this.windowMs))) as [number, number];
      return { totalHits: hits, resetTime: new Date(Date.now() + ttl) };
    } catch (err) {
      this.warn(err);
      return this.fallback.increment(key);
    }
  }

  async decrement(key: string): Promise<void> {
    try {
      await this.redis.decr(this.prefix + key);
    } catch {
      await this.fallback.decrement(key);
    }
  }

  async resetKey(key: string): Promise<void> {
    try {
      await this.redis.del(this.prefix + key);
    } catch {
      await this.fallback.resetKey(key);
    }
  }

  private warn(err: unknown) {
    if (Date.now() - this.lastWarning < 60_000) return;
    this.lastWarning = Date.now();
    this.logger.warn({ err: err instanceof Error ? err.message : String(err) }, "Rate-limit store unavailable; using per-instance limits until Redis recovers");
  }
}

export interface RateLimits {
  /** All API requests, per client IP, per minute. */
  general: number;
  /** Sign-up, sign-in, verification and reset endpoints together, per client IP, per 15 minutes. */
  auth: number;
  /** Failed sign-ins for one email address, from any IP, per 15 minutes. */
  loginPerAccount: number;
  /** Password-reset emails requested for one address, from any IP, per hour. */
  resetPerAccount: number;
}

export const DEFAULT_RATE_LIMITS: RateLimits = { general: 300, auth: 20, loginPerAccount: 10, resetPerAccount: 5 };
/** Tests make many requests from one address; specific tests opt into real limits. */
export const TEST_RATE_LIMITS: RateLimits = { general: 10_000, auth: 1_000, loginPerAccount: 1_000, resetPerAccount: 1_000 };

export interface RateLimiters {
  general: RequestHandler;
  auth: RequestHandler;
  loginPerAccount: RequestHandler;
  resetPerAccount: RequestHandler;
}

const emailKey = (req: Request) => `acct:${sha256(String(req.body?.email ?? "").toLowerCase().trim())}`;
const hasEmail = (req: Request) => typeof req.body?.email === "string" && req.body.email.trim().length > 0;

export function createRateLimiters(opts: { limits: RateLimits; redis?: Redis; logger: Logger; namespace?: string }): RateLimiters {
  const store = (name: string) => (opts.redis ? new RedisRateLimitStore(opts.redis, name, opts.logger, opts.namespace) : undefined);
  const common = (name: string, windowMs: number, limit: number, message: string): Partial<Options> => {
    const s = store(name); // each limiter needs its own store instance
    return {
      windowMs,
      limit,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: { code: "rate_limited", message } },
      ...(s ? { store: s } : {}),
    };
  };
  return {
    general: rateLimit(common("general", 60_000, opts.limits.general, "Too many requests. Slow down a little.")),
    auth: rateLimit(common("auth", 15 * 60_000, opts.limits.auth, "Too many attempts. Try again in a few minutes.")),
    // Counts only failed sign-ins (4xx/5xx), so a user who signs in normally is never limited.
    loginPerAccount: rateLimit({
      ...common("login-account", 15 * 60_000, opts.limits.loginPerAccount, "Too many failed sign-ins for this account. Try again in a few minutes."),
      keyGenerator: emailKey,
      skip: (req) => !hasEmail(req),
      skipSuccessfulRequests: true,
    }),
    // Stops anyone flooding one person's inbox with reset emails. Applies whether or not the
    // account exists, so the limit itself reveals nothing.
    resetPerAccount: rateLimit({
      ...common("reset-account", 60 * 60_000, opts.limits.resetPerAccount, "Too many reset requests for this address. Try again later."),
      keyGenerator: emailKey,
      skip: (req) => !hasEmail(req),
    }),
  };
}
