import { hash, verify } from "@node-rs/argon2";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { authTokens, sessions, users } from "@lifepilot/db";
import { AppError, randomToken, sha256, type CoreContext } from "@lifepilot/core";

export const SESSION_COOKIE = "lp_session";
const SESSION_TTL_MS = 30 * 24 * 3600_000;
export const CSRF_HEADER = "x-lifepilot-csrf";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      sessionId?: string;
    }
  }
}

// OWASP-recommended argon2id parameters (19 MiB, 2 iterations).
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };
export const hashPassword = (pw: string) => hash(pw, ARGON);
export const verifyPassword = (h: string, pw: string) => verify(h, pw).catch(() => false);

// Used to keep login timing similar whether or not the account exists.
let dummyHash: Promise<string> | null = null;
export function getDummyHash() {
  dummyHash ??= hashPassword(randomToken(16));
  return dummyHash;
}

function cookieOptions(ctx: CoreContext) {
  return {
    httpOnly: true,
    secure: ctx.config.isProd,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_MS,
  };
}

export async function createSession(ctx: CoreContext, req: Request, res: Response, userId: string) {
  const token = randomToken(32);
  await ctx.db.insert(sessions).values({
    id: sha256(token),
    userId,
    userAgent: req.get("user-agent")?.slice(0, 300) ?? null,
    ip: req.ip ?? null,
    expiresAt: new Date(ctx.now().getTime() + SESSION_TTL_MS),
  });
  res.cookie(SESSION_COOKIE, token, cookieOptions(ctx));
}

export async function destroySession(ctx: CoreContext, req: Request, res: Response) {
  if (req.sessionId) await ctx.db.delete(sessions).where(eq(sessions.id, req.sessionId));
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(ctx), maxAge: undefined });
}

/** Resolve the session cookie (if any) into req.userId. Never trusts a client-supplied user id. */
export function sessionMiddleware(ctx: CoreContext): RequestHandler {
  return async (req, res, next) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (typeof token === "string" && token.length > 20) {
      const id = sha256(token);
      const s = await ctx.db.query.sessions.findFirst({ where: and(eq(sessions.id, id), gt(sessions.expiresAt, ctx.now())) });
      if (s) {
        req.userId = s.userId;
        req.sessionId = s.id;
        if (ctx.now().getTime() - s.lastSeenAt.getTime() > 5 * 60_000) {
          const now = ctx.now();

          await ctx.db
            .update(sessions)
            .set({
              lastSeenAt: now,
              expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
            })
            .where(eq(sessions.id, s.id));

          // Renew the browser cookie along with the database session.
          res.cookie(SESSION_COOKIE, token, cookieOptions(ctx));
        }
      }
    }
    next();
  };
}

export function requireUser(req: Request, _res: Response, next: NextFunction) {
  if (!req.userId) return next(new AppError(401, "unauthenticated", "Please sign in"));
  next();
}

export function uid(req: Request): string {
  if (!req.userId) throw new AppError(401, "unauthenticated", "Please sign in");
  return req.userId;
}

/**
 * CSRF defence for cookie auth: every state-changing request must carry a custom header.
 * Browsers can't add custom headers cross-site without a CORS preflight, and CORS only
 * allows WEB_URL. Combined with SameSite=Lax cookies.
 */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.get(CSRF_HEADER) !== "1") return next(new AppError(403, "csrf", "Missing CSRF header"));
  next();
}

export async function issueAuthToken(ctx: CoreContext, userId: string, kind: "verify_email" | "reset_password"): Promise<string> {
  const token = randomToken(32);
  const ttl = kind === "verify_email" ? 48 * 3600_000 : 3600_000;
  await ctx.db.insert(authTokens).values({ userId, kind, tokenHash: sha256(token), expiresAt: new Date(ctx.now().getTime() + ttl) });
  return token;
}

/** Single-use, unexpired token → user id. */
export async function consumeAuthToken(ctx: CoreContext, token: string, kind: "verify_email" | "reset_password"): Promise<string> {
  const [row] = await ctx.db
    .update(authTokens)
    .set({ usedAt: ctx.now() })
    .where(and(eq(authTokens.tokenHash, sha256(token)), eq(authTokens.kind, kind), isNull(authTokens.usedAt), gt(authTokens.expiresAt, ctx.now())))
    .returning();
  if (!row) throw new AppError(400, "invalid_token", "This link is invalid or has expired");
  return row.userId;
}

export async function findUserByEmail(ctx: CoreContext, email: string) {
  return ctx.db.query.users.findFirst({ where: eq(users.email, email) });
}
