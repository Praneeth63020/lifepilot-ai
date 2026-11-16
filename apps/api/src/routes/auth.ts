import { Router, type Request } from "express";
import { and, eq, isNull, ne } from "drizzle-orm";
import { authTokens, sessions, userPreferences, users } from "@lifepilot/db";
import { AppError, audit, describeMailError, getPrefs, passwordChangedEmail, passwordResetEmail, verificationEmail, type CoreContext, type MailMessage } from "@lifepilot/core";
import {
  loginSchema,
  registerSchema,
  resetTokenSchema,
  requestResetSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from "@lifepilot/shared";
import {
  AUTH_TOKEN_TTL_MS,
  consumeAuthToken,
  createSession,
  destroySession,
  findUserByEmail,
  getDummyHash,
  hashPassword,
  isAuthTokenValid,
  issueAuthToken,
  requireUser,
  uid,
  verifyPassword,
} from "../auth.js";
import { parse } from "../http.js";
import type { RateLimiters } from "../rate-limit.js";
import { prefsDTO, userDTO } from "../serialize.js";

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export function authRoutes(ctx: CoreContext, limiters: Pick<RateLimiters, "auth" | "loginPerAccount" | "resetPerAccount">): Router {
  const r = Router();
  const strict = limiters.auth;

  /**
   * Email delivery must not decide the HTTP outcome: the account/token already exists, and a
   * failure that only happens for real accounts would reveal which emails are registered.
   * Failures are logged (SMTP codes and reply only; never the message, link or token) and the user
   * can ask for another email.
   */
  async function sendMail(msg: MailMessage, userId: string, purpose: string): Promise<boolean> {
    try {
      await ctx.mailer.send(msg);
      ctx.logger.info({ userId, purpose }, "Email sent");
      return true;
    } catch (err) {
      ctx.logger.error({ err: describeMailError(err), userId, purpose }, "Sending email failed");
      return false;
    }
  }

  const brand = () => ({ webUrl: ctx.config.webUrl, supportEmail: ctx.config.supportEmail });

  async function notifyPasswordChanged(userId: string) {
    const user = await ctx.db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) return;
    const { timezone } = await getPrefs(ctx, userId);
    const when = new Intl.DateTimeFormat("en-GB", {
      day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: timezone, timeZoneName: "short",
    }).format(ctx.now());
    const content = passwordChangedEmail({ ...brand(), when, resetUrl: `${ctx.config.webUrl}/forgot-password` });
    await sendMail({ to: user.email, ...content }, userId, "password_changed");
  }

  /**
   * Local development without SMTP: emails only reach the API log, so a person testing the app
   * locally would never see their link. In that one case the link is also returned to the page.
   * Never in production (config refuses to start there without SMTP_URL) or tests, never once a
   * real mailer is configured, and only for requests made directly from this machine: a tunnel or
   * proxy adds X-Forwarded-For, which turns this off.
   */
  function devMailEnabled(req: Request): boolean {
    if (ctx.config.env !== "development" || ctx.mailer.configured) return false;
    if (req.headers["x-forwarded-for"] || req.headers["forwarded"]) return false;
    const addr = req.socket.remoteAddress ?? "";
    return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
  }

  async function sendVerification(userId: string, email: string) {
    const token = await issueAuthToken(ctx, userId, "verify_email");
    const link = `${ctx.config.webUrl}/verify-email?token=${token}`;
    const content = verificationEmail({ ...brand(), link, expiresHours: AUTH_TOKEN_TTL_MS.verify_email / 3600_000 });
    const sent = await sendMail({ to: email, ...content }, userId, "verify_email");
    return { sent, link };
  }

  r.post("/register", strict, async (req, res) => {
    const input = parse(registerSchema, req.body);
    if (await findUserByEmail(ctx, input.email)) {
      throw new AppError(409, "email_taken", "An account with this email already exists");
    }
    const [user] = await ctx.db
      .insert(users)
      .values({ email: input.email, name: input.name, passwordHash: await hashPassword(input.password) })
      .returning()
      .catch((err: unknown) => {
        // Two sign-ups racing past the check above: the unique index decides, report it the same way.
        if (isUniqueViolation(err)) throw new AppError(409, "email_taken", "An account with this email already exists");
        throw err;
      });
    await ctx.db.insert(userPreferences).values({ userId: user!.id, timezone: input.timezone ?? "UTC" });
    const verificationSent = (await sendVerification(user!.id, user!.email)).sent;
    await createSession(ctx, req, res, user!.id);
    await audit(ctx, user!.id, "auth.registered", "user", user!.id, undefined, req.ip);
    res.status(201).json({ user: userDTO(user!), preferences: prefsDTO(await getPrefs(ctx, user!.id)), verificationSent });
  });

  r.post("/login", strict, limiters.loginPerAccount, async (req, res) => {
    const input = parse(loginSchema, req.body);
    const user = await findUserByEmail(ctx, input.email);
    const ok = user ? await verifyPassword(user.passwordHash, input.password) : (await verifyPassword(await getDummyHash(), input.password), false);
    if (!user || !ok) {
      await audit(ctx, user?.id ?? null, "auth.login_failed", "user", user?.id, { email: input.email }, req.ip);
      throw new AppError(401, "invalid_credentials", "Incorrect email or password");
    }
    await createSession(ctx, req, res, user.id);
    await audit(ctx, user.id, "auth.login", "user", user.id, undefined, req.ip);
    res.json({ user: userDTO(user), preferences: prefsDTO(await getPrefs(ctx, user.id)) });
  });

  r.post("/logout", async (req, res) => {
    await destroySession(ctx, req, res);
    res.status(204).end();
  });

  r.get("/me", requireUser, async (req, res) => {
    const user = await ctx.db.query.users.findFirst({ where: eq(users.id, uid(req)) });
    if (!user) throw new AppError(401, "unauthenticated", "Please sign in");
    res.json({ user: userDTO(user), preferences: prefsDTO(await getPrefs(ctx, user.id)) });
  });

  r.post("/verify-email", strict, async (req, res) => {
    const { token } = parse(verifyEmailSchema, req.body);
    const userId = await consumeAuthToken(ctx, token, "verify_email");
    await ctx.db.update(users).set({ emailVerifiedAt: ctx.now() }).where(eq(users.id, userId));
    res.json({ ok: true });
  });

  r.post("/resend-verification", requireUser, strict, async (req, res) => {
    const user = await ctx.db.query.users.findFirst({ where: eq(users.id, uid(req)) });
    if (!user || user.emailVerifiedAt) return void res.json({ ok: true });
    const { sent, link } = await sendVerification(user.id, user.email);
    if (!sent) {
      // The user is signed in and asked explicitly, so a delivery failure is reported honestly.
      throw new AppError(502, "email_failed", "We couldn't send the email right now. Please try again in a few minutes.");
    }
    res.json({ ok: true, ...(devMailEnabled(req) ? { devMail: { link } } : {}) });
  });

  // Always 200 so the endpoint can't be used to discover which emails have accounts.
  r.post("/request-password-reset", strict, limiters.resetPerAccount, async (req, res) => {
    const { email } = parse(requestResetSchema, req.body);
    const user = await findUserByEmail(ctx, email);
    let link: string | null = null;
    if (user) {
      const token = await issueAuthToken(ctx, user.id, "reset_password");
      link = `${ctx.config.webUrl}/reset-password?token=${token}`;
      const content = passwordResetEmail({ ...brand(), link, expiresMinutes: AUTH_TOKEN_TTL_MS.reset_password / 60_000 });
      // Not awaited: waiting for the SMTP server only when the account exists would make real
      // accounts answer measurably slower than unknown emails. sendMail never throws.
      void sendMail({ to: user.email, ...content }, user.id, "reset_password");
      await audit(ctx, user.id, "auth.reset_requested", "user", user.id, undefined, req.ip);
    }
    // Local development only (see devMailEnabled); `link` is null when no account has this email.
    res.json({ ok: true, ...(devMailEnabled(req) ? { devMail: { link } } : {}) });
  });

  // Lets the reset page show "this link has expired" before asking for a new password. Doesn't use
  // the link up, and says nothing about the account.
  r.post("/reset-password/check", strict, async (req, res) => {
    const { token } = parse(resetTokenSchema, req.body);
    res.json({ valid: await isAuthTokenValid(ctx, token, "reset_password") });
  });

  r.post("/reset-password", strict, async (req, res) => {
    const { token, password } = parse(resetPasswordSchema, req.body);
    const userId = await consumeAuthToken(ctx, token, "reset_password");
    await ctx.db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, userId));
    // Any other reset link still in someone's inbox must stop working too.
    await ctx.db
      .update(authTokens)
      .set({ usedAt: ctx.now() })
      .where(and(eq(authTokens.userId, userId), eq(authTokens.kind, "reset_password"), isNull(authTokens.usedAt)));
    // Sign out everywhere after a password reset.
    await ctx.db.delete(sessions).where(eq(sessions.userId, userId));
    await audit(ctx, userId, "auth.password_reset", "user", userId, undefined, req.ip);
    res.json({ ok: true });
    // Tell the account owner, so a reset they didn't make doesn't go unnoticed. Best effort, after
    // the response: nothing here can undo or fail the reset.
    void notifyPasswordChanged(userId).catch((err: unknown) =>
      ctx.logger.error({ err: err instanceof Error ? err.message : String(err), userId }, "Password-changed notice failed"),
    );
  });

  r.get("/sessions", requireUser, async (req, res) => {
    const rows = await ctx.db.query.sessions.findMany({ where: eq(sessions.userId, uid(req)) });
    res.json({
      items: rows.map((s) => ({
        id: s.id.slice(0, 16),
        current: s.id === req.sessionId,
        userAgent: s.userAgent,
        createdAt: s.createdAt.toISOString(),
        lastSeenAt: s.lastSeenAt.toISOString(),
      })),
    });
  });

  r.post("/sessions/revoke-others", requireUser, async (req, res) => {
    await ctx.db.delete(sessions).where(and(eq(sessions.userId, uid(req)), ne(sessions.id, req.sessionId!)));
    res.json({ ok: true });
  });

  return r;
}
